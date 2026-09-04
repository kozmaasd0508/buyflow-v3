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
const TARGET_INDEX = 45;
const CHUNK_MAX_CHARS = 3_000;
const CHUNK_OVERLAP_CHARS = 250;
const MAX_CHUNKS = 24;
const EVIDENCE_WINDOW = 220;
const MAX_EVIDENCE_WINDOWS_PER_CHUNK = 3;

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
  const found = (part.headers ?? []).find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
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
  const chunks: Array<{ index: number; start: number; end: number; text: string }> = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    const hardEnd = Math.min(text.length, start + CHUNK_MAX_CHARS);
    const end = chooseBoundary(text, start, hardEnd);
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push({ index: chunks.length + 1, start, end, text: piece });
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
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const idFile = process.argv[2];
  const reportPath = process.argv[3];
  if (!idFile || !reportPath) throw new Error('USAGE: <id-file.json> <report-path.json>');
  const parsed = JSON.parse(await readFile(idFile, 'utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string')) throw new Error('ID_FILE_INVALID');
  const ids = parsed.map((v) => v.trim());
  if (ids.length !== EXPECTED_COUNT) throw new Error(`EXPECTED_${EXPECTED_COUNT}_IDS_GOT_${ids.length}`);
  const accessToken = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const gmailId = ids[TARGET_INDEX - 1]!;
  const message = await gmailJson(`/messages/${encodeURIComponent(gmailId)}?format=full`, accessToken) as GmailMessageLike;
  if (message.id !== gmailId) throw new Error('GMAIL_ID_MISMATCH');
  const hydratedBodies = await hydrateDetachedBodies(message.payload, gmailId, accessToken);
  const normalized = normalizeGmailMessage(message as any);
  const document = normalizeEmailDocumentV1(normalized);
  const semanticText = document.semanticText ?? '';
  const chunks = chunkText(semanticText);

  console.log('');
  console.log('==============================================================');
  console.log('BUYFLOW EVENTMIND - CHUNK45 + FINAL JUDGE DIAGNOSTIC');
  console.log('REAL120 INDEX 45 / CHUNKS -> SHORT EVIDENCE -> FINAL JUDGE');
  console.log('READ ONLY / NO PRODUCTION WRITES');
  console.log('==============================================================');

  const chunkResults: any[] = [];
  const judgeEvidence: Array<{ chunk: number; prediction: string | null; evidence: string[] }> = [];
  let anyTimeout = false;

  for (const chunk of chunks) {
    const beforeCpu = cpuSnap(); const beforeMemory = systemMemory(); const started = performance.now();
    const chunkDocument = {
      ...document,
      semanticText: chunk.text,
      structuredData: chunk.index === 1 ? document.structuredData : [],
      normalization: { ...document.normalization, semanticTextTruncated: true },
    };
    const inference = await runEventMindV13(chunkDocument);
    const elapsed = Math.round((performance.now() - started) * 10) / 10;
    const afterCpu = cpuSnap(); const afterMemory = systemMemory();
    const row: any = {
      chunk_index: chunk.index,
      semantic_chars: chunk.text.length,
      ok: inference.ok,
      event_type: inference.ok ? inference.prediction.event_type : null,
      failure: inference.ok ? null : { reason: inference.reason, ...(inference.detail ? { detail: inference.detail } : {}) },
      elapsed_ms: elapsed,
      cpu_percent_during_chunk: cpuPercent(beforeCpu, afterCpu),
      memory_before: beforeMemory,
      memory_after: afterMemory,
      evidence_window_count: evidenceWindows(chunk.text).length,
    };
    chunkResults.push(row);
    judgeEvidence.push({
      chunk: chunk.index,
      prediction: inference.ok ? inference.prediction.event_type : null,
      evidence: evidenceWindows(chunk.text),
    });
    console.log(`[chunk ${chunk.index}/${chunks.length}] ${inference.ok ? `OK ${inference.prediction.event_type}` : `FAIL ${inference.reason}`} | ${Math.round(elapsed)} ms`);
    if (!inference.ok && inference.reason === 'RUNTIME_TIMEOUT') { anyTimeout = true; break; }
    await sleep(750);
  }

  let finalJudge: any = null;
  if (!anyTimeout) {
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
      '',
      'CHUNK_EVIDENCE:',
      JSON.stringify(aggregateInput),
    ].join('\n');
    const beforeCpu = cpuSnap(); const beforeMemory = systemMemory(); const started = performance.now();
    const judged = await classifyAggregate(judgePrompt);
    const elapsed = Math.round((performance.now() - started) * 10) / 10;
    const afterCpu = cpuSnap(); const afterMemory = systemMemory();
    finalJudge = {
      ok: judged.ok,
      event_type: judged.ok ? judged.prediction.event_type : null,
      failure: judged.ok ? null : { reason: judged.reason, ...('detail' in judged && judged.detail ? { detail: judged.detail } : {}) },
      prompt_chars: judgePrompt.length,
      elapsed_ms: elapsed,
      cpu_percent_during_judge: cpuPercent(beforeCpu, afterCpu),
      memory_before: beforeMemory,
      memory_after: afterMemory,
    };
    console.log(`[FINAL JUDGE] ${judged.ok ? `OK ${judged.prediction.event_type}` : `FAIL ${judged.reason}`} | ${Math.round(elapsed)} ms | prompt ${judgePrompt.length} chars`);
  }

  const report = {
    suite: 'EVENTMIND_V13_LITE_REAL_GMAIL_CHUNK45_JUDGE_DIAGNOSTIC_V1',
    created_at: new Date().toISOString(),
    target_index: TARGET_INDEX,
    frozen_id_sha256: sha256(ids.join('\n')),
    gmail_id_sha256: sha256(gmailId),
    source: { semantic_text_chars: semanticText.length, detached_bodies_hydrated: hydratedBodies },
    chunking: { max_chars: CHUNK_MAX_CHARS, overlap_chars: CHUNK_OVERLAP_CHARS, chunks_planned: chunks.length, source_fully_covered: chunks.length > 0 && chunks[chunks.length - 1]!.end >= semanticText.length },
    safety: {
      gmail_http_methods: ['GET'], mailbox_mutations: 0, buyflow_db_writes: 0, production_flags_enabled: false,
      raw_gmail_ids_persisted_in_report: false, message_content_persisted_in_report: false,
      final_judge_evidence_text_persisted_in_report: false,
    },
    chunk_results: chunkResults,
    final_judge: finalJudge,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(`CHUNK45_JUDGE_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
