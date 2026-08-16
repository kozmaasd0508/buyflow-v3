import { env, requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  detectProtocolEvidence,
  protocolDomainMatchesTrustedSuffix,
} from '../protocols/detect.js';
import { protocolDetectionInputFromEmail } from '../protocols/email-input.js';
import { registeredTestProtocolProfiles } from '../protocols/test-registry.js';
import type {
  ProtocolEventCandidate,
  ProtocolKind,
  ProtocolProfile,
  ProtocolProhibition,
} from '../protocols/types.js';

// Nylas explicitly recommends limit <= 20 for large Gmail mailbox scans to
// reduce provider 429s. Keep this deliberately small even if the API allows more.
const PAGE_SIZE = 20;
const MAX_MESSAGES = Math.min(
  Math.max(Number.parseInt(process.env.PROTOCOL_SHADOW_MAX_MESSAGES ?? '10000', 10) || 10_000, 1),
  10_000,
);
// Gmail messages.get is quota-expensive. Two workers with a 500 ms inter-fetch
// pause stay well below the current per-user quota under normal latency.
const FULL_MESSAGE_CONCURRENCY = Math.min(
  Math.max(Number.parseInt(process.env.PROTOCOL_SHADOW_CONCURRENCY ?? '2', 10) || 2, 1),
  2,
);
const FULL_MESSAGE_MIN_INTERVAL_MS = 500;
const MAX_RATE_LIMIT_RETRIES = 6;

function domainOf(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  return at >= 0 ? normalized.slice(at + 1) : '';
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ErrorLike = {
  statusCode?: unknown;
  headers?: unknown;
};

function statusCodeOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as ErrorLike).statusCode;
  return typeof value === 'number' ? value : null;
}

function retryAfterMsOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const headers = (error as ErrorLike).headers;
  if (!headers || typeof headers !== 'object') return null;
  const raw = (headers as Record<string, unknown>)['retry-after'];
  const seconds = typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  onRetry: () => void,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (statusCodeOf(error) !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
      const retryAfterMs = retryAfterMsOf(error);
      const exponentialMs = Math.min(60_000, 5_000 * (2 ** attempt));
      const jitterMs = Math.floor(Math.random() * 1_000);
      onRetry();
      attempt += 1;
      await sleep(Math.max(retryAfterMs ?? 0, exponentialMs) + jitterMs);
    }
  }
}

function senderMayMatchProfile(message: NormalizedEmail, profile: ProtocolProfile): boolean {
  const senderAddresses = message.from
    .map((sender) => sender.email.trim().toLowerCase())
    .filter(Boolean);
  const senderDomains = senderAddresses.map(domainOf).filter(Boolean);

  if (profile.sender_domains.length > 0) {
    const domainMatch = senderDomains.some((candidate) =>
      profile.sender_domains.some((trusted) =>
        protocolDomainMatchesTrustedSuffix(candidate, trusted),
      ),
    );
    if (!domainMatch) return false;
  }

  if ((profile.sender_addresses?.length ?? 0) > 0) {
    const allowed = new Set(
      profile.sender_addresses!.map((address) => address.trim().toLowerCase()),
    );
    if (!senderAddresses.some((address) => allowed.has(address))) return false;
  }

  return true;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
  return results;
}

function isPromotionsFolder(message: NormalizedEmail): boolean {
  return message.folders.some((folder) => /(?:^|[_-])promotions?(?:$|[_-])/i.test(folder));
}

async function main() {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });
  const profiles = [...registeredTestProtocolProfiles()];

  const seenMessageIds = new Set<string>();
  const profileMatchCounts = new Map<string, number>();
  const profileCandidateCounts = new Map<string, number>();
  const eventCounts = new Map<ProtocolEventCandidate, number>();
  const kindCounts = new Map<ProtocolKind, number>();
  const prohibitionCounts = new Map<ProtocolProhibition, number>();

  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let senderCandidateMessages = 0;
  let fullMessageFetches = 0;
  let fullMessageFetchFailures = 0;
  let rateLimitRetries = 0;
  let matchedMessages = 0;
  let matchedEvidenceRows = 0;
  let positiveLifecycleMessages = 0;
  let otherOnlyMessages = 0;
  let multiEvidenceMessages = 0;
  let unmatchedSenderCandidateMessages = 0;
  let promotionFolderMatches = 0;
  let blockedByNegativeEvidenceRows = 0;
  let productionEligibleRows = 0;
  let messagesWithHeaders = 0;
  let messagesWithDkimEvidence = 0;
  let messagesWithReturnPathEvidence = 0;
  let messagesWithTransportEvidence = 0;
  let messagesMissingBody = 0;
  let oldestReceivedAt: string | null = null;
  let newestReceivedAt: string | null = null;

  do {
    const page = await withRateLimitRetry(
      () => provider.searchMessages({
        query: env.EMAIL_DISCOVERY_QUERY,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
      () => { rateLimitRetries += 1; },
    );
    pages += 1;

    const pageCandidates: Array<{
      metadata: NormalizedEmail;
      profiles: ProtocolProfile[];
    }> = [];

    for (const message of page.messages) {
      if (seenMessageIds.has(message.providerMessageId)) continue;
      if (seenMessageIds.size >= MAX_MESSAGES) {
        truncated = true;
        break;
      }

      seenMessageIds.add(message.providerMessageId);
      if (!oldestReceivedAt || message.receivedAt < oldestReceivedAt) {
        oldestReceivedAt = message.receivedAt;
      }
      if (!newestReceivedAt || message.receivedAt > newestReceivedAt) {
        newestReceivedAt = message.receivedAt;
      }

      const candidateProfiles = profiles.filter((profile) =>
        senderMayMatchProfile(message, profile),
      );
      if (candidateProfiles.length === 0) continue;

      senderCandidateMessages += 1;
      for (const profile of candidateProfiles) {
        bump(profileCandidateCounts, `${profile.protocol_id}@${profile.protocol_version}`);
      }
      pageCandidates.push({ metadata: message, profiles: candidateProfiles });
    }

    const evaluations = await mapWithConcurrency(
      pageCandidates,
      FULL_MESSAGE_CONCURRENCY,
      async ({ metadata, profiles: candidateProfiles }) => {
        fullMessageFetches += 1;
        try {
          const fullMessage = await withRateLimitRetry(
            () => provider.getMessage(metadata.providerMessageId),
            () => { rateLimitRetries += 1; },
          );
          const input = protocolDetectionInputFromEmail(fullMessage);
          return {
            metadata,
            fullMessage,
            input,
            evidence: detectProtocolEvidence(input, candidateProfiles),
          };
        } catch {
          fullMessageFetchFailures += 1;
          return null;
        } finally {
          await sleep(FULL_MESSAGE_MIN_INTERVAL_MS);
        }
      },
    );

    for (const evaluation of evaluations) {
      if (!evaluation) continue;
      const { metadata, fullMessage, input, evidence } = evaluation;

      if ((fullMessage.headers?.length ?? 0) > 0) messagesWithHeaders += 1;
      if ((input.dkimDomains?.length ?? 0) > 0) messagesWithDkimEvidence += 1;
      if ((input.returnPathDomains?.length ?? 0) > 0) messagesWithReturnPathEvidence += 1;
      if ((input.transportHosts?.length ?? 0) > 0) messagesWithTransportEvidence += 1;
      if (!input.bodyText && !input.bodyHtml) messagesMissingBody += 1;

      if (evidence.length === 0) {
        unmatchedSenderCandidateMessages += 1;
        continue;
      }

      matchedMessages += 1;
      matchedEvidenceRows += evidence.length;
      if (evidence.length > 1) multiEvidenceMessages += 1;
      if (isPromotionsFolder(metadata)) promotionFolderMatches += 1;

      const hasPositiveLifecycle = evidence.some((row) => row.event_candidate !== 'OTHER');
      if (hasPositiveLifecycle) positiveLifecycleMessages += 1;
      else otherOnlyMessages += 1;

      for (const row of evidence) {
        bump(profileMatchCounts, `${row.protocol_id}@${row.protocol_version}`);
        bump(eventCounts, row.event_candidate);
        bump(kindCounts, row.protocol_kind);
        for (const prohibition of row.prohibitions) bump(prohibitionCounts, prohibition);
        if (row.blocked_by_negative_evidence) blockedByNegativeEvidenceRows += 1;
        if (row.production_eligible) productionEligibleRows += 1;
      }
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  if (productionEligibleRows > 0) {
    throw new Error(
      `Shadow safety invariant violated: ${productionEligibleRows} test-profile evidence rows were production eligible.`,
    );
  }

  const totalScanned = seenMessageIds.size;
  const result = {
    mode: 'read_only_protocol_shadow_audit',
    provider: provider.name,
    query: env.EMAIL_DISCOVERY_QUERY,
    safety: {
      databaseWrites: false,
      productionRegistryUsed: false,
      productionEligibleRows,
      bodyOutput: false,
      subjectOutput: false,
      messageIdOutput: false,
      senderAddressOutput: false,
      rawHeaderOutput: false,
    },
    pagination: {
      pageSize: PAGE_SIZE,
      pages,
      maxMessagesSafetyCap: MAX_MESSAGES,
      truncated,
      fullMessageConcurrency: FULL_MESSAGE_CONCURRENCY,
      fullMessageMinIntervalMs: FULL_MESSAGE_MIN_INTERVAL_MS,
      rateLimitRetries,
    },
    scan: {
      totalMessages: totalScanned,
      oldestReceivedAt,
      newestReceivedAt,
      testProfiles: profiles.length,
      senderCandidateMessages,
      senderGateRejectedMessages: totalScanned - senderCandidateMessages,
      fullMessageFetches,
      fullMessageFetchFailures,
      fullMessageFetchRate:
        totalScanned === 0 ? 0 : Number((fullMessageFetches / totalScanned).toFixed(4)),
    },
    authEvidence: {
      messagesWithHeaders,
      messagesWithDkimEvidence,
      messagesWithReturnPathEvidence,
      messagesWithTransportEvidence,
      messagesMissingBody,
    },
    matches: {
      matchedMessages,
      matchedEvidenceRows,
      positiveLifecycleMessages,
      otherOnlyMessages,
      multiEvidenceMessages,
      unmatchedSenderCandidateMessages,
      promotionFolderMatches,
      blockedByNegativeEvidenceRows,
      byEvent: sortedObject(eventCounts),
      byKind: sortedObject(kindCounts),
      byProfile: sortedObject(profileMatchCounts),
      candidateMessagesByProfile: sortedObject(profileCandidateCounts),
      prohibitions: sortedObject(prohibitionCounts),
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Nylas protocol shadow audit failed:', error);
  process.exit(1);
});
