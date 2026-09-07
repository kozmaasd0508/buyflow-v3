import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';

interface GmailBodyLike { attachmentId?: string; size?: number; data?: string }
interface GmailHeaderLike { name?: string; value?: string }
interface GmailPartLike {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeaderLike[];
  body?: GmailBodyLike;
  parts?: GmailPartLike[];
}
interface GmailMessageLike {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPartLike;
}

type Prediction = {
  event_type: string;
  perspective: string;
  order_id: string | null;
  tracking_id: string | null;
  link_status: string;
};

type UsageTotals = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
};

const API_URL = 'https://api.openai.com/v1/responses';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_COUNT = 120;
const EVENTS = [
  'ORDER_CREATED', 'ORDER_PROCESSING', 'PAYMENT', 'INVOICE', 'SHIPMENT_CREATED',
  'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED',
  'CANCELLED', 'REFUNDED', 'RETURN', 'OTHER',
] as const;
const PERSPECTIVES = ['buyer', 'merchant_outbound', 'non_purchase'] as const;
const LINKS = ['linked', 'unresolved', 'not_applicable'] as const;
const FIELDS = ['event_type', 'perspective', 'order_id', 'tracking_id', 'link_status'] as const;
const MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra'] as const;
const PRICE: Record<string, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.6-terra': { input: 2.0, output: 12.0 },
  'gpt-5.6-sol': { input: 4.0, output: 20.0 },
};

const SCHEMA = {
  type: 'object',
  properties: {
    event_type: { type: 'string', enum: EVENTS },
    perspective: { type: 'string', enum: PERSPECTIVES },
    order_id: { type: ['string', 'null'] },
    tracking_id: { type: ['string', 'null'] },
    link_status: { type: 'string', enum: LINKS },
  },
  required: FIELDS,
  additionalProperties: false,
};

const SYSTEM = `Classify this commerce email for BuyFlow. Return exactly one JSON object with event_type, perspective, order_id, tracking_id, link_status. Do not invent facts.
Allowed event_type: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
Allowed perspective: buyer, merchant_outbound, non_purchase.
Allowed link_status: linked, unresolved, not_applicable.
Semantics:
- buyer = mailbox owner is the customer side, even if sender is merchant, warehouse, payment provider, invoice provider or carrier.
- merchant_outbound = mailbox owner is explicitly the seller sending parcels to its own customers.
- non_purchase = marketing, security, survey, preference or other non-purchase content.
- linked = exact order id is present for this event, or an explicit verified order-to-tracking relation exists.
- unresolved = real purchase lifecycle event but no exact purchase link is available, or multiple purchase candidates remain.
- not_applicable = no purchase lifecycle linking is required.
- SHIPMENT_CREATED = label/pre-advice/tracking created but carrier has not physically collected the parcel.
- SHIPPED = carrier physically collected the parcel from sender; no later network movement is the current state.
- IN_TRANSIT = parcel is moving/processed inside carrier network; a failed delivery followed by return to depot is IN_TRANSIT.
- OUT_FOR_DELIVERY = assigned to local courier/vehicle for today's route.
- READY_FOR_PICKUP = physically at locker/pickup point and available for collection.
- DELIVERED = recipient handoff completed.
- REFUNDED = money was actually returned/completed.
- RETURN = returned parcel was physically received by merchant/returns warehouse.
- Refund request, refund processing started, or return-label creation alone are not REFUNDED/RETURN; use OTHER when no settled lifecycle event occurred.
- Prefer current message state over quoted/older history.
- Ignore example IDs, coupon-like codes, document numbers and transaction IDs unless the email explicitly identifies them as order/tracking IDs.`;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function headerValue(part: GmailPartLike | undefined, name: string): string | null {
  if (!part) return null;
  const expected = name.toLowerCase();
  const found = (part.headers ?? []).find((header) => header.name?.toLowerCase() === expected);
  return found?.value?.trim() || null;
}
function isDetachedRenderableBody(part: GmailPartLike): boolean {
  const mime = part.mimeType?.toLowerCase();
  if (mime !== 'text/plain' && mime !== 'text/html') return false;
  if (part.filename?.trim()) return false;
  const disposition = headerValue(part, 'Content-Disposition')?.toLowerCase() ?? '';
  if (/\battachment\b/.test(disposition)) return false;
  return Boolean(part.body?.attachmentId?.trim() && !part.body?.data);
}
async function gmailJson(urlPath: string, token: string): Promise<any> {
  const retryMs = [500, 1500, 4000];
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${GMAIL_BASE}${urlPath}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (response.ok) return await response.json();
    if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < retryMs.length) {
      await sleep(retryMs[attempt]!);
      continue;
    }
    throw new Error(`GMAIL_HTTP_${response.status}`);
  }
}
async function hydrateDetachedBodies(part: GmailPartLike | undefined, messageId: string, token: string): Promise<number> {
  if (!part) return 0;
  let hydrated = 0;
  if (isDetachedRenderableBody(part)) {
    const attachmentId = part.body!.attachmentId!.trim();
    const payload = await gmailJson(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, token);
    if (typeof payload.data !== 'string' || payload.data.length === 0) throw new Error('DETACHED_BODY_ATTACHMENT_EMPTY');
    part.body = { ...part.body, data: payload.data, ...(typeof payload.size === 'number' ? { size: payload.size } : {}) };
    hydrated += 1;
  }
  for (const child of part.parts ?? []) hydrated += await hydrateDetachedBodies(child, messageId, token);
  return hydrated;
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts: string[] = [];
  for (const item of data?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item?.content ?? []) if (c?.type === 'output_text' && typeof c?.text === 'string') parts.push(c.text);
  }
  return parts.join('').trim();
}
function blankUsage(): UsageTotals {
  return { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
}
function addUsage(total: UsageTotals, usage: any): void {
  total.input_tokens += Number(usage?.input_tokens ?? 0);
  total.cached_input_tokens += Number(usage?.input_tokens_details?.cached_tokens ?? 0);
  total.output_tokens += Number(usage?.output_tokens ?? 0);
  total.reasoning_tokens += Number(usage?.output_tokens_details?.reasoning_tokens ?? 0);
}
function cost(model: string, usage: UsageTotals): number {
  const p = PRICE[model]!;
  return usage.input_tokens / 1_000_000 * p.input + usage.output_tokens / 1_000_000 * p.output;
}
function same(a: Prediction | null, b: Prediction | null, fields: readonly (keyof Prediction)[] = FIELDS): boolean {
  return Boolean(a && b && fields.every((f) => a[f] === b[f]));
}
function safePrediction(value: any): Prediction {
  if (!value || typeof value !== 'object') throw new Error('OUTPUT_NOT_OBJECT');
  const pred: Prediction = {
    event_type: value.event_type,
    perspective: value.perspective,
    order_id: value.order_id ?? null,
    tracking_id: value.tracking_id ?? null,
    link_status: value.link_status,
  };
  if (!EVENTS.includes(pred.event_type as any)) throw new Error('BAD_EVENT_TYPE');
  if (!PERSPECTIVES.includes(pred.perspective as any)) throw new Error('BAD_PERSPECTIVE');
  if (!LINKS.includes(pred.link_status as any)) throw new Error('BAD_LINK_STATUS');
  if (pred.order_id !== null && typeof pred.order_id !== 'string') throw new Error('BAD_ORDER_ID');
  if (pred.tracking_id !== null && typeof pred.tracking_id !== 'string') throw new Error('BAD_TRACKING_ID');
  return pred;
}
async function callModel(apiKey: string, model: string, emailText: string): Promise<{ pred: Prediction; usage: any; resolved: string }> {
  const retryMs = [1000, 2500, 6000];
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: SYSTEM,
        input: `Email:\n\n${emailText}`,
        reasoning: { effort: 'low' },
        text: {
          verbosity: 'low',
          format: { type: 'json_schema', name: 'buyflow_email_classification', strict: true, schema: SCHEMA },
        },
        max_output_tokens: 512,
        store: false,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      const text = extractOutputText(data);
      if (!text) throw new Error(`OPENAI_NO_OUTPUT:${model}`);
      return { pred: safePrediction(JSON.parse(text)), usage: data.usage ?? {}, resolved: data.model ?? model };
    }
    const detail = await response.text().catch(() => '');
    if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < retryMs.length) {
      await sleep(retryMs[attempt]!);
      continue;
    }
    throw new Error(`OPENAI_HTTP_${response.status}:${model}:${detail.slice(0, 240)}`);
  }
}

async function main() {
  const idFile = process.argv[2];
  const outDirArg = process.argv[3];
  if (!idFile) throw new Error('USAGE: <real120-ids.json> [output-dir]');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const gmailToken = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  if (!gmailToken) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const idsRaw = JSON.parse(await readFile(idFile, 'utf8')) as unknown;
  if (!Array.isArray(idsRaw) || idsRaw.length !== EXPECTED_COUNT || idsRaw.some((x) => typeof x !== 'string')) {
    throw new Error(`REAL120_ID_FILE_INVALID`);
  }
  const ids = idsRaw.map((x) => String(x).trim());
  if (new Set(ids).size !== EXPECTED_COUNT) throw new Error('REAL120_DUPLICATE_IDS');
  const idSha = sha256(ids.join('\n'));
  const expectedIdSha = '88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470';
  if (idSha !== expectedIdSha) throw new Error(`REAL120_ID_SHA_MISMATCH:${idSha}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = outDirArg ? path.resolve(outDirArg) : path.join(os.homedir(), 'Desktop', `buyflow-real120-mail-lens-openai-${stamp}`);
  await mkdir(outDir, { recursive: true });

  console.log('==============================================================');
  console.log('BUYFLOW REAL120 - MAILLENS + OPENAI LUNA/TERRA + SOL TIEBREAK');
  console.log('120 real Gmail messages | Gmail GET only | BuyFlow writes 0');
  console.log('MailLens normalized semanticText | Responses API | store=false');
  console.log('Luna + Terra on all 120; Sol only where they disagree.');
  console.log('This measures model agreement/routing behavior, NOT gold accuracy.');
  console.log('Blind O3 NOT USED | Production OFF');
  console.log(`Frozen REAL120 SHA256: ${idSha}`);
  console.log('==============================================================');

  const usage: Record<string, UsageTotals> = {
    'gpt-5.6-luna': blankUsage(),
    'gpt-5.6-terra': blankUsage(),
    'gpt-5.6-sol': blankUsage(),
  };
  const resolvedModels: Record<string, string> = {};
  const rows: any[] = [];
  let exactAgree = 0;
  let eventAgree = 0;
  let perspectiveAgree = 0;
  let linkAgree = 0;
  let solTiebreaks = 0;
  let technicalErrors = 0;
  let detachedBodiesHydrated = 0;

  for (let index = 0; index < ids.length; index += 1) {
    const gmailId = ids[index]!;
    const row: any = {
      index: index + 1,
      gmail_id_sha256: sha256(gmailId),
      mail_lens_normalizer: null,
      semantic_text_chars: 0,
      detached_bodies_hydrated: 0,
      luna: null,
      terra: null,
      sol_tiebreak: null,
      consensus: null,
      error: null,
    };
    try {
      const message = await gmailJson(`/messages/${encodeURIComponent(gmailId)}?format=full`, gmailToken) as GmailMessageLike;
      if (message.id !== gmailId) throw new Error('GMAIL_ID_MISMATCH');
      const hydrated = await hydrateDetachedBodies(message.payload, gmailId, gmailToken);
      detachedBodiesHydrated += hydrated;
      row.detached_bodies_hydrated = hydrated;

      const normalized = normalizeGmailMessage(message as any);
      const document = normalizeEmailDocumentV1(normalized);
      row.mail_lens_normalizer = document.normalizerVersion;
      const semanticText = document.semanticText?.trim() || document.snippet?.trim() || '';
      row.semantic_text_chars = semanticText.length;
      const from = headerValue(message.payload, 'From') ?? '';
      const subject = headerValue(message.payload, 'Subject') ?? '';
      const emailText = `Feladó: ${from}\nTárgy: ${subject}\n\n${semanticText}`;

      const [luna, terra] = await Promise.all(
        MODELS.map((model) => callModel(apiKey, model, emailText)),
      );
      row.luna = luna!.pred;
      row.terra = terra!.pred;
      addUsage(usage['gpt-5.6-luna']!, luna!.usage);
      addUsage(usage['gpt-5.6-terra']!, terra!.usage);
      resolvedModels['gpt-5.6-luna'] = luna!.resolved;
      resolvedModels['gpt-5.6-terra'] = terra!.resolved;

      if (same(row.luna, row.terra)) exactAgree += 1;
      if (same(row.luna, row.terra, ['event_type'])) eventAgree += 1;
      if (same(row.luna, row.terra, ['perspective'])) perspectiveAgree += 1;
      if (same(row.luna, row.terra, ['link_status'])) linkAgree += 1;

      if (same(row.luna, row.terra)) {
        row.consensus = row.luna;
      } else {
        solTiebreaks += 1;
        const sol = await callModel(apiKey, 'gpt-5.6-sol', emailText);
        row.sol_tiebreak = sol.pred;
        row.consensus = sol.pred;
        addUsage(usage['gpt-5.6-sol']!, sol.usage);
        resolvedModels['gpt-5.6-sol'] = sol.resolved;
      }
      console.log(`[${String(index + 1).padStart(3, '0')}/120] OK exact=${same(row.luna, row.terra) ? 'AGREE' : 'DISAGREE->SOL'} event=${same(row.luna, row.terra, ['event_type']) ? 'same' : 'diff'}`);
    } catch (error) {
      technicalErrors += 1;
      row.error = error instanceof Error ? error.message : String(error);
      console.log(`[${String(index + 1).padStart(3, '0')}/120] ERROR ${row.error}`);
    }
    rows.push(row);
  }

  const modelSummary: Record<string, any> = {};
  for (const model of ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']) {
    modelSummary[model] = {
      resolved_model: resolvedModels[model] ?? null,
      usage: usage[model],
      conservative_cost_usd: Number(cost(model, usage[model]!).toFixed(6)),
    };
  }
  const totalCost = Object.entries(modelSummary).reduce((sum, [, v]: any) => sum + Number(v.conservative_cost_usd || 0), 0);
  const pct = (n: number) => Number((100 * n / EXPECTED_COUNT).toFixed(2));
  const summary = {
    benchmark: 'buyflow-real120-mail-lens-openai-agreement-v1',
    created_at: new Date().toISOString(),
    frozen_real120_sha256: idSha,
    total: EXPECTED_COUNT,
    mail_lens: true,
    mail_lens_input: 'subject + sender + semanticText',
    luna_terra_agreement: {
      exact_all_5_fields: { count: exactAgree, pct: pct(exactAgree) },
      event_type: { count: eventAgree, pct: pct(eventAgree) },
      perspective: { count: perspectiveAgree, pct: pct(perspectiveAgree) },
      link_status: { count: linkAgree, pct: pct(linkAgree) },
    },
    sol_tiebreaks: solTiebreaks,
    technical_errors: technicalErrors,
    detached_bodies_hydrated: detachedBodiesHydrated,
    models: modelSummary,
    total_conservative_cost_usd: Number(totalCost.toFixed(6)),
    gold_accuracy_measured: false,
    note: 'No frozen REAL120 gold mapping is stored in the repository; this run measures agreement and production-like routing, not absolute accuracy.',
    safety: {
      gmail_http_methods: ['GET'],
      mailbox_mutations: 0,
      buyflow_db_writes: 0,
      production_flags_enabled: false,
      raw_gmail_ids_persisted: false,
      message_content_persisted: false,
      openai_store: false,
      blind_o3_used: false,
    },
  };

  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await writeFile(path.join(outDir, 'predictions-private-local.json'), JSON.stringify({ ...summary, rows }, null, 2) + '\n', 'utf8');

  console.log('');
  console.log('==================== REAL120 RESULT ====================');
  console.log(`Luna/Terra exact agreement: ${exactAgree}/120 = ${pct(exactAgree)}%`);
  console.log(`event_type agreement:       ${eventAgree}/120 = ${pct(eventAgree)}%`);
  console.log(`perspective agreement:      ${perspectiveAgree}/120 = ${pct(perspectiveAgree)}%`);
  console.log(`link_status agreement:      ${linkAgree}/120 = ${pct(linkAgree)}%`);
  console.log(`Sol tiebreak calls:         ${solTiebreaks}`);
  console.log(`Technical errors:           ${technicalErrors}`);
  console.log(`Luna cost:                  $${modelSummary['gpt-5.6-luna'].conservative_cost_usd.toFixed(4)}`);
  console.log(`Terra cost:                 $${modelSummary['gpt-5.6-terra'].conservative_cost_usd.toFixed(4)}`);
  console.log(`Sol tiebreak cost:          $${modelSummary['gpt-5.6-sol'].conservative_cost_usd.toFixed(4)}`);
  console.log(`Total conservative cost:    $${totalCost.toFixed(4)}`);
  console.log('Gold accuracy:              NOT MEASURED (agreement test)');
  console.log(`Summary: ${path.join(outDir, 'summary.json')}`);
  console.log('Gmail GET only | BuyFlow writes 0 | Production OFF | Blind O3 NOT USED');
  console.log('========================================================');
}

main().catch((error) => {
  console.error(`REAL120_OPENAI_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
