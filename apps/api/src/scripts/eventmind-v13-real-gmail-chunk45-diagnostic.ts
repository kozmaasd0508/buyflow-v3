import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import { buildEventMindPromptV13, runEventMindV13 } from '../ai/eventmind-v13-candidate.js';

interface GmailBodyLike { attachmentId?: string; size?: number; data?: string }
interface GmailHeaderLike { name?: string; value?: string }
interface GmailPartLike { mimeType?: string; filename?: string; headers?: GmailHeaderLike[]; body?: GmailBodyLike; parts?: GmailPartLike[] }
interface GmailMessageLike { id?: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPartLike }

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_COUNT = 120;
const TARGET_INDEX = 45;
const CHUNK_MAX_CHARS = 3_000;
const CHUNK_OVERLAP_CHARS = 250;
const MAX_DIAGNOSTIC_CHUNKS = 24;

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
  return {
    total_bytes: total,
    free_bytes: free,
    used_percent: Math.round(((total - free) / total) * 1000) / 10,
  };
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
  while (start < text.length && chunks.length < MAX_DIAGNOSTIC_CHUNKS) {
    const hardEnd = Math.min(text.length, start + CHUNK_MAX_CHARS);
    const end = chooseBoundary(text, start, hardEnd);
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push({ index: chunks.length + 1, start, end, text: piece });
    if (end >= text.length) break;
    const next = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
    if (next <= start) break;
    start = next;
  }
  return chunks;
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
  const structuredDataJsonChars = JSON.stringify(document.structuredData ?? []).length;

  console.log('');
  console.log('==============================================================');
  console.log('BUYFLOW EVENTMIND V13-LITE - CHUNK45 DIAGNOSTIC');
  console.log('REAL120 INDEX 45 / 3000 CHAR CHUNKS / 250 CHAR OVERLAP');
  console.log('READ ONLY / NO PRODUCTION WRITES / NO FINAL AGGREGATION');
  console.log('==============================================================');
  console.log(`Semantic text chars: ${semanticText.length}`);
  console.log(`Structured data JSON chars: ${structuredDataJsonChars}`);
  console.log(`Chunks planned: ${chunks.length}${chunks.length === MAX_DIAGNOSTIC_CHUNKS && chunks[chunks.length - 1]!.end < semanticText.length ? ' (diagnostic cap reached)' : ''}`);

  const results: any[] = [];
  let stoppedEarly = false;

  for (const chunk of chunks) {
    const beforeCpu = cpuSnap();
    const beforeMemory = systemMemory();
    const chunkDocument = {
      ...document,
      semanticText: chunk.text,
      structuredData: chunk.index === 1 ? document.structuredData : [],
      normalization: {
        ...document.normalization,
        semanticTextTruncated: true,
      },
    };
    const promptChars = buildEventMindPromptV13(chunkDocument).length;
    const started = performance.now();
    const row: any = {
      chunk_index: chunk.index,
      source_start: chunk.start,
      source_end: chunk.end,
      semantic_chars: chunk.text.length,
      prompt_chars: promptChars,
      carries_structured_data: chunk.index === 1,
      ok: false,
      event_type: null,
      failure: null,
      elapsed_ms: null,
      cpu_percent_during_chunk: null,
      memory_before: beforeMemory,
      memory_after: null,
    };
    const inference = await runEventMindV13(chunkDocument);
    row.elapsed_ms = Math.round((performance.now() - started) * 10) / 10;
    if (inference.ok) {
      row.ok = true;
      row.event_type = inference.prediction.event_type;
      console.log(`[chunk ${chunk.index}/${chunks.length}] OK ${row.event_type} | ${Math.round(row.elapsed_ms)} ms | prompt ${promptChars} chars`);
    } else {
      row.failure = { reason: inference.reason, ...(inference.detail ? { detail: inference.detail } : {}) };
      console.log(`[chunk ${chunk.index}/${chunks.length}] FAIL ${inference.reason}${inference.detail ? `:${inference.detail}` : ''} | ${Math.round(row.elapsed_ms)} ms | prompt ${promptChars} chars`);
      if (inference.reason === 'RUNTIME_TIMEOUT') stoppedEarly = true;
    }
    const afterCpu = cpuSnap();
    row.cpu_percent_during_chunk = cpuPercent(beforeCpu, afterCpu);
    row.memory_after = systemMemory();
    results.push(row);
    if (stoppedEarly) break;
    await sleep(1_000);
  }

  const report = {
    suite: 'EVENTMIND_V13_LITE_REAL_GMAIL_CHUNK45_DIAGNOSTIC_V1',
    created_at: new Date().toISOString(),
    target_index: TARGET_INDEX,
    frozen_id_sha256: sha256(ids.join('\n')),
    gmail_id_sha256: sha256(gmailId),
    source: {
      semantic_text_chars: semanticText.length,
      structured_data_json_chars: structuredDataJsonChars,
      detached_bodies_hydrated: hydratedBodies,
    },
    chunking: {
      max_chars: CHUNK_MAX_CHARS,
      overlap_chars: CHUNK_OVERLAP_CHARS,
      max_diagnostic_chunks: MAX_DIAGNOSTIC_CHUNKS,
      chunks_planned: chunks.length,
      source_fully_covered: chunks.length > 0 && chunks[chunks.length - 1]!.end >= semanticText.length,
    },
    stopped_early_on_timeout: stoppedEarly,
    safety: {
      gmail_http_methods: ['GET'], mailbox_mutations: 0, buyflow_db_writes: 0,
      production_flags_enabled: false, raw_gmail_ids_persisted_in_report: false, message_content_persisted_in_report: false,
      final_event_aggregation_performed: false,
    },
    results,
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${reportPath}`);
  process.exitCode = stoppedEarly ? 2 : 0;
}

main().catch((error) => {
  console.error(`CHUNK45_DIAGNOSTIC_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
