import { env, requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { parseDeterministicCommerceEmail } from '../ingestion/deterministic-commerce-parser.js';
import { parseDeterministicLifecycleEmail } from '../ingestion/deterministic-lifecycle-parser.js';
import {
  detectProtocolEvidence,
  protocolDomainMatchesTrustedSuffix,
} from '../protocols/detect.js';
import { protocolDetectionInputFromEmail } from '../protocols/email-input.js';
import { registeredTestProtocolProfiles } from '../protocols/test-registry.js';
import type {
  ProtocolEventCandidate,
  ProtocolProfile,
} from '../protocols/types.js';

const PAGE_SIZE = 20;
const MAX_MESSAGES = Math.min(
  Math.max(Number.parseInt(process.env.PROTOCOL_CONSENSUS_MAX_MESSAGES ?? '10000', 10) || 10_000, 1),
  10_000,
);
const FULL_MESSAGE_CONCURRENCY = 2;
const FULL_MESSAGE_MIN_INTERVAL_MS = 500;
const MAX_RATE_LIMIT_RETRIES = 6;

const LOGISTICS_EVENTS = new Set<ProtocolEventCandidate>([
  'SHIPMENT_CREATED',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'READY_FOR_PICKUP',
  'DELIVERED',
  'DELIVERY_FAILED',
  'DELAYED',
]);

type LegacyEvidence = {
  events: Set<ProtocolEventCandidate>;
  genericShipment: boolean;
};

type EventStats = {
  total: number;
  exact: number;
  compatible: number;
  shadowOnly: number;
  conflict: number;
};

type ProfileStats = EventStats;

type ErrorLike = {
  statusCode?: unknown;
  headers?: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function withRateLimitRetry<T>(operation: () => Promise<T>, onRetry: () => void): Promise<T> {
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

function domainOf(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  return at >= 0 ? normalized.slice(at + 1) : '';
}

function explicitSenderProfile(profile: ProtocolProfile): boolean {
  return profile.sender_domains.length > 0 || (profile.sender_addresses?.length ?? 0) > 0;
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

function mapShipmentPhase(phase: string | undefined): ProtocolEventCandidate | null {
  switch (phase) {
    case 'shipment_created': return 'SHIPMENT_CREATED';
    case 'shipped': return 'SHIPPED';
    case 'in_transit': return 'IN_TRANSIT';
    case 'out_for_delivery': return 'OUT_FOR_DELIVERY';
    case 'ready_for_pickup': return 'READY_FOR_PICKUP';
    case 'delivered': return 'DELIVERED';
    default: return null;
  }
}

function legacyEvidence(input: {
  senderDomains: string[];
  senderEmails: string[];
  subject?: string | null;
  bodyText?: string | null;
}): LegacyEvidence {
  const events = new Set<ProtocolEventCandidate>();
  let genericShipment = false;

  const lifecycle = parseDeterministicLifecycleEmail(input);
  if (lifecycle) {
    switch (lifecycle.lifecycleEvent) {
      case 'payment_failed': events.add('PAYMENT_FAILED'); break;
      case 'cancelled': events.add('CANCELLED'); break;
      case 'delayed': events.add('DELAYED'); break;
      case 'order_processing': events.add('ORDER_PROCESSING'); break;
      case 'order_packing': events.add('ORDER_PACKING'); break;
      case 'ready_to_ship': events.add('SHIPMENT_CREATED'); break;
      case 'shipment_created': events.add('SHIPMENT_CREATED'); break;
      case 'shipped': events.add('SHIPPED'); break;
      case 'out_for_delivery': events.add('OUT_FOR_DELIVERY'); break;
      case 'ready_for_pickup': events.add('READY_FOR_PICKUP'); break;
    }
  }

  const commerce = parseDeterministicCommerceEmail(input);
  if (commerce) {
    const phaseEvent = mapShipmentPhase(commerce.shipmentPhase);
    if (phaseEvent) {
      events.add(phaseEvent);
    } else {
      switch (commerce.extraction.event_type) {
        case 'order_created': events.add('ORDER_CREATED'); break;
        case 'payment_completed': events.add('PAYMENT_SUCCESS'); break;
        case 'delivery': events.add('DELIVERED'); break;
        case 'invoice_or_receipt': events.add('INVOICE'); break;
        case 'return': events.add('RETURN'); break;
        case 'refund': events.add('REFUNDED'); break;
        case 'shipment': genericShipment = true; break;
      }
    }
  }

  return { events, genericShipment };
}

function isCompatible(shadowEvent: ProtocolEventCandidate, legacy: LegacyEvidence): boolean {
  if (legacy.events.has(shadowEvent)) return true;
  return legacy.genericShipment && LOGISTICS_EVENTS.has(shadowEvent);
}

function emptyStats(): EventStats {
  return { total: 0, exact: 0, compatible: 0, shadowOnly: 0, conflict: 0 };
}

function bumpEventStats(
  map: Map<string, EventStats>,
  key: string,
  result: 'exact' | 'compatible' | 'shadowOnly' | 'conflict',
) {
  const stats = map.get(key) ?? emptyStats();
  stats.total += 1;
  stats[result] += 1;
  map.set(key, stats);
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedNumberObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function sortedStatsObject(map: Map<string, EventStats>): Record<string, EventStats> {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0])),
  );
}

async function main() {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const allProfiles = [...registeredTestProtocolProfiles()];
  const profiles = allProfiles.filter(explicitSenderProfile);

  const seenMessageIds = new Set<string>();
  const shadowEventStats = new Map<string, EventStats>();
  const shadowProfileStats = new Map<string, ProfileStats>();
  const legacyEventCounts = new Map<string, number>();
  const shadowEventCounts = new Map<string, number>();

  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let rateLimitRetries = 0;
  let senderCandidateMessages = 0;
  let fullMessageFetches = 0;
  let fullMessageFetchFailures = 0;
  let shadowMatchedMessages = 0;
  let shadowPositiveMessages = 0;
  let shadowOtherOnlyMessages = 0;
  let legacyPositiveMessages = 0;
  let bothPositiveMessages = 0;
  let exactOverlapMessages = 0;
  let compatibleOnlyMessages = 0;
  let semanticConflictMessages = 0;
  let shadowOnlyPositiveMessages = 0;
  let legacyOnlyPositiveMessages = 0;
  let shadowOtherLegacySilentMessages = 0;
  let shadowOtherLegacyPositiveMessages = 0;

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

      const candidateProfiles = profiles.filter((profile) => senderMayMatchProfile(message, profile));
      if (candidateProfiles.length === 0) continue;
      senderCandidateMessages += 1;
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
          const protocolInput = protocolDetectionInputFromEmail(fullMessage);
          const shadow = detectProtocolEvidence(protocolInput, candidateProfiles);
          const deterministic = legacyEvidence({
            senderDomains: protocolInput.senderDomains ?? [],
            senderEmails: fullMessage.from.map((sender) => sender.email),
            subject: fullMessage.subject,
            bodyText: protocolInput.bodyText,
          });
          return { shadow, deterministic };
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
      const { shadow, deterministic } = evaluation;
      const positiveShadow = shadow.filter((row) => row.event_candidate !== 'OTHER');
      const otherShadow = shadow.filter((row) => row.event_candidate === 'OTHER');
      const legacyPositive = deterministic.events.size > 0 || deterministic.genericShipment;

      if (shadow.length > 0) shadowMatchedMessages += 1;
      if (positiveShadow.length > 0) shadowPositiveMessages += 1;
      if (otherShadow.length > 0 && positiveShadow.length === 0) shadowOtherOnlyMessages += 1;
      if (legacyPositive) legacyPositiveMessages += 1;

      for (const event of deterministic.events) bump(legacyEventCounts, event);
      if (deterministic.genericShipment) bump(legacyEventCounts, 'GENERIC_SHIPMENT');
      for (const row of positiveShadow) bump(shadowEventCounts, row.event_candidate);

      if (positiveShadow.length > 0 && legacyPositive) {
        bothPositiveMessages += 1;
        const hasExact = positiveShadow.some((row) => deterministic.events.has(row.event_candidate));
        const hasCompatible = positiveShadow.some((row) => isCompatible(row.event_candidate, deterministic));
        if (hasExact) exactOverlapMessages += 1;
        else if (hasCompatible) compatibleOnlyMessages += 1;
        else semanticConflictMessages += 1;
      } else if (positiveShadow.length > 0) {
        shadowOnlyPositiveMessages += 1;
      } else if (legacyPositive) {
        legacyOnlyPositiveMessages += 1;
      }

      if (otherShadow.length > 0 && positiveShadow.length === 0) {
        if (legacyPositive) shadowOtherLegacyPositiveMessages += 1;
        else shadowOtherLegacySilentMessages += 1;
      }

      for (const row of positiveShadow) {
        let result: 'exact' | 'compatible' | 'shadowOnly' | 'conflict';
        if (deterministic.events.has(row.event_candidate)) result = 'exact';
        else if (isCompatible(row.event_candidate, deterministic)) result = 'compatible';
        else if (!legacyPositive) result = 'shadowOnly';
        else result = 'conflict';

        bumpEventStats(shadowEventStats, row.event_candidate, result);
        bumpEventStats(
          shadowProfileStats,
          `${row.protocol_id}@${row.protocol_version}`,
          result,
        );
      }
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  const totalMessages = seenMessageIds.size;
  const comparablePositiveMessages = bothPositiveMessages;
  const exactOrCompatibleMessages = exactOverlapMessages + compatibleOnlyMessages;

  console.log(JSON.stringify({
    mode: 'read_only_protocol_cross_parser_consensus_audit',
    provider: provider.name,
    query: env.EMAIL_DISCOVERY_QUERY,
    interpretation: {
      comparator: 'existing independent deterministic commerce + lifecycle parsers',
      comparatorIsGroundTruth: false,
      exactOrCompatibleAgreementIsPrecisionProxyOnly: true,
      shadowOnlyDoesNotMeanFalsePositive: true,
      conflictRequiresManualReview: true,
    },
    safety: {
      databaseWrites: false,
      productionRegistryUsed: false,
      rawEmailOutput: false,
      subjectOutput: false,
      messageIdOutput: false,
      senderAddressOutput: false,
    },
    scope: {
      totalMessages,
      pages,
      maxMessagesSafetyCap: MAX_MESSAGES,
      truncated,
      allTestProfiles: allProfiles.length,
      explicitSenderProfiles: profiles.length,
      excludedGenericProfiles: allProfiles.length - profiles.length,
      senderCandidateMessages,
      senderGateRejectedMessages: totalMessages - senderCandidateMessages,
      fullMessageFetches,
      fullMessageFetchFailures,
      rateLimitRetries,
    },
    consensus: {
      shadowMatchedMessages,
      shadowPositiveMessages,
      shadowOtherOnlyMessages,
      legacyPositiveMessages,
      bothPositiveMessages,
      exactOverlapMessages,
      compatibleOnlyMessages,
      semanticConflictMessages,
      shadowOnlyPositiveMessages,
      legacyOnlyPositiveMessages,
      shadowOtherLegacySilentMessages,
      shadowOtherLegacyPositiveMessages,
      agreementProxyAmongBothPositive:
        comparablePositiveMessages === 0
          ? null
          : Number((exactOrCompatibleMessages / comparablePositiveMessages).toFixed(4)),
      semanticConflictRateAmongBothPositive:
        comparablePositiveMessages === 0
          ? null
          : Number((semanticConflictMessages / comparablePositiveMessages).toFixed(4)),
    },
    byShadowEvent: sortedStatsObject(shadowEventStats),
    byShadowProfile: sortedStatsObject(shadowProfileStats),
    shadowEventCounts: sortedNumberObject(shadowEventCounts),
    legacyEventCounts: sortedNumberObject(legacyEventCounts),
  }, null, 2));
}

main().catch((error) => {
  console.error('Nylas protocol consensus audit failed:', error);
  process.exit(1);
});
