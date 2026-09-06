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

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_COUNT = 120;
const RETRY_MS = [500, 1500, 4000] as const;

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

async function writeProgress(path: string | undefined, state: Record<string, unknown>): Promise<void> {
  if (!path) return;
  try { await writeFile(path, JSON.stringify(state), 'utf8'); } catch { /* progress is non-authoritative */ }
}

async function main() {
  const idFile = process.argv[2];
  const reportPath = process.argv[3];
  const progressPath = process.argv[4];
  if (!idFile || !reportPath) throw new Error('USAGE: <id-file.json> <report-path.json> [progress-path.json]');

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
  const startedAt = Date.now();
  let detachedBodiesHydrated = 0;
  let okCount = 0;
  let failedCount = 0;
  let retryCount = 0;

  console.log('');
  console.log('==============================================================');
  console.log('BUYFLOW EVENTMIND V13 CANDIDATE - REAL GMAIL DEV120');
  console.log('DEVELOPMENT SET - GROUND TRUTH ALREADY READ - NOT A BLIND HOLDOUT');
  console.log('READ ONLY - NO MAILBOX WRITE - NO BUYFLOW DB WRITE');
  console.log('==============================================================');
  console.log(`Frozen ID SHA256: ${idSetSha256}`);

  await writeProgress(progressPath, { state: 'running', completed: 0, total: ids.length, percent: 0, ok: 0, failed: 0, elapsed_seconds: 0, eta_seconds: null, suite: 'V13 DEV120' });

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
      attempts: 0,
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
      const inference = await runEventMindV13(document);
      row.attempts = inference.ok ? inference.runtime.attempts : inference.attempts;
      retryCount += Math.max(0, row.attempts - 1);
      if (!inference.ok) {
        row.failure = { reason: inference.reason, ...(inference.detail ? { detail: inference.detail } : {}) };
        failedCount += 1;
        console.log(`[${index + 1}/${ids.length}] FAIL ${inference.reason}${inference.detail ? `:${inference.detail}` : ''}`);
      } else {
        row.ok = true;
        row.prediction = inference.prediction;
        row.runtime = inference.runtime;
        okCount += 1;
        eventCounts[inference.prediction.event_type] = (eventCounts[inference.prediction.event_type] ?? 0) + 1;
        console.log(`[${index + 1}/${ids.length}] OK ${inference.prediction.event_type}`);
      }
    } catch (error) {
      row.failure = { reason: 'TEST_CASE_ERROR', detail: error instanceof Error ? error.message : String(error) };
      failedCount += 1;
      console.log(`[${index + 1}/${ids.length}] ERROR ${row.failure.detail}`);
    }
    results.push(row);

    const completed = index + 1;
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const rate = completed / elapsedSeconds;
    const etaSeconds = rate > 0 ? Math.round((ids.length - completed) / rate) : null;
    const percent = Math.round((completed / ids.length) * 1000) / 10;
    await writeProgress(progressPath, {
      state: 'running', completed, total: ids.length, percent, ok: okCount, failed: failedCount,
      elapsed_seconds: elapsedSeconds, eta_seconds: etaSeconds, suite: 'V13 DEV120',
    });
  }

  const report = {
    suite: 'EVENTMIND_V13_CANDIDATE_REAL_GMAIL_DEV120_V1',
    created_at: new Date().toISOString(),
    development_set: true,
    blind_holdout: false,
    ground_truth_read_before_candidate_run: true,
    selection: { expected_count: EXPECTED_COUNT, frozen_id_sha256: idSetSha256 },
    total: ids.length,
    predictions_ok: okCount,
    predictions_failed: failedCount,
    technical_retries: retryCount,
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

  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  await writeProgress(progressPath, {
    state: failedCount === 0 ? 'complete' : 'complete_with_errors', completed: ids.length, total: ids.length,
    percent: 100, ok: okCount, failed: failedCount, elapsed_seconds: elapsedSeconds, eta_seconds: 0, suite: 'V13 DEV120',
  });

  console.log('');
  console.log('==================== SUMMARY ===================');
  console.log(`Predictions OK:     ${okCount}/${ids.length}`);
  console.log(`Prediction errors:  ${failedCount}`);
  console.log(`Technical retries:  ${retryCount}`);
  console.log('Mailbox writes:     0');
  console.log('BuyFlow DB writes:  0');
  console.log(`Report:             ${reportPath}`);
  console.log(failedCount === 0 ? 'DEV120: COMPLETE' : 'DEV120: COMPLETE WITH ERRORS');
  console.log('================================================');
  process.exitCode = failedCount === 0 ? 0 : 2;
}

main().catch((error) => {
  console.error(`V13_DEV120_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
