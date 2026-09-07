import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPartLike;
}
interface GmailListItem { id?: string; threadId?: string }

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const HOLDOUT_COUNT = 60;
const MAX_POOL = 1000;
const QUERY = 'category:purchases';
const SELECTION_SEED = 'buyflow-real60-h1-v1';
const PROMPT_V2_FROZEN_COMMIT = 'f53679cd1411906ec24e9375e89f2787a0d0a093';

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

async function listPurchaseMessages(token: string): Promise<GmailListItem[]> {
  const all: GmailListItem[] = [];
  let pageToken: string | null = null;
  while (all.length < MAX_POOL) {
    const params = new URLSearchParams({ q: QUERY, maxResults: '500' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gmailJson(`/messages?${params.toString()}`, token);
    for (const item of data?.messages ?? []) {
      if (typeof item?.id === 'string' && item.id.trim()) all.push({ id: item.id, threadId: item.threadId });
      if (all.length >= MAX_POOL) break;
    }
    pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : null;
    if (!pageToken) break;
  }
  return all;
}

async function main() {
  const oldIdFile = process.argv[2];
  const outDirArg = process.argv[3];
  if (!oldIdFile || !outDirArg) throw new Error('USAGE: <real120-ids.json> <output-dir>');
  const token = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const oldRaw = JSON.parse(await readFile(oldIdFile, 'utf8')) as unknown;
  if (!Array.isArray(oldRaw) || oldRaw.length !== 120 || oldRaw.some((x) => typeof x !== 'string')) throw new Error('REAL120_ID_FILE_INVALID');
  const oldIds = oldRaw.map((x) => String(x).trim());
  const oldSet = new Set(oldIds);

  const outDir = path.resolve(outDirArg);
  await mkdir(outDir, { recursive: true });

  console.log('==============================================================');
  console.log('BUYFLOW REAL60 H1 - FRESH BLIND HOLDOUT BUNDLE');
  console.log('Fresh Gmail category:purchases sample; REAL120 IDs/threads excluded.');
  console.log('Deterministic content-blind selection. No OpenAI calls.');
  console.log('Gmail GET only | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log(`Prompt V2 frozen commit for later scoring: ${PROMPT_V2_FROZEN_COMMIT}`);
  console.log('==============================================================');

  console.log('[1/4] Excluding REAL120 threads...');
  const oldThreads = new Set<string>();
  for (let i = 0; i < oldIds.length; i += 1) {
    const meta = await gmailJson(`/messages/${encodeURIComponent(oldIds[i]!)}?format=metadata`, token) as GmailMessageLike;
    if (meta.threadId) oldThreads.add(meta.threadId);
    if ((i + 1) % 20 === 0 || i + 1 === oldIds.length) console.log(`  old thread metadata: ${i + 1}/120`);
  }

  console.log('[2/4] Building content-blind candidate pool...');
  const listed = await listPurchaseMessages(token);
  const eligible = listed.filter((x) => x.id && !oldSet.has(x.id) && (!x.threadId || !oldThreads.has(x.threadId)));
  eligible.sort((a, b) => sha256(`${SELECTION_SEED}\n${a.id}`).localeCompare(sha256(`${SELECTION_SEED}\n${b.id}`)));

  const selected: { id: string; threadId: string | null }[] = [];
  const selectedThreads = new Set<string>();
  for (const item of eligible) {
    if (!item.id) continue;
    const threadKey = item.threadId?.trim() || `id:${item.id}`;
    if (selectedThreads.has(threadKey)) continue;
    selectedThreads.add(threadKey);
    selected.push({ id: item.id, threadId: item.threadId?.trim() || null });
    if (selected.length === HOLDOUT_COUNT) break;
  }
  if (selected.length !== HOLDOUT_COUNT) throw new Error(`NOT_ENOUGH_FRESH_PURCHASE_THREADS:${selected.length}`);

  const selectedIds = selected.map((x) => x.id);
  const selectionSha = sha256(selectedIds.join('\n'));
  console.log(`  listed=${listed.length} eligible=${eligible.length} selected=${selected.length}`);
  console.log(`  frozen H1 selection SHA256: ${selectionSha}`);

  console.log('[3/4] Creating MailLens blind views...');
  const cases: any[] = [];
  let hydratedBodies = 0;
  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i]!;
    const message = await gmailJson(`/messages/${encodeURIComponent(item.id)}?format=full`, token) as GmailMessageLike;
    if (message.id !== item.id) throw new Error(`GMAIL_ID_MISMATCH:${i + 1}`);
    const hydrated = await hydrateDetachedBodies(message.payload, item.id, token);
    hydratedBodies += hydrated;
    const normalized = normalizeGmailMessage(message as any);
    const document = normalizeEmailDocumentV1(normalized);
    const semanticText = document.semanticText?.trim() || document.snippet?.trim() || '';
    cases.push({
      case_id: `H1-${String(i + 1).padStart(3, '0')}`,
      from: headerValue(message.payload, 'From') ?? '',
      subject: headerValue(message.payload, 'Subject') ?? '',
      semantic_text: semanticText,
      mail_lens_normalizer: document.normalizerVersion,
      detached_bodies_hydrated: hydrated,
    });
    console.log(`[${String(i + 1).padStart(2, '0')}/60] H1-${String(i + 1).padStart(3, '0')} OK`);
  }

  const rules = [
    'Determine perspective first, then current directly asserted event state, then buyer-side IDs, then link_status.',
    'buyer = mailbox owner is customer/recipient side; merchant_outbound = mailbox owner acts as seller/shipper for pickup, fulfillment or delivery to own customers; non_purchase = marketing/security/survey/preference/other non-purchase.',
    'Carrier collection FROM the mailbox owner/sender is merchant_outbound. A courier accepting a pickup job does not make it buyer-side delivery.',
    'If perspective = merchant_outbound, link_status MUST be not_applicable and order_id/tracking_id MUST be null for BuyFlow buyer-side linking.',
    'Pickup-job IDs, collection-request IDs, fulfillment references and carrier booking references are NOT buyer order/tracking IDs.',
    'linked = buyer lifecycle with exact buyer order id or explicit verified buyer order-to-tracking relation; unresolved = buyer lifecycle without exact link or ambiguous; not_applicable = merchant_outbound/non_purchase/no buyer lifecycle linking.',
    'SHIPMENT_CREATED = label/pre-advice/tracking/collection booking created or pickup accepted/scheduled but physical carrier handoff has not occurred.',
    'SHIPPED = carrier physically collected/accepted parcel from sender; IN_TRANSIT = moving/processed in carrier network; OUT_FOR_DELIVERY = local delivery route; READY_FOR_PICKUP = physically available at pickup point; DELIVERED = recipient handoff completed.',
    'REFUNDED requires completed money return; RETURN requires returned parcel physically received. Requests/labels/processing alone are not settled REFUNDED/RETURN.',
    'Future carrier handoff is not SHIPPED yet. Prefer current message state over quoted/older history. Do not invent IDs.',
  ];

  const bundle = {
    benchmark: 'buyflow-real60-h1-blind-v1',
    created_at: new Date().toISOString(),
    total_cases: HOLDOUT_COUNT,
    selection_sha256: selectionSha,
    selection_method: `Gmail ${QUERY}; exclude REAL120 message IDs and threads; rank by SHA256(seed + message_id); one message per thread; take first ${HOLDOUT_COUNT}`,
    source: 'MailLens subject + sender + semanticText',
    model_predictions_included: false,
    prompt_v2_frozen_commit: PROMPT_V2_FROZEN_COMMIT,
    allowed: {
      event_type: ['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER'],
      perspective: ['buyer','merchant_outbound','non_purchase'],
      link_status: ['linked','unresolved','not_applicable'],
      fields: ['event_type','perspective','order_id','tracking_id','link_status'],
    },
    rules,
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

  const privateIds = {
    benchmark: 'buyflow-real60-h1-private-ids-v1',
    created_at: new Date().toISOString(),
    selection_sha256: selectionSha,
    count: HOLDOUT_COUNT,
    ids: selectedIds,
  };
  const summary = {
    benchmark: 'buyflow-real60-h1-selection-summary-v1',
    created_at: new Date().toISOString(),
    query: QUERY,
    pool_limit: MAX_POOL,
    listed_count: listed.length,
    eligible_after_real120_exclusion: eligible.length,
    selected_count: selected.length,
    real120_ids_excluded: oldSet.size,
    real120_threads_excluded: oldThreads.size,
    one_message_per_thread: true,
    content_blind_selection: true,
    selection_sha256: selectionSha,
    prompt_v2_frozen_commit: PROMPT_V2_FROZEN_COMMIT,
    openai_calls: 0,
    gmail_http_methods: ['GET'],
    buyflow_writes: 0,
    production_off: true,
    blind_o3_used: false,
  };

  const idsPath = path.join(outDir, 'real60-h1-ids-private-local.json');
  const bundlePath = path.join(outDir, 'real60-h1-blind-bundle-private-local.json');
  const summaryPath = path.join(outDir, 'real60-h1-summary.json');
  await writeFile(idsPath, JSON.stringify(privateIds, null, 2) + '\n', 'utf8');
  await writeFile(bundlePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('[4/4] Frozen blind holdout saved.');
  console.log('');
  console.log('================ REAL60 H1 READY ================');
  console.log(`Cases:               ${HOLDOUT_COUNT}`);
  console.log(`Selection SHA256:    ${selectionSha}`);
  console.log(`Blind bundle:        ${bundlePath}`);
  console.log(`Private IDs:         ${idsPath}`);
  console.log(`Summary:             ${summaryPath}`);
  console.log('OpenAI calls:         0');
  console.log('Gmail GET only | BuyFlow writes 0 | Production OFF | Blind O3 NOT USED');
  console.log('=================================================');
}

main().catch((error) => {
  console.error(`REAL60_H1_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
