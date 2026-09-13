import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeMailLensText, MAIL_LENS_TEXT_VERSION } from '../email/mail-lens-text.ts';

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

const API_URL = 'https://api.openai.com/v1/responses';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MODEL = 'gpt-5.6-luna';
const EXPECTED_COUNT = 100;
const EXPECTED_SELECTION_SHA = '0161411f2e6d5ecfac675ea78318495bc263b241c72b191f897371cc469a6164';
const EVENTS = ['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER'];
const PERSPECTIVES = ['buyer','merchant_outbound','non_purchase'];
const LINKS = ['linked','unresolved','not_applicable'];
const FIELDS = ['event_type','perspective','order_id','tracking_id','link_status'];
const RETRY_MS = [1000, 2500, 6000];

const SYSTEM = `Classify this commerce email for BuyFlow. Return exactly one JSON object with event_type, perspective, order_id, tracking_id, link_status. Do not invent facts.
Allowed event_type: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
Allowed perspective: buyer, merchant_outbound, non_purchase.
Allowed link_status: linked, unresolved, not_applicable.

Decision order — follow this order strictly:
1. Determine perspective first.
2. Determine the current directly asserted event state.
3. Extract only explicitly identified buyer-side order/tracking IDs.
4. Determine link_status last.

Perspective:
- buyer = mailbox owner is the customer/recipient side, even if sender is merchant, warehouse, payment provider, invoice provider or carrier.
- merchant_outbound = mailbox owner is acting as seller/shipper and the message concerns pickup, fulfillment or delivery of parcels from the mailbox owner to the mailbox owner's own customers.
- non_purchase = marketing, security, survey, preference or other non-purchase content.
- A carrier message about collecting a parcel FROM the mailbox owner/sender is merchant_outbound, not buyer.
- A courier accepting a pickup/collection job from the sender does not mean a buyer-side parcel is being delivered.

Hard merchant-outbound rules:
- If perspective = merchant_outbound, link_status MUST be not_applicable.
- If perspective = merchant_outbound, order_id MUST be null and tracking_id MUST be null for BuyFlow buyer-side linking.
- Pickup-job IDs, collection-request IDs, fulfillment references and carrier booking references are NOT buyer order IDs or buyer tracking IDs.

Linking:
- linked = buyer-side lifecycle event with an exact buyer order id present for this event, or an explicit verified buyer order-to-tracking relation.
- unresolved = buyer-side purchase lifecycle event but no exact purchase link is available, or multiple purchase candidates remain.
- not_applicable = merchant_outbound or non_purchase, or otherwise no buyer purchase lifecycle linking is required.

Lifecycle boundaries:
- SHIPMENT_CREATED = label/pre-advice/tracking/collection booking created, or pickup accepted/scheduled, but physical carrier handoff has not yet occurred.
- SHIPPED = carrier physically collected/accepted the parcel from sender; no later network movement is the current state.
- IN_TRANSIT = parcel is moving/processed inside carrier network; a failed delivery followed by return to depot is IN_TRANSIT.
- OUT_FOR_DELIVERY = assigned to local courier/vehicle for today's recipient-delivery route.
- READY_FOR_PICKUP = physically at locker/pickup point and available for collection by recipient.
- DELIVERED = recipient handoff completed.
- REFUNDED = money was actually returned/completed.
- RETURN = returned parcel was physically received by merchant/returns warehouse.
- Refund request, refund processing started, return request or return-label creation alone are not REFUNDED/RETURN; use OTHER when no settled lifecycle event occurred.
- If a message says a parcel/order will be handed to the carrier shortly, that future handoff is not SHIPPED yet; use the current preparation/processing state.
- Prefer current message state over quoted/older history.
- Ignore example IDs, coupon-like codes, invoice/document numbers, transaction IDs and generic reference numbers unless the email explicitly identifies them as a buyer order ID or buyer tracking/shipment ID.`;

const SCHEMA = {
  type: 'object',
  properties: {
    event_type: { type: 'string', enum: EVENTS },
    perspective: { type: 'string', enum: PERSPECTIVES },
    order_id: { type: ['string','null'] },
    tracking_id: { type: ['string','null'] },
    link_status: { type: 'string', enum: LINKS },
  },
  required: FIELDS,
  additionalProperties: false,
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function headerValue(part: GmailPartLike | undefined, name: string): string | null {
  const expected = name.toLowerCase();
  return (part?.headers ?? []).find(h => h.name?.toLowerCase() === expected)?.value?.trim() || null;
}
function isRenderableBody(part: GmailPartLike): boolean {
  const mime = part.mimeType?.toLowerCase();
  if (mime !== 'text/plain' && mime !== 'text/html') return false;
  if (part.filename?.trim()) return false;
  const disposition = headerValue(part, 'Content-Disposition')?.toLowerCase() ?? '';
  return !/\battachment\b/.test(disposition);
}
function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}
function collectBodyParts(part: GmailPartLike | undefined, out: { plain: string[]; html: string[] }, depth = 0): void {
  if (!part || depth > 30) return;
  const mime = part.mimeType?.toLowerCase();
  if (isRenderableBody(part) && part.body?.data) {
    const text = decodeBase64Url(part.body.data);
    if (text) {
      if (mime === 'text/plain') out.plain.push(text);
      if (mime === 'text/html') out.html.push(text);
    }
  }
  for (const child of part.parts ?? []) collectBodyParts(child, out, depth + 1);
}
function boundedJoin(values: string[], maxChars = 500_000): string | undefined {
  if (!values.length) return undefined;
  return values.join('\n').slice(0, maxChars) || undefined;
}
function isDetachedRenderableBody(part: GmailPartLike): boolean {
  return isRenderableBody(part) && Boolean(part.body?.attachmentId?.trim() && !part.body?.data);
}
async function gmailJson(urlPath: string, token: string): Promise<any> {
  for (let attempt = 0; ; attempt += 1) {
    await sleep(120);
    const response = await fetch(`${GMAIL_BASE}${urlPath}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (response.ok) return await response.json();
    const detail = await response.text().catch(() => '');
    if ([408,429,500,502,503,504].includes(response.status) && attempt < RETRY_MS.length) {
      await sleep(RETRY_MS[attempt]!);
      continue;
    }
    throw new Error(`GMAIL_HTTP_${response.status}:${detail.replace(/\s+/g,' ').slice(0,200)}`);
  }
}
async function hydrateDetachedBodies(part: GmailPartLike | undefined, messageId: string, token: string): Promise<number> {
  if (!part) return 0;
  let hydrated = 0;
  if (isDetachedRenderableBody(part)) {
    const attachmentId = part.body!.attachmentId!.trim();
    const payload = await gmailJson(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, token);
    if (typeof payload.data !== 'string' || !payload.data) throw new Error('DETACHED_BODY_ATTACHMENT_EMPTY');
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
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('').trim();
}
function safePrediction(value: any) {
  if (!value || typeof value !== 'object') throw new Error('OUTPUT_NOT_OBJECT');
  const prediction = {
    event_type: value.event_type,
    perspective: value.perspective,
    order_id: value.order_id ?? null,
    tracking_id: value.tracking_id ?? null,
    link_status: value.link_status,
  };
  if (!EVENTS.includes(prediction.event_type)) throw new Error('BAD_EVENT_TYPE');
  if (!PERSPECTIVES.includes(prediction.perspective)) throw new Error('BAD_PERSPECTIVE');
  if (!LINKS.includes(prediction.link_status)) throw new Error('BAD_LINK_STATUS');
  return prediction;
}
async function callLuna(apiKey: string, emailText: string) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        instructions: SYSTEM,
        input: `Email:\n\n${emailText}`,
        reasoning: { effort: 'low' },
        text: { verbosity: 'low', format: { type: 'json_schema', name: 'buyflow_email_classification', strict: true, schema: SCHEMA } },
        max_output_tokens: 512,
        store: false,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      const text = extractOutputText(data);
      if (!text) throw new Error('OPENAI_NO_OUTPUT');
      return { pred: safePrediction(JSON.parse(text)), usage: data.usage ?? {} };
    }
    const detail = await response.text().catch(() => '');
    if ([408,429,500,502,503,504].includes(response.status) && attempt < RETRY_MS.length) {
      await sleep(RETRY_MS[attempt]!);
      continue;
    }
    throw new Error(`OPENAI_HTTP_${response.status}:${detail.slice(0,300)}`);
  }
}

async function main() {
  const idsPath = process.argv[2];
  const outPath = process.argv[3] || path.join(path.dirname(idsPath ?? '.'), 'real100-h2-maillens-v2-prompt-v2-luna-predictions-private-local.json');
  const gmailToken = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!idsPath) throw new Error('USAGE: <real100-h2-ids-private-local.json> [out.json]');
  if (!gmailToken) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  if (MAIL_LENS_TEXT_VERSION !== 'mail-lens-text-v2') throw new Error(`MAIL_LENS_VERSION_INVALID:${MAIL_LENS_TEXT_VERSION}`);

  const idsDoc = JSON.parse(await readFile(idsPath, 'utf8'));
  const ids = Array.isArray(idsDoc) ? idsDoc : idsDoc?.ids;
  if (!Array.isArray(ids) || ids.length !== EXPECTED_COUNT || ids.some((id: unknown) => typeof id !== 'string' || !id.trim())) {
    throw new Error('H2_IDS_INVALID');
  }
  const selectionSha = sha256(ids.join('\n'));
  if (selectionSha !== EXPECTED_SELECTION_SHA) throw new Error(`H2_SELECTION_SHA_INVALID:${selectionSha}`);
  if (idsDoc?.selection_sha256 && idsDoc.selection_sha256 !== selectionSha) throw new Error('H2_IDS_DOCUMENT_SHA_INVALID');

  console.log('==============================================================');
  console.log('BUYFLOW REAL100 H2 - MAILLENS v2 + GPT-5.6 LUNA (FIXED)');
  console.log('Same frozen 100 H2 emails | Frozen Prompt V2 | prediction only');
  console.log('Gmail GET only | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('==============================================================');

  const rows: any[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  let technicalErrors = 0;
  let hiddenRemoved = 0;
  let quotedDetected = 0;
  let emptySemantic = 0;
  const started = Date.now();

  for (let index = 0; index < ids.length; index += 1) {
    const id = String(ids[index]);
    const caseId = `H2-${String(index + 1).padStart(3, '0')}`;
    const row: any = { case_id: caseId, prediction: null, error: null, elapsed_ms: null, mail_lens: null };
    const t0 = Date.now();
    try {
      const message = await gmailJson(`/messages/${encodeURIComponent(id)}?format=full`, gmailToken) as GmailMessageLike;
      if (message.id !== id) throw new Error('GMAIL_ID_MISMATCH');
      const detached = await hydrateDetachedBodies(message.payload, id, gmailToken);
      const bodies = { plain: [] as string[], html: [] as string[] };
      collectBodyParts(message.payload, bodies);
      const lens = normalizeMailLensText({
        bodyText: boundedJoin(bodies.plain),
        bodyHtml: boundedJoin(bodies.html),
        snippet: message.snippet,
      });
      const semanticText = lens.semanticText ?? '';
      if (lens.normalization.hiddenHtmlRemoved) hiddenRemoved += 1;
      if (lens.normalization.quotedHistoryDetected) quotedDetected += 1;
      if (!semanticText.trim()) emptySemantic += 1;
      const emailText = `Feladó: ${headerValue(message.payload, 'From') ?? ''}\nTárgy: ${headerValue(message.payload, 'Subject') ?? ''}\n\n${semanticText}`;
      const result = await callLuna(apiKey, emailText);
      row.prediction = result.pred;
      row.mail_lens = {
        version: lens.normalization.version,
        source: lens.normalization.bodyTextSource,
        semantic_chars: semanticText.length,
        hidden_html_removed: lens.normalization.hiddenHtmlRemoved,
        quoted_history_detected: lens.normalization.quotedHistoryDetected,
        provider_placeholder_ignored: lens.normalization.providerPlaceholderIgnored,
        semantic_text_truncated: lens.normalization.semanticTextTruncated,
        detached_bodies_hydrated: detached,
      };
      usage.input_tokens += Number(result.usage?.input_tokens ?? 0);
      usage.output_tokens += Number(result.usage?.output_tokens ?? 0);
      usage.reasoning_tokens += Number(result.usage?.output_tokens_details?.reasoning_tokens ?? 0);
      row.elapsed_ms = Date.now() - t0;
      console.log(`[${String(index + 1).padStart(3,'0')}/100] ${caseId} OK ${row.elapsed_ms}ms chars=${semanticText.length}`);
    } catch (error) {
      technicalErrors += 1;
      row.error = error instanceof Error ? error.message : String(error);
      row.elapsed_ms = Date.now() - t0;
      console.log(`[${String(index + 1).padStart(3,'0')}/100] ${caseId} ERROR ${row.error}`);
    }
    rows.push(row);
  }

  const summary = {
    benchmark: 'buyflow-real100-h2-maillens-v2-prompt-v2-luna-predictions',
    created_at: new Date().toISOString(),
    selection_sha256: selectionSha,
    mail_lens_version: MAIL_LENS_TEXT_VERSION,
    prompt_version: 'merchant-outbound-linking-v2-frozen',
    model: MODEL,
    total: EXPECTED_COUNT,
    technical_errors: technicalErrors,
    elapsed_ms: Date.now() - started,
    usage,
    normalization_summary: { hidden_html_removed: hiddenRemoved, quoted_history_detected: quotedDetected, empty_semantic_text: emptySemantic },
    safety: { gmail_get_only: true, buyflow_writes: 0, production_off: true, blind_o3_used: false, openai_store: false },
    gold_labels_included: false,
    raw_email_content_included: false,
    rows,
  };
  await writeFile(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('');
  console.log('================ MAILLENS v2 + LUNA READY =================');
  console.log(`Technical errors: ${technicalErrors}/100`);
  console.log(`MailLens: hidden=${hiddenRemoved}, quoted=${quotedDetected}, empty=${emptySemantic}`);
  console.log(`Luna tokens: in=${usage.input_tokens} out=${usage.output_tokens} reasoning=${usage.reasoning_tokens}`);
  console.log(`Result: ${outPath}`);
  console.log('Upload ONLY this result JSON to ChatGPT for scoring/comparison.');
  console.log('===========================================================');
}

main().catch(error => {
  console.error(`REAL100_H2_MAILLENS_V2_LUNA_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});