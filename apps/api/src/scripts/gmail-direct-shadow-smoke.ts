import { createHash } from 'node:crypto';
import { env, requireSmokeImportContext } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { evaluateGmailDirectCandidate } from '../email/gmail-direct-candidate-gate.js';
import { createDirectGmailRuntime } from '../email/gmail-direct-sync.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function smokeLimit(): number {
  const raw = process.env.BUYFLOW_GMAIL_SHADOW_SMOKE_LIMIT?.trim();
  if (!raw) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('BUYFLOW_GMAIL_SHADOW_SMOKE_LIMIT must be a positive integer');
  }
  return Math.min(Math.trunc(value), MAX_LIMIT);
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

async function main() {
  if (!env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) {
    throw new Error('Direct Gmail runtime must be explicitly enabled for this controlled smoke');
  }

  const { userId, emailConnectionId } = requireSmokeImportContext();
  const db = getSupabaseAdmin() as any;
  const { runtime } = await createDirectGmailRuntime({
    db,
    userId,
    emailConnectionId,
  });

  const limit = smokeLimit();
  const initial = await runtime.provider.initialSync({
    query: env.GMAIL_DIRECT_DISCOVERY_QUERY,
    limit,
  });

  const gateReasons: Record<string, number> = {};
  let rawParity = 0;
  let observedCommerceCandidates = 0;
  let ignoredPersonalOrNoise = 0;
  let totalRawBytes = 0;

  for (const message of initial.messages) {
    const raw = await runtime.getRawMessage(message.providerMessageId);
    if (raw.length === 0) {
      throw new Error('Gmail returned an empty RAW MIME body for an observed message');
    }

    // The digest is intentionally not printed. Computing it proves the exact RAW
    // bytes are available to the process without leaking message content or IDs.
    createHash('sha256').update(raw).digest();
    totalRawBytes += raw.length;
    rawParity += 1;

    const gate = evaluateGmailDirectCandidate(message);
    increment(gateReasons, gate.reason);
    if (gate.action === 'observe') observedCommerceCandidates += 1;
    else ignoredPersonalOrNoise += 1;
  }

  // Replay from the captured boundary without committing it. This exercises the
  // history.list path while leaving durable provider state unchanged. If Google
  // says the cursor is expired, that is reported rather than guessed around.
  const history = await runtime.provider.getChanges(initial.cursor, 100);

  console.log(JSON.stringify({
    smoke: 'gmail-direct-shadow-v1',
    mode: 'read_only_no_commit',
    query: env.GMAIL_DIRECT_DISCOVERY_QUERY,
    sampleLimit: limit,
    sampledMessages: initial.messages.length,
    rawMimeParity: rawParity,
    totalRawBytesObserved: totalRawBytes,
    initialCursorCaptured: initial.cursor.provider === 'gmail' && /^\d+$/.test(initial.cursor.value),
    historyReplay: {
      resetRequired: history.resetRequired,
      observedChanges: history.changes.length,
      nextCursorValid: history.nextCursor.provider === 'gmail' && /^\d+$/.test(history.nextCursor.value),
    },
    commercePrivacyGate: {
      observedCommerceCandidates,
      ignoredPersonalOrNoise,
      reasons: gateReasons,
    },
    safety: {
      durableCursorCommitted: false,
      sourceEmailsPersisted: 0,
      sourceArchiveWrites: 0,
      purchaseWrites: 0,
      shipmentWrites: 0,
      documentWrites: 0,
      aiCalls: 0,
      mailboxMutations: 0,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error('Direct Gmail shadow smoke failed:', error instanceof Error ? error.message : 'UnknownError');
  process.exit(1);
});
