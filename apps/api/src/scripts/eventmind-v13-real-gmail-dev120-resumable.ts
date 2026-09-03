import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import { runEventMindV13 } from '../ai/eventmind-v13-candidate.js';

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

interface CheckpointV1 {
  schema_version: 1;
  frozen_id_sha256: string;
  next_index: number;
  results: any[];
  event_counts: Record<string, number>;
  ok_count: number;
  failed_count: number;
  detached_bodies_hydrated: number;
  technical_retries: number;
  runtime_restarts_requested: number;
  timeout_retries_by_index: Record<string, number>;
  started_at_ms: number;
}

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_COUNT = 120;
const RETRY_MS = [500, 1500, 4000] as const;
const EXIT_RUNTIME_RESTART = 75;
const EXIT_AUTH_REFRESH = 76;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function interCaseDelayMs(): number {
  const parsed = Number(process.env.BUYFLOW_EVENTMIND_INTER_CASE_DELAY_MS ?? '750');
  if (!Number.isFinite(parsed)) return 750;
  return Math.max(0, Math.min(5_000, Math.round(parsed)));
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

async function loadCheckpoint(path: string, frozenIdSha256: string): Promise<CheckpointV1 | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CheckpointV1;
    if (parsed?.schema_version !== 1 || parsed.frozen_id_sha256 !== frozenIdSha256) return null;
    if (!Array.isArray(parsed.results) || !Number.isInteger(parsed.next_index)) return null;
    return parsed;
  } catch {
    return null;
  }
}
async function saveCheckpoint(path: string, checkpoint: CheckpointV1): Promise<void> {
  await writeFile(path, JSON.stringify(checkpoint, null, 2), 'utf8');
}
function reportFrom(checkpoint: CheckpointV1, total: number) {
  return {
    suite: 'EVENTMIND_V13_LITE_REAL_GMAIL_DEV120_RESUMABLE_V1',
    created_at: new Date().toISOString(),
    development_set: true,
    blind_holdout: false,
    ground_truth_read_before_candidate_run: true,
    selection: { expected_count: EXPECTED_COUNT, frozen_id_sha256: checkpoint.frozen_id_sha256 },
    total,
    predictions_ok: checkpoint.ok_count,
    predictions_failed: checkpoint.failed_count,
    technical_retries: checkpoint.technical_retries,
    runtime_restarts_requested: checkpoint.runtime_restarts_requested,
    detached_bodies_hydrated: checkpoint.detached_bodies_hydrated,
    event_counts: checkpoint.event_counts,
    safety: {
      gmail_http_methods: ['GET'], mailbox_mutations: 0, buyflow_db_writes: 0,
      source_archive_writes: 0, purchase_writes: 0, shipment_writes: 0, document_writes: 0,
      production_flags_enabled: false, message_content_persisted_in_report: false, raw_gmail_ids_persisted_in_report: false,
    },
    results: checkpoint.results,
  };
}

async function main() {
  const idFile = process.argv[2];
  const reportPath = process.argv[3];
  const checkpointPath = process.argv[4];
  if (!idFile || !reportPath || !checkpointPath) throw new Error('USAGE: <id-file.json> <report-path.json> <checkpoint-path.json>');

  const parsed = JSON.parse(await readFile(idFile, 'utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) throw new Error('ID_FILE_INVALID');
  const ids = parsed.map((value) => value.trim());
  if (ids.length !== EXPECTED_COUNT) throw new Error(`EXPECTED_${EXPECTED_COUNT}_IDS_GOT_${ids.length}`);
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_GMAIL_ID');

  const accessToken = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const frozenIdSha256 = sha256(ids.join('\n'));
  const existing = await loadCheckpoint(checkpointPath, frozenIdSha256);
  const checkpoint: CheckpointV1 = existing ?? {
    schema_version: 1,
    frozen_id_sha256: frozenIdSha256,
    next_index: 0,
    results: [],
    event_counts: {},
    ok_count: 0,
    failed_count: 0,
    detached_bodies_hydrated: 0,
    technical_retries: 0,
    runtime_restarts_requested: 0,
    timeout_retries_by_index: {},
    started_at_ms: Date.now(),
  };

  console.log('');
  console.log('==============================================================');
  console.log('BUYFLOW EVENTMIND V13-LITE - REAL GMAIL DEV120 RESUMABLE');
  console.log('DIRECT / READ ONLY / NO TESTLAB / NO PRODUCTION WRITES');
  console.log('==============================================================');
  console.log(`Frozen ID SHA256: ${frozenIdSha256}`);
  if (checkpoint.next_index > 0) console.log(`RESUME: ${checkpoint.next_index}/${ids.length} already saved`);

  const delayMs = interCaseDelayMs();
  for (let index = checkpoint.next_index; index < ids.length; index += 1) {
    const gmailId = ids[index]!;
    const row: any = {
      index: index + 1,
      gmail_id_sha256: sha256(gmailId),
      ok: false,
      prediction: null,
      failure: null,
      mail_lens_normalizer: null,
      detached_bodies_hydrated: 0,
      attempts: 0,
    };

    try {
      const message = await gmailJson(`/messages/${encodeURIComponent(gmailId)}?format=full`, accessToken) as GmailMessageLike;
      if (message.id !== gmailId) throw new Error('GMAIL_ID_MISMATCH');
      const hydrated = await hydrateDetachedBodies(message.payload, gmailId, accessToken);
      checkpoint.detached_bodies_hydrated += hydrated;
      row.detached_bodies_hydrated = hydrated;

      const normalized = normalizeGmailMessage(message as any);
      const document = normalizeEmailDocumentV1(normalized);
      row.mail_lens_normalizer = document.normalizerVersion;
      const inference = await runEventMindV13(document);
      row.attempts = inference.ok ? inference.runtime.attempts : inference.attempts;
      checkpoint.technical_retries += Math.max(0, row.attempts - 1);

      if (!inference.ok && inference.reason === 'RUNTIME_TIMEOUT') {
        const key = String(index);
        const previous = checkpoint.timeout_retries_by_index[key] ?? 0;
        if (previous < 1) {
          checkpoint.timeout_retries_by_index[key] = previous + 1;
          checkpoint.runtime_restarts_requested += 1;
          checkpoint.next_index = index;
          await saveCheckpoint(checkpointPath, checkpoint);
          await writeFile(reportPath, JSON.stringify(reportFrom(checkpoint, ids.length), null, 2), 'utf8');
          console.log(`[${index + 1}/${ids.length}] TIMEOUT -> RESTART QWEN, RETRY SAME EMAIL`);
          process.exitCode = EXIT_RUNTIME_RESTART;
          return;
        }
        row.failure = { reason: 'RUNTIME_TIMEOUT', detail: 'timeout persisted after one clean runtime restart' };
        row.runtime_restart_retry_exhausted = true;
        checkpoint.failed_count += 1;
        console.log(`[${index + 1}/${ids.length}] FAIL RUNTIME_TIMEOUT after clean restart`);
      } else if (!inference.ok) {
        row.failure = { reason: inference.reason, ...(inference.detail ? { detail: inference.detail } : {}) };
        checkpoint.failed_count += 1;
        console.log(`[${index + 1}/${ids.length}] FAIL ${inference.reason}${inference.detail ? `:${inference.detail}` : ''}`);
      } else {
        row.ok = true;
        row.prediction = inference.prediction;
        row.runtime = inference.runtime;
        checkpoint.ok_count += 1;
        checkpoint.event_counts[inference.prediction.event_type] = (checkpoint.event_counts[inference.prediction.event_type] ?? 0) + 1;
        console.log(`[${index + 1}/${ids.length}] OK ${inference.prediction.event_type}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.startsWith('GMAIL_HTTP_401:')) {
        checkpoint.next_index = index;
        await saveCheckpoint(checkpointPath, checkpoint);
        await writeFile(reportPath, JSON.stringify(reportFrom(checkpoint, ids.length), null, 2), 'utf8');
        console.log(`[${index + 1}/${ids.length}] GMAIL TOKEN EXPIRED -> REFRESH AND RESUME`);
        process.exitCode = EXIT_AUTH_REFRESH;
        return;
      }
      row.failure = { reason: 'TEST_CASE_ERROR', detail };
      checkpoint.failed_count += 1;
      console.log(`[${index + 1}/${ids.length}] ERROR ${detail}`);
    }

    checkpoint.results.push(row);
    checkpoint.next_index = index + 1;
    await saveCheckpoint(checkpointPath, checkpoint);
    await writeFile(reportPath, JSON.stringify(reportFrom(checkpoint, ids.length), null, 2), 'utf8');
    if (delayMs > 0 && index + 1 < ids.length) await sleep(delayMs);
  }

  const report = reportFrom(checkpoint, ids.length);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log('==================== SUMMARY ===================');
  console.log(`Predictions OK:     ${checkpoint.ok_count}/${ids.length}`);
  console.log(`Prediction errors:  ${checkpoint.failed_count}`);
  console.log(`Runtime restarts:   ${checkpoint.runtime_restarts_requested}`);
  console.log('Mailbox writes:     0');
  console.log('BuyFlow DB writes:  0');
  console.log(`Report:             ${reportPath}`);
  console.log(checkpoint.failed_count === 0 ? 'DEV120: COMPLETE' : 'DEV120: COMPLETE WITH ERRORS');
  console.log('================================================');
  process.exitCode = checkpoint.failed_count === 0 ? 0 : 2;
}

main().catch((error) => {
  console.error(`V13_DEV120_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
