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
const HOLDOUT_COUNT = 100;
const MAX_POOL = 2000;
const QUERY = 'category:purchases';
const SELECTION_SEED = 'buyflow-real100-h2-v1';
const EXPECTED_NORMALIZER = 'normalized-email-document-v1.1';
const EXPECTED_H1_SELECTION = '32fe2fcbeaeba08594eac5d1f6c56f1449a86d568487b73e68c3346db67f5b5d';
const PROMPT_V2_FROZEN_COMMIT = 'f53679cd1411906ec24e9375e89f2787a0d0a093';
const MAILLENS_PINNED_COMMIT = 'f69195404831323f2783464a61f6f7b7435698b5';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function headerValue(part: GmailPartLike | undefined, name: string): string | null {
  const expected = name.toLowerCase();
  const found = (part?.headers ?? []).find((h) => h.name?.toLowerCase() === expected);
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
function parseIds(doc: any, expectedCount: number, label: string): string[] {
  const raw = Array.isArray(doc) ? doc : doc?.ids;
  if (!Array.isArray(raw) || raw.length !== expectedCount || raw.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new Error(`${label}_IDS_INVALID`);
  }
  return raw.map((x: string) => x.trim());
}
async function collectThreads(ids: string[], token: string, label: string): Promise<Set<string>> {
  const threads = new Set<string>();
  for (let i = 0; i < ids.length; i += 1) {
    const meta = await gmailJson(`/messages/${encodeURIComponent(ids[i]!)}?format=metadata`, token) as GmailMessageLike;
    if (meta.threadId?.trim()) threads.add(meta.threadId.trim());
    if ((i + 1) % 20 === 0 || i + 1 === ids.length) console.log(`  ${label} thread metadata: ${i + 1}/${ids.length}`);
  }
  return threads;
}

async function main() {
  const real120Path = process.argv[2];
  const h1IdsPath = process.argv[3];
  const outDirArg = process.argv[4];
  if (!real120Path || !h1IdsPath || !outDirArg) throw new Error('USAGE: <real120-ids.json> <h1-ids.json> <output-dir>');
  const token = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const real120Doc = JSON.parse(await readFile(real120Path, 'utf8'));
  const h1Doc = JSON.parse(await readFile(h1IdsPath, 'utf8'));
  const real120Ids = parseIds(real120Doc, 120, 'REAL120');
  const h1Ids = parseIds(h1Doc, 60, 'H1');
  if (h1Doc?.selection_sha256 && h1Doc.selection_sha256 !== EXPECTED_H1_SELECTION) throw new Error('H1_SELECTION_SHA_INVALID');

  const excludedIds = new Set([...real120Ids, ...h1Ids]);
  const outDir = path.resolve(outDirArg);
  await mkdir(outDir, { recursive: true });

  console.log('==============================================================');
  console.log('BUYFLOW REAL100 H2 - FRESH BLIND HOLDOUT / MAILLENS v1.1');
  console.log('REAL120 + H1 IDs AND threads excluded. One message per thread.');
  console.log('Selection is deterministic and content-blind. NO OpenAI calls.');
  console.log('Gmail GET only | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('==============================================================');

  console.log('[1/4] Excluding REAL120 + H1 threads...');
  const real120Threads = await collectThreads(real120Ids, token, 'REAL120');
  const h1Threads = await collectThreads(h1Ids, token, 'H1');
  const excludedThreads = new Set([...real120Threads, ...h1Threads]);

  console.log('[2/4] Building content-blind candidate pool...');
  const listed = await listPurchaseMessages(token);
  const eligible = listed.filter((x) => x.id && !excludedIds.has(x.id) && (!x.threadId || !excludedThreads.has(x.threadId)));
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
  console.log(`  frozen H2 selection SHA256: ${selectionSha}`);

  console.log('[3/4] Creating MailLens v1.1 blind views...');
  const cases: any[] = [];
  const sourceCounts: Record<string, number> = {};
  let totalHydrated = 0;
  let semanticEqualsSnippet = 0;
  let semanticTruncated = 0;
  let bodyTruncated = 0;
  for (let i = 0; i < selected.length; i += 1) {
    const item = selected[i]!;
    const caseId = `H2-${String(i + 1).padStart(3, '0')}`;
    const message = await gmailJson(`/messages/${encodeURIComponent(item.id)}?format=full`, token) as GmailMessageLike;
    if (message.id !== item.id) throw new Error(`GMAIL_ID_MISMATCH:${caseId}`);
    const hydrated = await hydrateDetachedBodies(message.payload, item.id, token);
    totalHydrated += hydrated;
    const normalized = normalizeGmailMessage(message as any);
    const document = normalizeEmailDocumentV1(normalized);
    if (document.normalizerVersion !== EXPECTED_NORMALIZER) throw new Error(`STALE_MAILLENS_NORMALIZER:${document.normalizerVersion}`);
    const semanticText = document.semanticText?.trim() || document.snippet?.trim() || '';
    const snippet = document.snippet?.trim() || '';
    const source = document.normalization.bodyTextSource;
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    const sameAsSnippet = Boolean(semanticText && snippet && semanticText === snippet);
    if (sameAsSnippet) semanticEqualsSnippet += 1;
    if (document.normalization.semanticTextTruncated) semanticTruncated += 1;
    if (document.normalization.bodyTextTruncated) bodyTruncated += 1;
    cases.push({
      case_id: caseId,
      from: headerValue(message.payload, 'From') ?? '',
      subject: headerValue(message.payload, 'Subject') ?? '',
      semantic_text: semanticText,
      mail_lens_normalizer: document.normalizerVersion,
      body_text_source: source,
      body_text_chars: document.bodyText?.length ?? 0,
      semantic_text_chars: semanticText.length,
      snippet_chars: snippet.length,
      semantic_equals_snippet: sameAsSnippet,
      body_text_truncated: document.normalization.bodyTextTruncated,
      semantic_text_truncated: document.normalization.semanticTextTruncated,
      quoted_history_detected: document.normalization.quotedHistoryDetected,
      hidden_html_removed: document.normalization.hiddenHtmlRemoved,
      detached_bodies_hydrated: hydrated,
    });
    console.log(`[${String(i + 1).padStart(3, '0')}/100] ${caseId} source=${source} chars=${semanticText.length}`);
  }

  const bundle = {
    benchmark: 'buyflow-real100-h2-blind-maillens-v1.1',
    created_at: new Date().toISOString(),
    total_cases: HOLDOUT_COUNT,
    selection_sha256: selectionSha,
    selection_method: `Gmail ${QUERY}; exclude REAL120 + H1 message IDs and threads; rank by SHA256(seed + message_id); one message per thread; take first ${HOLDOUT_COUNT}`,
    selection_seed: SELECTION_SEED,
    source: 'MailLens subject + sender + semanticText',
    mail_lens_normalizer: EXPECTED_NORMALIZER,
    mail_lens_pinned_commit: MAILLENS_PINNED_COMMIT,
    prompt_v2_frozen_commit: PROMPT_V2_FROZEN_COMMIT,
    model_predictions_included: false,
    gold_labels_included: false,
    allowed: {
      event_type: ['ORDER_CREATED','ORDER_PROCESSING','PAYMENT','INVOICE','SHIPMENT_CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','READY_FOR_PICKUP','DELIVERED','CANCELLED','REFUNDED','RETURN','OTHER'],
      perspective: ['buyer','merchant_outbound','non_purchase'],
      link_status: ['linked','unresolved','not_applicable'],
      fields: ['event_type','perspective','order_id','tracking_id','link_status'],
    },
    privacy: {
      contains_private_email_text: true,
      raw_gmail_ids_included: false,
      model_outputs_included: false,
      gmail_http_methods: ['GET'],
      openai_calls: 0,
      buyflow_writes: 0,
      production_off: true,
      blind_o3_used: false,
    },
    input_audit: {
      source_counts: sourceCounts,
      hydrated_detached_bodies: totalHydrated,
      semantic_equals_gmail_snippet_count: semanticEqualsSnippet,
      semantic_text_truncated_count: semanticTruncated,
      body_text_truncated_count: bodyTruncated,
    },
    cases,
  };

  const privateIds = {
    benchmark: 'buyflow-real100-h2-private-ids-v1',
    created_at: new Date().toISOString(),
    selection_sha256: selectionSha,
    count: HOLDOUT_COUNT,
    ids: selectedIds,
    thread_ids: selected.map((x) => x.threadId),
  };
  const summary = {
    benchmark: 'buyflow-real100-h2-selection-summary-v1',
    created_at: new Date().toISOString(),
    query: QUERY,
    pool_limit: MAX_POOL,
    listed_count: listed.length,
    eligible_after_real120_h1_exclusion: eligible.length,
    selected_count: selected.length,
    real120_ids_excluded: real120Ids.length,
    h1_ids_excluded: h1Ids.length,
    real120_threads_excluded: real120Threads.size,
    h1_threads_excluded: h1Threads.size,
    total_unique_threads_excluded: excludedThreads.size,
    one_message_per_thread: true,
    content_blind_selection: true,
    selection_sha256: selectionSha,
    mail_lens_normalizer: EXPECTED_NORMALIZER,
    mail_lens_pinned_commit: MAILLENS_PINNED_COMMIT,
    prompt_v2_frozen_commit: PROMPT_V2_FROZEN_COMMIT,
    input_audit: bundle.input_audit,
    openai_calls: 0,
    gmail_http_methods: ['GET'],
    buyflow_writes: 0,
    production_off: true,
    blind_o3_used: false,
  };

  const idsPath = path.join(outDir, 'real100-h2-ids-private-local.json');
  const bundlePath = path.join(outDir, 'real100-h2-blind-bundle-maillens-v1.1-private-local.json');
  const summaryPath = path.join(outDir, 'real100-h2-summary.json');
  await writeFile(idsPath, JSON.stringify(privateIds, null, 2) + '\n', 'utf8');
  await writeFile(bundlePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

  console.log('[4/4] H2 frozen blind holdout saved.');
  console.log('');
  console.log('================ REAL100 H2 READY ================');
  console.log(`Cases:                    ${HOLDOUT_COUNT}`);
  console.log(`Selection SHA256:         ${selectionSha}`);
  console.log(`MailLens:                 ${EXPECTED_NORMALIZER}`);
  console.log(`Body source counts:       ${JSON.stringify(sourceCounts)}`);
  console.log(`Semantic == snippet:      ${semanticEqualsSnippet}`);
  console.log(`Semantic truncated:       ${semanticTruncated}`);
  console.log(`Body truncated:           ${bodyTruncated}`);
  console.log(`Blind bundle:             ${bundlePath}`);
  console.log(`Private IDs:              ${idsPath}`);
  console.log(`Summary:                  ${summaryPath}`);
  console.log('OpenAI calls:              0');
  console.log('Gmail GET only | BuyFlow writes 0 | Production OFF | O3 NOT USED');
  console.log('==================================================');
}

main().catch((error) => {
  console.error(`REAL100_H2_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
