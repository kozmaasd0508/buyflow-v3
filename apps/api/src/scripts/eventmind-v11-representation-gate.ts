import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  EVENTMIND_EVENT_TYPES,
  type EventMindPredictionV1,
} from '../ai/eventmind-v1.js';
import {
  eventMindV11RuntimeConfigFromEnvironment,
  runEventMindV11,
} from '../ai/eventmind-v11-runtime.js';
import {
  assertUntouchedEventMindRepresentationFixture,
  scoreEventMindRepresentationGate,
  type EventMindRepresentationGateCaseResult,
} from '../ai/eventmind-v11-representation-gate.js';

interface FixtureRow {
  case_id: string;
  email: NormalizedEmail;
  expected: EventMindPredictionV1;
}

const VALID_EVENTS = new Set<string>(EVENTMIND_EVENT_TYPES);
const VALID_PROVIDERS = new Set(['nylas', 'gmail', 'ses', 'mailgun']);

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function prediction(value: unknown): EventMindPredictionV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) return null;
  if (typeof record.is_commerce !== 'boolean' || typeof record.event_type !== 'string') return null;
  if (!VALID_EVENTS.has(record.event_type)) return null;
  if (record.is_commerce !== (record.event_type !== 'OTHER')) return null;
  return {
    is_commerce: record.is_commerce,
    event_type: record.event_type as EventMindPredictionV1['event_type'],
  };
}

function normalizedEmail(value: unknown): NormalizedEmail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.provider !== 'string' || !VALID_PROVIDERS.has(record.provider)) return null;
  if (typeof record.providerMessageId !== 'string' || !record.providerMessageId) return null;
  if (typeof record.receivedAt !== 'string' || !record.receivedAt) return null;
  for (const key of ['from', 'to', 'cc', 'bcc', 'folders', 'attachments'] as const) {
    if (!Array.isArray(record[key])) return null;
  }
  return record as unknown as NormalizedEmail;
}

function fixtureRow(raw: unknown, lineNumber: number): FixtureRow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`INVALID_FIXTURE_ROW:${lineNumber}`);
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.case_id !== 'string' || !record.case_id.trim()) {
    throw new Error(`INVALID_CASE_ID:${lineNumber}`);
  }
  const email = normalizedEmail(record.email);
  const expected = prediction(record.expected);
  if (!email || !expected) throw new Error(`INVALID_FIXTURE_ROW:${lineNumber}`);
  return { case_id: record.case_id.trim(), email, expected };
}

function parseFixture(data: Buffer): FixtureRow[] {
  const rows: FixtureRow[] = [];
  const ids = new Set<string>();
  const text = data.toString('utf-8');
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`INVALID_FIXTURE_JSON:${index + 1}`);
    }
    const row = fixtureRow(parsed, index + 1);
    if (ids.has(row.case_id)) throw new Error(`DUPLICATE_CASE_ID:${row.case_id}`);
    ids.add(row.case_id);
    rows.push(row);
  }
  return rows;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  const fixtureArg = process.argv[2];
  if (!fixtureArg) {
    throw new Error('Usage: npm run eventmind:v11-gate --workspace @buyflow/api -- <private-fixture.jsonl>');
  }

  const fixturePath = resolve(fixtureArg);
  const sourceBytes = await readFile(fixturePath);
  const fixtureSha256 = sha256(sourceBytes);
  const rows = parseFixture(sourceBytes);

  assertUntouchedEventMindRepresentationFixture({
    sha256: fixtureSha256,
    caseCount: rows.length,
    eventTypes: rows.map((row) => row.expected.event_type),
  });

  const runtimeConfig = eventMindV11RuntimeConfigFromEnvironment();
  if (!runtimeConfig.enabled) throw new Error('EVENTMIND_V11_RUNTIME_DISABLED');

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const runDir = resolve(repoRoot, 'local-data', 'eventmind-v11-representation-gate', 'runs', stamp());
  await mkdir(runDir, { recursive: false });

  // Freeze the exact private fixture before the first inference call. local-data/
  // is Git-ignored; raw customer email content must never be committed.
  await writeFile(resolve(runDir, 'fixture.frozen.jsonl'), sourceBytes);
  const manifestPath = resolve(runDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    status: 'FROZEN_BEFORE_INFERENCE',
    frozenAt: new Date().toISOString(),
    fixtureSha256,
    caseCount: rows.length,
    modelId: runtimeConfig.expectedModelId,
    adapterSha256: runtimeConfig.expectedAdapterSha256,
    runtimeVersion: runtimeConfig.expectedRuntimeVersion,
    templateVersion: runtimeConfig.expectedTemplateVersion,
    eventMindInputVersion: 'eventmind-mail-lens-v1',
    doNotTrainOnFixture: true,
  }, null, 2) + '\n');

  const results: EventMindRepresentationGateCaseResult[] = [];
  const predictionsPath = resolve(runDir, 'predictions.jsonl');

  for (const [index, row] of rows.entries()) {
    const document = normalizeEmailDocumentV1(row.email);
    const result = await runEventMindV11(document, runtimeConfig);
    let gateRow: EventMindRepresentationGateCaseResult;
    if (!result.ok) {
      if (result.reason !== 'INVALID_MODEL_OUTPUT') {
        await writeFile(manifestPath, JSON.stringify({
          status: 'ABORTED_RUNTIME_FAILURE',
          fixtureSha256,
          stoppedAtCase: row.case_id,
          runtimeFailure: result.reason,
        }, null, 2) + '\n');
        throw new Error(`EVENTMIND_RUNTIME_FAILURE:${result.reason}`);
      }
      gateRow = {
        caseId: row.case_id,
        expected: row.expected,
        prediction: null,
        error: `${result.reason}:${result.detail ?? 'unknown'}`,
      };
    } else {
      gateRow = {
        caseId: row.case_id,
        expected: row.expected,
        prediction: result.prediction,
        error: null,
      };
    }
    results.push(gateRow);
    await appendFile(predictionsPath, JSON.stringify(gateRow) + '\n');
    if ((index + 1) % 10 === 0 || index + 1 === rows.length) {
      console.log(`EventMind gate: ${index + 1}/${rows.length}`);
    }
  }

  const score = scoreEventMindRepresentationGate(results);
  const metrics = {
    status: 'EVENTMIND_V11_REPRESENTATION_GATE_COMPLETE',
    fixtureSha256,
    modelId: runtimeConfig.expectedModelId,
    adapterSha256: runtimeConfig.expectedAdapterSha256,
    runtimeVersion: runtimeConfig.expectedRuntimeVersion,
    templateVersion: runtimeConfig.expectedTemplateVersion,
    eventMindInputVersion: 'eventmind-mail-lens-v1',
    doNotTrainOnFixture: true,
    ...score,
  };
  await writeFile(resolve(runDir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  await writeFile(manifestPath, JSON.stringify({
    status: 'COMPLETE',
    completedAt: new Date().toISOString(),
    fixtureSha256,
    gate: score.gate,
  }, null, 2) + '\n');

  console.log(`Fixture SHA-256: ${fixtureSha256}`);
  console.log(`Exact: ${score.exactCorrect}/${score.total} (${(score.exactAccuracy * 100).toFixed(2)}%)`);
  console.log(`Macro event: ${(score.macroEventAccuracy * 100).toFixed(2)}%`);
  console.log(`Invalid: ${score.invalidOutputCount}`);
  console.log(`Unsafe promotions: ${score.unsafePromotionCount}`);
  console.log(`Gate: ${score.gate}`);
  console.log(`Result: ${runDir}`);
  if (score.gate !== 'PASS') process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
