import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import { runEventMindV13 } from '../ai/eventmind-v13-candidate.js';
import { decodeEventMindPredictionV1, EVENTMIND_EVENT_TYPES } from '../ai/eventmind-v1.js';
import {
  EVENTMIND_V11_MAX_NEW_TOKENS,
  EVENTMIND_V11_MODEL_ID,
  EVENTMIND_V11_RUNTIME_PROTOCOL,
  EVENTMIND_V11_RUNTIME_VERSION,
  EVENTMIND_V11_TEMPLATE_VERSION,
  eventMindV11RuntimeConfigFromEnvironment,
} from '../ai/eventmind-v11-runtime.js';

interface GmailBodyLike { attachmentId?: string; size?: number; data?: string }
interface GmailHeaderLike { name?: string; value?: string }
interface GmailPartLike { mimeType?: string; filename?: string; headers?: GmailHeaderLike[]; body?: GmailBodyLike; parts?: GmailPartLike[] }
interface GmailMessageLike { id?: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPartLike }

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_COUNT = 120;
const EXPECTED_ID_SHA256 = '88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470';
const SUITE = 'EVENTMIND_V13_LITE_REAL120_CHUNK_JUDGE_DEV_V1';
const CHUNK_MAX_CHARS = 3_000;
const CHUNK_OVERLAP_CHARS = 250;
const MAX_CHUNKS = 24;
const EVIDENCE_WINDOW = 220;
const MAX_EVIDENCE_WINDOWS_PER_CHUNK = 3;
const MAX_JUDGE_PROMPT_CHARS = 9_000;
const MEMORY_GUARD_PERCENT = 92;
const DEFAULT_MAX_CASES_PER_PROCESS = 15;

const LIFECYCLE_TERMS = [
  'out for delivery', 'delivering today', 'delivery today', 'arriving today',
  'kézbesítjük', 'kézbesítés', 'kézbesítő', 'futár', 'ma érkezik', 'ma szállít',
  'shipped', 'dispatched', 'handed to the carrier', 'feladtuk', 'feladva', 'átadtuk a futárnak',
  'in transit', 'úton van', 'szállítás alatt',
  'ready for pickup', 'pickup', 'locker', 'átvehető', 'automatába érkezett', 'csomagpontra érkezett',
  'delivered', 'kézbesítve', 'átvetted',
  'processing', 'feldolgozás', 'packing', 'csomagolás',
  'invoice', 'számla', 'payment', 'fizetés', 'refund', 'visszatérítés',
  'return', 'visszaküldés', 'cancelled', 'canceled', 'törölve',
];

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

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

type CpuSnap = { idle: number; total: number };
function cpuSnap(): CpuSnap {
  let idle = 0; let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}
function cpuPercent(before: CpuSnap, after: CpuSnap): number | null {
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (total <= 0) return null;
  return Math.round((1 - idle / total) * 1000) / 10;
}
function systemMemory() {
  const total = os.totalmem(); const free = os.freemem();
  return { total_bytes: total, free_bytes: free, used_percent: Math.round(((total - free) / total) * 1000) / 10 };
}

function chooseBoundary(text: string, start: number, hardEnd: number): number {
  if (hardEnd >= text.length) return text.length;
  const minBoundary = Math.min(hardEnd, start + Math.floor(CHUNK_MAX_CHARS * 0.65));
  const window = text.slice(minBoundary, hardEnd);
  const newline = window.lastIndexOf('\n');
  if (newline >= 0) return minBoundary + newline + 1;
  const space = window.lastIndexOf(' ');
  if (space >= 0) return minBoundary + space + 1;
  return hardEnd;
}
function chunkText(text: string): Array<{ index: number; start: number; end: number; text: string }> {
  if (text.length === 0) return [{ index: 1, start: 0, end: 0, text: '' }];
  const chunks: Array<{ index: number; start: number; end: number; text: string }> = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    const hardEnd = Math.min(text.length, start + CHUNK_MAX_CHARS);
    const end = chooseBoundary(text, start, hardEnd);
    const piece = text.slice(start, end).trim();
    if (piece || chunks.length === 0) chunks.push({ index: chunks.length + 1, start, end, text: piece });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks;
}

function redactEvidence(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/\b(?=[A-Z0-9-]{7,}\b)(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/gi, '<id>')
    .replace(/\s+/g, ' ')
    .trim();
}
function evidenceWindows(text: string): string[] {
  const lower = text.toLowerCase();
  const windows: Array<{ start: number; end: number }> = [];
  for (const term of LIFECYCLE_TERMS) {
    let offset = 0;
    const needle = term.toLowerCase();
    while (windows.length < MAX_EVIDENCE_WINDOWS_PER_CHUNK) {
      const at = lower.indexOf(needle, offset);
      if (at < 0) break;
      const start = Math.max(0, at - EVIDENCE_WINDOW);
      const end = Math.min(text.length, at + needle.length + EVIDENCE_WINDOW);
      if (!windows.some((w) => Math.max(w.start, start) < Math.min(w.end, end))) windows.push({ start, end });
      offset = at + needle.length;
    }
    if (windows.length >= MAX_EVIDENCE_WINDOWS_PER_CHUNK) break;
  }
  if (windows.length === 0) {
    windows.push({ start: 0, end: Math.min(text.length, 450) });
    if (text.length > 900) windows.push({ start: Math.max(0, text.length - 450), end: text.length });
  }
  return windows.slice(0, MAX_EVIDENCE_WINDOWS_PER_CHUNK).map((w) => redactEvidence(text.slice(w.start, w.end)));
}

async function classifyAggregate(prompt: string) {
  const config = eventMindV11RuntimeConfigFromEnvironment();
  if (!config.enabled) return { ok: false as const, reason: 'RUNTIME_DISABLED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: EVENTMIND_V11_RUNTIME_PROTOCOL,
        prompt,
        generation: { do_sample: false, enable_thinking: false, max_new_tokens: EVENTMIND_V11_MAX_NEW_TOKENS },
      }), signal: controller.signal,
    });
    if (!response.ok) return { ok: false as const, reason: 'RUNTIME_HTTP_ERROR', detail: `HTTP ${response.status}` };
    const payload = await response.json() as any;
    if (
      payload?.protocol_version !== EVENTMIND_V11_RUNTIME_PROTOCOL
      || payload?.model_id !== EVENTMIND_V11_MODEL_ID
      || String(payload?.adapter_sha256 ?? '').toLowerCase() !== config.expectedAdapterSha256
      || payload?.runtime_version !== EVENTMIND_V11_RUNTIME_VERSION
      || payload?.template_version !== EVENTMIND_V11_TEMPLATE_VERSION
      || payload?.thinking_enabled !== false
      || payload?.deterministic !== true
      || typeof payload?.output !== 'string'
    ) return { ok: false as const, reason: 'INVALID_RUNTIME_RESPONSE' };
    const decoded = decodeEventMindPredictionV1(payload.output);
    if (!decoded.ok) return { ok: false as const, reason: 'INVALID_MODEL_OUTPUT', detail: decoded.reason };
    return { ok: true as const, prediction: decoded.prediction };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false as const, reason: 'RUNTIME_TIMEOUT' };
    return { ok: false as const, reason: 'RUNTIME_UNAVAILABLE', detail: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timer); }
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
      final_judge_evidence_text_persisted_in_report: false,
    },
    settings: {
      chunk_max_chars: CHUNK_MAX_CHARS, chunk_overlap_chars: CHUNK_OVERLAP_CHARS, max_chunks: MAX_CHUNKS,
      max_judge_prompt_chars: MAX_JUDGE_PROMPT_CHARS, memory_guard_percent: MEMORY_GUARD_PERCENT,
    },
    results: [] as any[],
    summary: {} as Record<string, unknown>,
    complete: false,
  };
}

function updateSummary(report: any) {
  const results = report.results as any[];
  const finalOk = results.filter((r) => r.final_judge?.ok).length;
  const finalErrors = results.filter((r) => !r.final_judge?.ok).length;
  const chunkInvalids = results.reduce((n, r) => n + (r.chunk_results ?? []).filter((c: any) => !c.ok && c.failure?.reason === 'INVALID_MODEL_OUTPUT').length, 0);
  const runtimeFailures = results.reduce((n, r) => n + (r.chunk_results ?? []).filter((c: any) => isRestartFailure(c.failure?.reason, c.failure?.detail)).length + (isRestartFailure(r.final_judge?.failure?.reason, r.final_judge?.failure?.detail) ? 1 : 0), 0);
  const maxMemory = Math.max(0, ...results.flatMap((r) => [
    ...(r.chunk_results ?? []).flatMap((c: any) => [c.memory_before?.used_percent ?? 0, c.memory_after?.used_percent ?? 0]),
    r.final_judge?.memory_before?.used_percent ?? 0,
    r.final_judge?.memory_after?.used_percent ?? 0,
  ]));
  report.updated_at = new Date().toISOString();
  report.summary = {
    attempted: results.length,
    final_judge_ok: finalOk,
    final_judge_errors: finalErrors,
    chunk_invalid_outputs: chunkInvalids,
    runtime_restart_failures: runtimeFailures,
    max_system_memory_used_percent: maxMemory,
    next_index: results.length + 1,
  };
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
    console.log('REAL120 COMPLETE');
    process.exitCode = 0;
    return;
  }

  console.log('');
  console.log('==============================================================');
  console.log('BUYFLOW EVENTMIND V13-LITE - REAL120 CHUNK + FINAL JUDGE DEV');
  console.log(`RESUME INDEX: ${startIndex} / PROCESS BUDGET: ${maxCases}`);
  console.log('READ ONLY / DEVELOPMENT SET / PRODUCTION OFF');
  console.log('==============================================================');

  let processedThisProcess = 0;
  for (let humanIndex = startIndex; humanIndex <= EXPECTED_COUNT && processedThisProcess < maxCases; humanIndex += 1) {
    const beforeCaseMemory = systemMemory();
    if (beforeCaseMemory.used_percent >= MEMORY_GUARD_PERCENT) {
      console.log(`[${humanIndex}/120] MEMORY GUARD BEFORE CASE: ${beforeCaseMemory.used_percent}% -> RESTART RUNTIME`);
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
        console.log(`[${humanIndex}/120] GMAIL 401 -> REFRESH TOKEN, RETRY SAME INDEX`);
        await saveReport(reportPath, report);
        process.exitCode = 43;
        return;
      }
      report.results.push({
        index: humanIndex, gmail_id_sha256: sha256(gmailId), source: null, chunk_results: [], final_judge: { ok: false, event_type: null, failure: { reason: 'GMAIL_OR_NORMALIZE_ERROR', detail } },
      });
      processedThisProcess += 1;
      await saveReport(reportPath, report);
      console.log(`[${humanIndex}/120] FAIL GMAIL_OR_NORMALIZE_ERROR`);
      continue;
    }

    const normalized = normalizeGmailMessage(message as any);
    const document = normalizeEmailDocumentV1(normalized);
    const semanticText = document.semanticText ?? '';
    const chunks = chunkText(semanticText);
    const sourceFullyCovered = chunks.length > 0 && chunks[chunks.length - 1]!.end >= semanticText.length;
    const chunkResults: any[] = [];
    const judgeEvidence: Array<{ chunk: number; prediction: string | null; evidence: string[] }> = [];
    let restartRequested = false;
    let memoryGuard = false;
    const caseStarted = performance.now();

    if (!sourceFullyCovered) {
      report.results.push({
        index: humanIndex, gmail_id_sha256: sha256(gmailId), source: { semantic_text_chars: semanticText.length, chunks_planned: chunks.length, source_fully_covered: false },
        chunk_results: [], final_judge: { ok: false, event_type: null, failure: { reason: 'SOURCE_NOT_FULLY_COVERED' } },
        elapsed_ms: Math.round((performance.now() - caseStarted) * 10) / 10,
      });
      processedThisProcess += 1;
      await saveReport(reportPath, report);
      console.log(`[${humanIndex}/120] FAIL SOURCE_NOT_FULLY_COVERED | ${semanticText.length} chars`);
      continue;
    }

    for (const chunk of chunks) {
      const beforeCpu = cpuSnap(); const beforeMemory = systemMemory(); const started = performance.now();
      const chunkDocument = {
        ...document,
        semanticText: chunk.text,
        structuredData: chunk.index === 1 ? document.structuredData : [],
        normalization: { ...document.normalization, semanticTextTruncated: chunks.length > 1 },
      };
      const inference = await runEventMindV13(chunkDocument);
      const elapsed = Math.round((performance.now() - started) * 10) / 10;
      const afterCpu = cpuSnap(); const afterMemory = systemMemory();
      const evidence = evidenceWindows(chunk.text);
      chunkResults.push({
        chunk_index: chunk.index, semantic_chars: chunk.text.length, ok: inference.ok,
        event_type: inference.ok ? inference.prediction.event_type : null,
        failure: inference.ok ? null : { reason: inference.reason, ...(inference.detail ? { detail: inference.detail } : {}) },
        elapsed_ms: elapsed, cpu_percent_during_chunk: cpuPercent(beforeCpu, afterCpu), memory_before: beforeMemory, memory_after: afterMemory,
        evidence_window_count: evidence.length,
      });
      judgeEvidence.push({ chunk: chunk.index, prediction: inference.ok ? inference.prediction.event_type : null, evidence });
      if (!inference.ok && isRestartFailure(inference.reason, inference.detail)) { restartRequested = true; break; }
      if (afterMemory.used_percent >= MEMORY_GUARD_PERCENT) { memoryGuard = true; restartRequested = true; break; }
      await sleep(500);
    }

    let finalJudge: any = null;
    if (!restartRequested) {
      const aggregateInput = {
        subject: redactEvidence(document.subject ?? ''),
        from: document.from.map((v) => ({ email: '<sender>', name: v.name ?? null })),
        chunk_results: judgeEvidence,
      };
      const judgePrompt = [
        'You are the final EventMind judge for one buyer mailbox email that was split into chunks only for memory safety.',
        `Choose the latest concrete BUYER-SIDE lifecycle event. event_type must be exactly one of: ${EVENTMIND_EVENT_TYPES.join(', ')}.`,
        'Chunk predictions are weak hints, not votes. Resolve the final event from the short evidence excerpts and subject.',
        'OUT_FOR_DELIVERY means the carrier says delivery is happening today/currently. SHIPPED only means dispatched/handed to carrier.',
        'READY_FOR_PICKUP means waiting for buyer collection. DELIVERED means buyer already received it.',
        'Courier collection of goods the mailbox owner is sending is OTHER unless explicitly a purchase return.',
        'Return JSON only with exactly two keys: is_commerce and event_type. is_commerce is false exactly for OTHER.',
        '', 'CHUNK_EVIDENCE:', JSON.stringify(aggregateInput),
      ].join('\n');

      if (judgePrompt.length > MAX_JUDGE_PROMPT_CHARS) {
        finalJudge = { ok: false, event_type: null, failure: { reason: 'JUDGE_PROMPT_TOO_LARGE' }, prompt_chars: judgePrompt.length };
      } else {
        const beforeCpu = cpuSnap(); const beforeMemory = systemMemory(); const started = performance.now();
        const judged = await classifyAggregate(judgePrompt);
        const elapsed = Math.round((performance.now() - started) * 10) / 10;
        const afterCpu = cpuSnap(); const afterMemory = systemMemory();
        finalJudge = {
          ok: judged.ok, event_type: judged.ok ? judged.prediction.event_type : null,
          failure: judged.ok ? null : { reason: judged.reason, ...('detail' in judged && judged.detail ? { detail: judged.detail } : {}) },
          prompt_chars: judgePrompt.length, elapsed_ms: elapsed,
          cpu_percent_during_judge: cpuPercent(beforeCpu, afterCpu), memory_before: beforeMemory, memory_after: afterMemory,
        };
        if (!judged.ok && isRestartFailure(judged.reason, 'detail' in judged ? judged.detail : undefined)) restartRequested = true;
        if (afterMemory.used_percent >= MEMORY_GUARD_PERCENT) { memoryGuard = true; restartRequested = true; }
      }
    } else {
      finalJudge = { ok: false, event_type: null, failure: { reason: memoryGuard ? 'MEMORY_GUARD' : 'RUNTIME_RESTART_REQUIRED' } };
    }

    const row = {
      index: humanIndex,
      gmail_id_sha256: sha256(gmailId),
      source: { semantic_text_chars: semanticText.length, chunks_planned: chunks.length, source_fully_covered: sourceFullyCovered },
      chunk_results: chunkResults,
      final_judge: finalJudge,
      elapsed_ms: Math.round((performance.now() - caseStarted) * 10) / 10,
      restart_requested_after_case: restartRequested,
    };
    report.results.push(row);
    processedThisProcess += 1;
    await saveReport(reportPath, report);

    console.log(`[${humanIndex}/120] ${finalJudge?.ok ? `FINAL ${finalJudge.event_type}` : `FAIL ${finalJudge?.failure?.reason ?? 'UNKNOWN'}`} | chunks ${chunks.length} | ${Math.round(row.elapsed_ms)} ms | RAM ${systemMemory().used_percent}%`);

    if (restartRequested) {
      console.log('RUNTIME RESTART REQUESTED -> CHECKPOINT SAVED');
      process.exitCode = 42;
      return;
    }
    await sleep(750);
  }

  await saveReport(reportPath, report);
  if (report.complete) {
    console.log('REAL120 COMPLETE');
    process.exitCode = 0;
  } else {
    console.log(`BATCH COMPLETE -> NEXT INDEX ${report.summary.next_index}`);
    process.exitCode = 10;
  }
}

main().catch((error) => {
  console.error(`REAL120_CHUNK_JUDGE_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
