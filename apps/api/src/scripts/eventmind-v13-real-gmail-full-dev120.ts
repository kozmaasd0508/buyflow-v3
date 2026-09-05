import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import { runEventMindV13 } from '../ai/eventmind-v13-candidate.js';

interface GmailBodyLike { attachmentId?: string; size?: number; data?: string }
interface GmailHeaderLike { name?: string; value?: string }
interface GmailPartLike { mimeType?: string; filename?: string; headers?: GmailHeaderLike[]; body?: GmailBodyLike; parts?: GmailPartLike[] }
interface GmailMessageLike { id?: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPartLike }

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_COUNT = 120;
const EXPECTED_ID_SHA256 = '88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470';
const SUITE = 'EVENTMIND_V13_REAL120_FULL_EMAIL_GEMMA_DEV_V1';
const MEMORY_GUARD_PERCENT = 92;
const DEFAULT_MAX_CASES_PER_PROCESS = 15;

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function systemMemory() {
  const total = os.totalmem(); const free = os.freemem();
  return { total_bytes: total, free_bytes: free, used_percent: Math.round(((total - free) / total) * 1000) / 10 };
}

async function gmailJson(path: string, accessToken: string): Promise<any> {
  const response = await fetch(`${GMAIL_BASE}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`GMAIL_HTTP_${response.status}:${path.split('?')[0]}`);
  return await response.json();
}

function headerValue(part: GmailPartLike, name: string): string | null {
  return (part.headers ?? []).find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}
function isDetachedRenderableBody(part: GmailPartLike): boolean {
  const mime = part.mimeType?.toLowerCase();
  if (mime !== 'text/plain' && mime !== 'text/html') return false;
  if (part.filename?.trim()) return false;
  if (/\battachment\b/.test(headerValue(part, 'Content-Disposition')?.toLowerCase() ?? '')) return false;
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

function isRestartFailure(reason: string | undefined, detail?: string): boolean {
  return reason === 'RUNTIME_TIMEOUT' || (reason === 'RUNTIME_HTTP_ERROR' && detail === 'HTTP 503');
}

function blankReport(idSha: string) {
  return {
    suite: SUITE,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    development_set: true,
    blind_holdout: false,
    frozen_id_sha256: idSha,
    safety: {
      gmail_http_methods: ['GET'], mailbox_mutations: 0, buyflow_db_writes: 0, production_flags_enabled: false,
      raw_gmail_ids_persisted_in_report: false, message_content_persisted_in_report: false,
    },
    settings: { input_mode: 'full_mail_lens_semantic_text_once', chunking: false, final_judge: false, memory_guard_percent: MEMORY_GUARD_PERCENT },
    results: [] as any[],
    summary: {} as Record<string, unknown>,
    complete: false,
  };
}

function updateSummary(report: any) {
  const results = report.results as any[];
  const ok = results.filter((r) => r.inference?.ok).length;
  const errors = results.length - ok;
  const runtimeFailures = results.filter((r) => !r.inference?.ok && isRestartFailure(r.inference?.failure?.reason, r.inference?.failure?.detail)).length;
  const maxMemory = Math.max(0, ...results.flatMap((r) => [r.inference?.memory_before?.used_percent ?? 0, r.inference?.memory_after?.used_percent ?? 0]));
  report.updated_at = new Date().toISOString();
  report.summary = { attempted: results.length, inference_ok: ok, inference_errors: errors, runtime_restart_failures: runtimeFailures, max_system_memory_used_percent: maxMemory, next_index: results.length + 1 };
  report.complete = results.length >= EXPECTED_COUNT;
}

async function saveReport(path: string, report: any) {
  updateSummary(report);
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
}

async function main() {
  const idFile = process.argv[2];
  const reportPath = process.argv[3];
  const maxCases = Number(process.argv[4] ?? DEFAULT_MAX_CASES_PER_PROCESS);
  if (!idFile || !reportPath || !Number.isInteger(maxCases) || maxCases < 1 || maxCases > 30) {
    throw new Error('USAGE: <id-file.json> <checkpoint-report.json> [max-cases-1..30]');
  }

  const parsed = JSON.parse(await readFile(idFile, 'utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string')) throw new Error('ID_FILE_INVALID');
  const ids = parsed.map((v) => v.trim());
  if (ids.length !== EXPECTED_COUNT) throw new Error(`EXPECTED_${EXPECTED_COUNT}_IDS_GOT_${ids.length}`);
  const idSha = sha256(ids.join('\n'));
  if (idSha !== EXPECTED_ID_SHA256) throw new Error(`FROZEN_ID_SHA_MISMATCH:${idSha}`);
  const accessToken = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  let report: any;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (report?.suite !== SUITE || report?.frozen_id_sha256 !== idSha || !Array.isArray(report?.results)) throw new Error('CHECKPOINT_INCOMPATIBLE');
  } catch (error) {
    if (error instanceof Error && error.message === 'CHECKPOINT_INCOMPATIBLE') throw error;
    report = blankReport(idSha);
  }

  const startIndex = report.results.length + 1;
  if (startIndex > EXPECTED_COUNT) {
    await saveReport(reportPath, report);
    console.log('REAL120 FULL EMAIL COMPLETE');
    return;
  }

  console.log('');
  console.log('==============================================================');
  console.log('BUYFLOW EVENTMIND - REAL120 FULL EMAIL / NO CHUNKS / NO JUDGE');
  console.log(`RESUME INDEX: ${startIndex} / PROCESS BUDGET: ${maxCases}`);
  console.log('READ ONLY / DEVELOPMENT SET / PRODUCTION OFF');
  console.log('==============================================================');

  let processed = 0;
  for (let humanIndex = startIndex; humanIndex <= EXPECTED_COUNT && processed < maxCases; humanIndex += 1) {
    const beforeCaseMemory = systemMemory();
    if (beforeCaseMemory.used_percent >= MEMORY_GUARD_PERCENT) {
      console.log(`[${humanIndex}/120] MEMORY GUARD BEFORE CASE: ${beforeCaseMemory.used_percent}%`);
      await saveReport(reportPath, report);
      process.exitCode = 42;
      return;
    }

    const gmailId = ids[humanIndex - 1]!;
    let message: GmailMessageLike;
    try {
      message = await gmailJson(`/messages/${encodeURIComponent(gmailId)}?format=full`, accessToken) as GmailMessageLike;
      if (message.id !== gmailId) throw new Error('GMAIL_ID_MISMATCH');
      await hydrateDetachedBodies(message.payload, gmailId, accessToken);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.startsWith('GMAIL_HTTP_401')) {
        await saveReport(reportPath, report);
        process.exitCode = 43;
        return;
      }
      report.results.push({ index: humanIndex, gmail_id_sha256: sha256(gmailId), source: null, inference: { ok: false, event_type: null, failure: { reason: 'GMAIL_OR_NORMALIZE_ERROR', detail } } });
      processed += 1;
      await saveReport(reportPath, report);
      console.log(`[${humanIndex}/120] FAIL GMAIL_OR_NORMALIZE_ERROR`);
      continue;
    }

    const normalized = normalizeGmailMessage(message as any);
    const document = normalizeEmailDocumentV1(normalized);
    const beforeMemory = systemMemory();
    const started = performance.now();
    const inference = await runEventMindV13(document);
    const elapsed = Math.round((performance.now() - started) * 10) / 10;
    const afterMemory = systemMemory();

    const row = {
      index: humanIndex,
      gmail_id_sha256: sha256(gmailId),
      source: {
        semantic_text_chars: (document.semanticText ?? '').length,
        semantic_text_truncated_by_mail_lens: document.normalization.semanticTextTruncated,
        quoted_history_detected: document.normalization.quotedHistoryDetected,
        structured_data_records: document.structuredData.length,
      },
      inference: {
        ok: inference.ok,
        event_type: inference.ok ? inference.prediction.event_type : null,
        failure: inference.ok ? null : { reason: inference.reason, ...(inference.detail ? { detail: inference.detail } : {}) },
        elapsed_ms: elapsed,
        memory_before: beforeMemory,
        memory_after: afterMemory,
      },
    };
    report.results.push(row);
    processed += 1;
    await saveReport(reportPath, report);

    console.log(`[${humanIndex}/120] ${inference.ok ? `FINAL ${inference.prediction.event_type}` : `FAIL ${inference.reason}${inference.detail ? `:${inference.detail}` : ''}`} | full ${(document.semanticText ?? '').length} chars | ${Math.round(elapsed)} ms | RAM ${afterMemory.used_percent}%`);

    if (!inference.ok && isRestartFailure(inference.reason, inference.detail)) {
      process.exitCode = 42;
      return;
    }
    if (afterMemory.used_percent >= MEMORY_GUARD_PERCENT) {
      process.exitCode = 42;
      return;
    }
    await sleep(500);
  }

  await saveReport(reportPath, report);
  if (report.complete) {
    console.log('REAL120 FULL EMAIL COMPLETE');
    process.exitCode = 0;
  } else {
    console.log(`BATCH COMPLETE -> NEXT INDEX ${report.summary.next_index}`);
    process.exitCode = 10;
  }
}

main().catch((error) => {
  console.error(`REAL120_FULL_EMAIL_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});