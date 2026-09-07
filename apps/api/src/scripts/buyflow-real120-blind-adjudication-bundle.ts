import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  snippet?: string;
  payload?: GmailPartLike;
}

type Prediction = {
  event_type: string;
  perspective: string;
  order_id: string | null;
  tracking_id: string | null;
  link_status: string;
};

type ResultRow = {
  index: number;
  luna: Prediction | null;
  terra: Prediction | null;
  sol_tiebreak: Prediction | null;
};

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_ID_SHA = '88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function headerValue(part: GmailPartLike | undefined, name: string): string | null {
  if (!part) return null;
  const expected = name.toLowerCase();
  const found = (part.headers ?? []).find((h) => h.name?.toLowerCase() === expected);
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

async function main() {
  const predictionsPath = process.argv[2];
  const idFile = process.argv[3];
  if (!predictionsPath || !idFile) throw new Error('USAGE: <predictions-private-local.json> <real120-ids.json>');
  const gmailToken = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!gmailToken) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const predictions = JSON.parse(await readFile(predictionsPath, 'utf8')) as { rows?: ResultRow[] };
  const rows = Array.isArray(predictions.rows) ? predictions.rows : [];
  const disputed = rows.filter((r) => r && r.sol_tiebreak !== null);
  if (disputed.length !== 35) throw new Error(`EXPECTED_35_DISPUTES_GOT_${disputed.length}`);

  const idsRaw = JSON.parse(await readFile(idFile, 'utf8')) as unknown;
  if (!Array.isArray(idsRaw) || idsRaw.length !== 120 || idsRaw.some((x) => typeof x !== 'string')) {
    throw new Error('REAL120_ID_FILE_INVALID');
  }
  const ids = idsRaw.map((x) => String(x).trim());
  const idSha = sha256(ids.join('\n'));
  if (idSha !== EXPECTED_ID_SHA) throw new Error(`REAL120_ID_SHA_MISMATCH:${idSha}`);

  const cases: any[] = [];
  let hydratedBodies = 0;
  for (let i = 0; i < disputed.length; i += 1) {
    const row = disputed[i]!;
    const gmailId = ids[row.index - 1];
    if (!gmailId) throw new Error(`MISSING_GMAIL_ID_FOR_INDEX_${row.index}`);
    const message = await gmailJson(`/messages/${encodeURIComponent(gmailId)}?format=full`, gmailToken) as GmailMessageLike;
    if (message.id !== gmailId) throw new Error(`GMAIL_ID_MISMATCH_${row.index}`);
    hydratedBodies += await hydrateDetachedBodies(message.payload, gmailId, gmailToken);
    const normalized = normalizeGmailMessage(message as any);
    const document = normalizeEmailDocumentV1(normalized);
    const semanticText = document.semanticText?.trim() || document.snippet?.trim() || '';
    cases.push({
      case_id: `R120-${String(row.index).padStart(3, '0')}`,
      from: headerValue(message.payload, 'From') ?? '',
      subject: headerValue(message.payload, 'Subject') ?? '',
      semantic_text: semanticText,
    });
    console.log(`[${String(i + 1).padStart(2, '0')}/35] ${cases[cases.length - 1].case_id} OK`);
  }

  const bundle = {
    benchmark: 'buyflow-real120-blind-adjudication-v1',
    frozen_real120_sha256: idSha,
    created_at: new Date().toISOString(),
    total_cases: cases.length,
    source: 'MailLens subject + sender + semanticText',
    model_predictions_included: false,
    instructions: {
      task: 'For each case, independently assign exactly one BuyFlow classification without seeing Luna, Terra or Sol outputs.',
      event_type: ['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER'],
      perspective: ['buyer','merchant_outbound','non_purchase'],
      link_status: ['linked','unresolved','not_applicable'],
      fields: ['event_type','perspective','order_id','tracking_id','link_status'],
      rules: [
        'Classify the current directly asserted state, not future plans or quoted history.',
        'buyer means mailbox owner is customer side; merchant_outbound only when mailbox owner is explicitly the seller shipping to own customers; non_purchase for marketing/security/survey/etc.',
        'SHIPMENT_CREATED is label/pre-advice only; SHIPPED requires physical carrier handoff; IN_TRANSIT means moving/processed in carrier network; OUT_FOR_DELIVERY means on local delivery route; READY_FOR_PICKUP means physically available at pickup point; DELIVERED means completed handoff.',
        'REFUNDED requires completed money return; RETURN requires returned parcel physically received. Requests/labels/processing alone are not settled REFUNDED/RETURN.',
        'linked only with exact order id for this event or explicit verified order-to-tracking relation; unresolved for real lifecycle without exact purchase link or with ambiguity; not_applicable when no lifecycle link is needed.',
        'Do not invent order_id or tracking_id.'
      ]
    },
    privacy: {
      contains_private_email_text: true,
      raw_gmail_ids_included: false,
      model_outputs_included: false,
      gmail_http_methods: ['GET'],
      buyflow_writes: 0,
      production_off: true,
      blind_o3_used: false,
    },
    hydrated_detached_bodies: hydratedBodies,
    cases,
  };

  const outPath = path.join(path.dirname(path.resolve(predictionsPath)), 'blind-adjudication-bundle-private-local.json');
  await writeFile(outPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  console.log('');
  console.log('BLIND ADJUDICATION BUNDLE: READY');
  console.log(`Cases: ${cases.length}`);
  console.log(`File: ${outPath}`);
  console.log('No OpenAI calls | Gmail GET only | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('IMPORTANT: this file contains private email text. Upload it only if you want ChatGPT to adjudicate the 35 cases.');
}

main().catch((error) => {
  console.error(`BLIND_BUNDLE_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
