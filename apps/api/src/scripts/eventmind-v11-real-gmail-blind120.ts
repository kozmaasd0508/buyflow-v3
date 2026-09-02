import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import { runEventMindV11 } from '../ai/eventmind-v11-runtime.js';

interface GmailBodyLike {
  attachmentId?: string;
  size?: number;
  data?: string;
}
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
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
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

async function hydrateDetachedBodies(
  part: GmailPartLike | undefined,
  messageId: string,
  accessToken: string,
): Promise<number> {
  if (!part) return 0;
  let hydrated = 0;
  if (isDetachedRenderableBody(part)) {
    const attachmentId = part.body!.attachmentId!.trim();
    const payload = await gmailJson(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      accessToken,
    );
    if (typeof payload.data !== 'string' || payload.data.length === 0) {
      throw new Error('DETACHED_BODY_ATTACHMENT_EMPTY');
    }
    part.body = {
      ...part.body,
      data: payload.data,
      ...(typeof payload.size === 'number' ? { size: payload.size } : {}),
    };
    hydrated += 1;
  }
  for (const child of part.parts ?? []) {
    hydrated += await hydrateDetachedBodies(child, messageId, accessToken);
  }
  return hydrated;
}

async function main() {
  const idFile = process.argv[2];
  const reportPath = process.argv[3];
  if (!idFile || !reportPath) throw new Error('USAGE: <id-file.json> <report-path.json>');

  const parsed = JSON.parse(await readFile(idFile, 'utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error('ID_FILE_INVALID');
  }
  const ids = parsed.map((value) => value.trim());
  if (ids.length !== EXPECTED_COUNT) throw new Error(`EXPECTED_${EXPECTED_COUNT}_IDS_GOT_${ids.length}`);
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_GMAIL_ID');
  if (ids.some((value) => !/^[a-f0-9]{8,64}$/i.test(value))) throw new Error('INVALID_GMAIL_ID_FORMAT');

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
  console.log('BUYFLOW EVENTMIND V11 - REAL GMAIL BLIND120 PREDICTION FREEZE');
  console.log('READ ONLY - NO MAILBOX WRITE - NO BUYFLOW DB WRITE');
  console.log('==============================================================');
  console.log(`Frozen ID count: ${ids.length}`);
  console.log(`Frozen ID SHA256: ${idSetSha256}`);
  console.log('Message content is not printed or stored in this report.');
  console.log('');

  for (let index = 0; index < ids.length; index += 1) {
    const gmailId = ids[index]!;
    const row: any = {
      index: index + 1,
      gmail_id: gmailId,
      gmail_id_sha256: sha256(gmailId),
      ok: false,
      prediction: null,
      failure: null,
      mail_lens_normalizer: null,
      detached_bodies_hydrated: 0,
    };
    try {
      const message = await gmailJson(
        `/messages/${encodeURIComponent(gmailId)}?format=full`,
        accessToken,
      ) as GmailMessageLike;
      if (message.id !== gmailId) throw new Error('GMAIL_ID_MISMATCH');
      const hydrated = await hydrateDetachedBodies(message.payload, gmailId, accessToken);
      detachedBodiesHydrated += hydrated;
      row.detached_bodies_hydrated = hydrated;

      const normalized = normalizeGmailMessage(message as any);
      const document = normalizeEmailDocumentV1(normalized);
      row.mail_lens_normalizer = document.normalizerVersion;
      const inference = await runEventMindV11(document);
      if (!inference.ok) {
        row.failure = {
          reason: inference.reason,
          ...(inference.detail ? { detail: inference.detail } : {}),
        };
        failedCount += 1;
        console.log(`[${index + 1}/${ids.length}] FAIL ${inference.reason}`);
      } else {
        row.ok = true;
        row.prediction = inference.prediction;
        row.runtime = inference.runtime;
        okCount += 1;
        eventCounts[inference.prediction.event_type] = (eventCounts[inference.prediction.event_type] ?? 0) + 1;
        console.log(`[${index + 1}/${ids.length}] OK ${inference.prediction.event_type}`);
      }
    } catch (error) {
      row.failure = {
        reason: 'TEST_CASE_ERROR',
        detail: error instanceof Error ? error.message : String(error),
      };
      failedCount += 1;
      console.log(`[${index + 1}/${ids.length}] ERROR ${row.failure.detail}`);
    }
    results.push(row);
  }

  const report = {
    suite: 'EVENTMIND_V11_REAL_GMAIL_BLIND120_PREDICTION_FREEZE_V1',
    created_at: new Date().toISOString(),
    selection: {
      source: 'real_gmail_category_purchases',
      expected_count: EXPECTED_COUNT,
      frozen_id_sha256: idSetSha256,
      prior_known_batch_ids_excluded_before_prediction: true,
      ground_truth_read_before_prediction: false,
    },
    model_stage: 'prediction_freeze_only',
    total: ids.length,
    predictions_ok: okCount,
    predictions_failed: failedCount,
    detached_bodies_hydrated: detachedBodiesHydrated,
    event_counts: eventCounts,
    safety: {
      gmail_http_methods: ['GET'],
      mailbox_mutations: 0,
      buyflow_db_writes: 0,
      source_archive_writes: 0,
      purchase_writes: 0,
      shipment_writes: 0,
      document_writes: 0,
      production_flags_enabled: false,
      message_content_persisted_in_report: false,
    },
    results,
  };

  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  console.log('==================== SUMMARY ===================');
  console.log(`Predictions OK:     ${okCount}/${ids.length}`);
  console.log(`Prediction errors:  ${failedCount}`);
  console.log(`Detached hydrated:  ${detachedBodiesHydrated}`);
  console.log('Mailbox writes:     0');
  console.log('BuyFlow DB writes:  0');
  console.log(`Frozen ID SHA256:   ${idSetSha256}`);
  console.log(`Report:             ${reportPath}`);
  console.log(failedCount === 0 ? 'FREEZE: COMPLETE' : 'FREEZE: INCOMPLETE');
  console.log('================================================');
  console.log('');

  process.exitCode = failedCount === 0 ? 0 : 2;
}

main().catch((error) => {
  console.error(`BLIND120_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
