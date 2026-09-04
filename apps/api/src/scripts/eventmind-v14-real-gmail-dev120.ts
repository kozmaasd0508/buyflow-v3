import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import { decodeEventMindPredictionV1 } from '../ai/eventmind-v1.js';
import { buildEventMindV14Messages, EVENTMIND_V14_PROMPT_VERSION } from '../ai/eventmind-v14-zero-shot.js';

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

interface V14RuntimeResponse {
  protocol_version: 'buyflow-eventmind-v14-base-runtime-v1';
  model_id: 'Qwen/Qwen3-8B';
  adapter: null;
  runtime_version: 'eventmind-v14-base-runtime-v1';
  template_version: 'qwen3-system-user-thinking-off-v1';
  thinking_enabled: false;
  deterministic: true;
  output: string;
}

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_COUNT = 120;
const RETRY_MS = [500, 1500, 4000] as const;
const RUNTIME_URL = process.env.BUYFLOW_EVENTMIND_V14_BASE_RUNTIME_URL?.trim() || 'http://127.0.0.1:4395/v1/eventmind';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function gmailJson(path: string, accessToken: string): Promise<any> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${GMAIL_BASE}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return await response.json();
    if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < RETRY_MS.length) {
      await sleep(RETRY_MS[attempt] ?? 0);
      continue;
    }
    throw new Error(`GMAIL_HTTP_${response.status}:${path.split('?')[0]}`);
  }
}
function headerValue(part: GmailPartLike, name: string): string | null {
  const expected = name.toLowerCase();
  const found = (part.headers ?? []).find((header) => header.name?.toLowerCase() === expected);
  return found?.value ?? null;
}
function isDetachedRenderableBody(part: GmailPartLike): boolean {
  const mime = part.mimeType?.toLowerCase();
  if (mime !== 'text/plain' && mime !== 'text/html') return false;
  if (part.filename?.trim()) return false;
  const disposition = headerValue(part, 'Content-Disposition')?.toLowerCase() ?? '';
  if (/\battachment\b/.test(disposition)) return false;
  return Boolean(part.body?.attachmentId?.trim() && !part.body?.data);
}
async function hydrateDetachedBodies(part: GmailPartLike | undefined, messageId: string, accessToken: string): Promise<number> {
  if (!part) return 0;
  let hydrated = 0;
  if (isDetachedRenderableBody(part)) {
    const attachmentId = part.body!.attachmentId!.trim();
    const payload = await gmailJson(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, accessToken);
    if (typeof payload.data !== 'string' || payload.data.length === 0) throw new Error('DETACHED_BODY_ATTACHMENT_EMPTY');
    part.body = { ...part.body, data: payload.data, ...(typeof payload.size === 'number' ? { size: payload.size } : {}) };
    hydrated += 1;
  }
  for (const child of part.parts ?? []) hydrated += await hydrateDetachedBodies(child, messageId, accessToken);
  return hydrated;
}
async function infer(systemPrompt: string, userPrompt: string) {
  const response = await fetch(RUNTIME_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      protocol_version: 'buyflow-eventmind-v14-base-runtime-v1',
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      generation: { do_sample: false, enable_thinking: false, max_new_tokens: 48 },
    }),
  });
  if (!response.ok) throw new Error(`V14_RUNTIME_HTTP_${response.status}`);
  const payload = await response.json() as V14RuntimeResponse;
  if (
    payload.protocol_version !== 'buyflow-eventmind-v14-base-runtime-v1'
    || payload.model_id !== 'Qwen/Qwen3-8B'
    || payload.adapter !== null
    || payload.runtime_version !== 'eventmind-v14-base-runtime-v1'
    || payload.template_version !== 'qwen3-system-user-thinking-off-v1'
    || payload.thinking_enabled !== false
    || payload.deterministic !== true
    || typeof payload.output !== 'string'
  ) throw new Error('V14_RUNTIME_METADATA_MISMATCH');
  const decoded = decodeEventMindPredictionV1(payload.output);
  if (!decoded.ok) throw new Error(`V14_INVALID_MODEL_OUTPUT:${decoded.reason}`);
  return decoded.prediction;
}

async function main() {
  const idFile = process.argv[2];
  const reportPath = process.argv[3];
  if (!idFile || !reportPath) throw new Error('USAGE: <id-file.json> <report-path.json>');

  const parsed = JSON.parse(await readFile(idFile, 'utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) throw new Error('ID_FILE_INVALID');
  const ids = parsed.map((value) => value.trim());
  if (ids.length !== EXPECTED_COUNT) throw new Error(`EXPECTED_${EXPECTED_COUNT}_IDS_GOT_${ids.length}`);
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_GMAIL_ID');

  const accessToken = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const idSetSha256 = sha256(ids.join('\n'));
  const results: any[] = [];
  const eventCounts: Record<string, number> = {};
  let detachedBodiesHydrated = 0;
  let okCount = 0;
  let failedCount = 0;

  console.log('');
  console.log('==============================================================');
  console.log('BUYFLOW EVENTMIND V14 ZERO-SHOT - BASE QWEN3-8B - REAL120 DEV');
  console.log('DEVELOPMENT SET - NOT A BLIND HOLDOUT - NO LORA');
  console.log('READ ONLY - NO MAILBOX WRITE - NO BUYFLOW DB WRITE');
  console.log('==============================================================');
  console.log(`Frozen ID SHA256: ${idSetSha256}`);

  for (let index = 0; index < ids.length; index += 1) {
    const gmailId = ids[index]!;
    const row: any = {
      index: index + 1,
      gmail_id_sha256: sha256(gmailId),
      ok: false,
      prediction: null,
      failure: null,
      mail_lens_normalizer: null,
      detached_bodies_hydrated: 0,
    };
    try {
      const message = await gmailJson(`/messages/${encodeURIComponent(gmailId)}?format=full`, accessToken) as GmailMessageLike;
      if (message.id !== gmailId) throw new Error('GMAIL_ID_MISMATCH');
      const hydrated = await hydrateDetachedBodies(message.payload, gmailId, accessToken);
      detachedBodiesHydrated += hydrated;
      row.detached_bodies_hydrated = hydrated;

      const normalized = normalizeGmailMessage(message as any);
      const document = normalizeEmailDocumentV1(normalized);
      row.mail_lens_normalizer = document.normalizerVersion;
      const messages = buildEventMindV14Messages(document);
      const prediction = await infer(messages.system, messages.user);
      row.ok = true;
      row.prediction = prediction;
      okCount += 1;
      eventCounts[prediction.event_type] = (eventCounts[prediction.event_type] ?? 0) + 1;
      console.log(`[${index + 1}/${ids.length}] OK ${prediction.event_type}`);
    } catch (error) {
      row.failure = { reason: 'TEST_CASE_ERROR', detail: error instanceof Error ? error.message : String(error) };
      failedCount += 1;
      console.log(`[${index + 1}/${ids.length}] ERROR ${row.failure.detail}`);
    }
    results.push(row);
  }

  const report = {
    suite: 'EVENTMIND_V14_ZERO_SHOT_BASE_QWEN3_8B_REAL120_DEV_V1',
    created_at: new Date().toISOString(),
    prompt_version: EVENTMIND_V14_PROMPT_VERSION,
    model_id: 'Qwen/Qwen3-8B',
    lora_adapter_used: false,
    development_set: true,
    blind_holdout: false,
    selection: { expected_count: EXPECTED_COUNT, frozen_id_sha256: idSetSha256 },
    total: ids.length,
    predictions_ok: okCount,
    predictions_failed: failedCount,
    detached_bodies_hydrated: detachedBodiesHydrated,
    event_counts: eventCounts,
    safety: {
      gmail_http_methods: ['GET'], mailbox_mutations: 0, buyflow_db_writes: 0,
      source_archive_writes: 0, purchase_writes: 0, shipment_writes: 0, document_writes: 0,
      production_flags_enabled: false, message_content_persisted_in_report: false, raw_gmail_ids_persisted_in_report: false,
    },
    results,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log('==================== SUMMARY ===================');
  console.log(`Predictions OK:     ${okCount}/${ids.length}`);
  console.log(`Prediction errors:  ${failedCount}`);
  console.log('Mailbox writes:     0');
  console.log('BuyFlow DB writes:  0');
  console.log(`Report:             ${reportPath}`);
  console.log(failedCount === 0 ? 'V14 DEV120: COMPLETE' : 'V14 DEV120: COMPLETE WITH ERRORS');
  console.log('================================================');
  process.exitCode = failedCount === 0 ? 0 : 2;
}

main().catch((error) => {
  console.error(`V14_DEV120_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
