import { createHmac } from 'node:crypto';
import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { env, requireNylasSmokeGrantId } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { parseDeterministicCommerceEmail } from '../ingestion/deterministic-commerce-parser.js';
import { parseDeterministicLifecycleEmail } from '../ingestion/deterministic-lifecycle-parser.js';
import { parseGenericLifecycleObservations } from '../ingestion/generic-lifecycle-adapter.js';
import {
  resolveGenericLifecycleLinkCandidate,
  type GenericLifecyclePurchaseIdentity,
  type GenericLifecycleShipmentIdentity,
} from '../ingestion/generic-lifecycle-linker.js';

const PAGE_SIZE = 20;
const MAX_MESSAGES = Math.min(
  Math.max(Number.parseInt(process.env.GENERIC_LIFECYCLE_AUDIT_MAX_MESSAGES ?? '10000', 10) || 10_000, 1),
  10_000,
);
const BODY_MAX_CHARS = 80_000;
const DB_PAGE_SIZE = 1000;
const MAX_RETRIES = 6;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const FINGERPRINT_KEY = process.env.GENERIC_LIFECYCLE_AUDIT_HMAC_KEY ?? '';

type ErrorLike = { statusCode?: unknown; headers?: unknown };
type PurchaseRow = { id: string; user_id: string; merchant_domain: string | null; order_number: string | null };
type ShipmentRow = { purchase_id: string | null; tracking_number: string | null };
type SourceShape = {
  senderFingerprint: string;
  receivedDay: string;
  observationCount: number;
  eventShape: string;
  decision: string;
  hasOrderNumber: boolean;
  hasTrackingNumber: boolean;
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

async function withRetry<T>(operation: () => Promise<T>, onRetry: () => void): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const status = statusCodeOf(error);
      if (status === null || !RETRYABLE_STATUS_CODES.has(status) || attempt >= MAX_RETRIES) throw error;
      const retryAfter = retryAfterMsOf(error) ?? 0;
      const backoff = Math.min(60_000, 5_000 * (2 ** attempt));
      onRetry();
      attempt += 1;
      await sleep(Math.max(retryAfter, backoff) + Math.floor(Math.random() * 750));
    }
  }
}

function domainOf(address: string): string {
  const normalized = address.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  return at >= 0 ? normalized.slice(at + 1) : '';
}

function senderEvidence(email: NormalizedEmail) {
  const senderEmails = email.from.map((sender) => sender.email.trim().toLowerCase()).filter(Boolean);
  const senderDomains = [...new Set(senderEmails.map(domainOf).filter(Boolean))];
  return { senderEmails, senderDomains };
}

function bodyText(email: NormalizedEmail): string {
  return email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, BODY_MAX_CHARS)
    : (email.snippet ?? '').trim().slice(0, BODY_MAX_CHARS);
}

function fingerprint(domain: string): string {
  if (!FINGERPRINT_KEY) throw new Error('GENERIC_LIFECYCLE_AUDIT_HMAC_KEY is required');
  return createHmac('sha256', FINGERPRINT_KEY).update(domain.trim().toLowerCase()).digest('hex').slice(0, 24);
}

function receivedDay(receivedAt: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(receivedAt.trim())?.[0] ?? 'unknown-day';
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function loadAll<T>(builderFactory: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += DB_PAGE_SIZE) {
    const { data, error } = await builderFactory(offset, offset + DB_PAGE_SIZE - 1);
    if (error) throw new Error(`Read-only audit query failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < DB_PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  const grantId = requireNylasSmokeGrantId();
  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: grantId });
  const db = getSupabaseAdmin() as any;

  const { data: connection, error: connectionError } = await db.from('email_connections')
    .select('user_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', grantId)
    .eq('status', 'active')
    .maybeSingle();
  if (connectionError) throw new Error(`Read-only audit grant lookup failed: ${connectionError.message}`);
  if (!connection?.user_id) throw new Error('Read-only audit grant has no active user');
  const userId = String(connection.user_id);

  const purchaseRows = await loadAll<PurchaseRow>(async (from, to) => db.from('purchases')
    .select('id,user_id,merchant_domain,order_number')
    .eq('user_id', userId)
    .range(from, to));
  const shipmentRows = await loadAll<ShipmentRow>(async (from, to) => db.from('shipments')
    .select('purchase_id,tracking_number')
    .eq('user_id', userId)
    .range(from, to));

  const purchases: GenericLifecyclePurchaseIdentity[] = purchaseRows.map((row) => ({
    purchaseId: String(row.id),
    userId: String(row.user_id),
    merchantDomain: row.merchant_domain,
    orderNumber: row.order_number,
  }));
  const shipments: GenericLifecycleShipmentIdentity[] = shipmentRows.map((row) => ({
    purchaseId: row.purchase_id,
    trackingNumber: row.tracking_number,
  }));

  const seen = new Set<string>();
  const eventCounts = new Map<string, number>();
  const phaseCounts = new Map<string, number>();
  const sourceObservationCounts = new Map<string, number>();
  const decisionCounts = new Map<string, number>();
  const multiSenderFingerprints = new Map<string, number>();
  const sourceShapes: SourceShape[] = [];

  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let rateLimitRetries = 0;
  let messagesWithListBody = 0;
  let fullMessageFetches = 0;
  let fullMessageFetchFailures = 0;
  let rawCandidateSources = 0;
  let deterministicPreemptions = 0;
  let fallbackSources = 0;
  let totalObservations = 0;
  let multiObservationSources = 0;
  let orderDomainLinkable = 0;
  let trackingLinkable = 0;
  let ambiguous = 0;
  let conflicts = 0;
  let unmatched = 0;

  do {
    const page = await withRetry(
      () => provider.searchMessages({ query: env.EMAIL_DISCOVERY_QUERY, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
      () => { rateLimitRetries += 1; },
    );
    pages += 1;

    for (const listed of page.messages) {
      if (seen.has(listed.providerMessageId)) continue;
      if (seen.size >= MAX_MESSAGES) {
        truncated = true;
        break;
      }
      seen.add(listed.providerMessageId);

      let email = listed;
      if (listed.bodyHtml && listed.bodyHtml.trim().length > 0) {
        messagesWithListBody += 1;
      } else {
        fullMessageFetches += 1;
        try {
          email = await withRetry(() => provider.getMessage(listed.providerMessageId), () => { rateLimitRetries += 1; });
        } catch {
          fullMessageFetchFailures += 1;
          continue;
        }
      }

      const senders = senderEvidence(email);
      const text = bodyText(email);
      const observations = parseGenericLifecycleObservations({
        senderDomains: senders.senderDomains,
        subject: email.subject,
        bodyText: text,
      });
      if (observations.length === 0) continue;
      rawCandidateSources += 1;

      const deterministicLifecycle = parseDeterministicLifecycleEmail({
        senderDomains: senders.senderDomains,
        senderEmails: senders.senderEmails,
        subject: email.subject,
        bodyText: text,
      });
      const deterministicCommerce = parseDeterministicCommerceEmail({
        senderDomains: senders.senderDomains,
        subject: email.subject,
        bodyText: text,
      });
      if (deterministicLifecycle || deterministicCommerce) {
        deterministicPreemptions += 1;
        continue;
      }

      fallbackSources += 1;
      totalObservations += observations.length;
      bump(sourceObservationCounts, String(observations.length));
      for (const observation of observations) {
        bump(eventCounts, observation.extraction.event_type);
        bump(phaseCounts, observation.shipmentPhase ?? 'none');
      }

      const primary = observations[0]!;
      const orderNumber = observations
        .map((observation) => observation.extraction.order_number)
        .find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;
      const trackingNumber = observations
        .map((observation) => observation.extraction.tracking_number)
        .find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;
      const resolved = resolveGenericLifecycleLinkCandidate({
        userId,
        senderDomain: primary.senderDomain,
        orderNumber,
        trackingNumber,
        purchases,
        shipments,
      });
      bump(decisionCounts, resolved.decision);

      if (resolved.decision === 'linked_order_domain') orderDomainLinkable += 1;
      else if (resolved.decision === 'linked_tracking') trackingLinkable += 1;
      else if (resolved.decision === 'ambiguous') ambiguous += 1;
      else if (resolved.decision === 'conflict') conflicts += 1;
      else unmatched += 1;

      const fp = fingerprint(primary.senderDomain);
      if (observations.length > 1) {
        multiObservationSources += 1;
        bump(multiSenderFingerprints, fp);
      }
      sourceShapes.push({
        senderFingerprint: fp,
        receivedDay: receivedDay(email.receivedAt),
        observationCount: observations.length,
        eventShape: observations.map((observation) => `${observation.extraction.event_type}:${observation.shipmentPhase ?? 'none'}`).join('+'),
        decision: resolved.decision,
        hasOrderNumber: Boolean(orderNumber),
        hasTrackingNumber: Boolean(trackingNumber),
      });
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  sourceShapes.sort((a, b) => a.receivedDay.localeCompare(b.receivedDay)
    || a.senderFingerprint.localeCompare(b.senderFingerprint)
    || a.eventShape.localeCompare(b.eventShape));

  console.log(JSON.stringify({
    mode: 'read_only_generic_lifecycle_v13_multi_observation_audit',
    parserTarget: 'generic-lifecycle-v1.3',
    provider: provider.name,
    query: env.EMAIL_DISCOVERY_QUERY,
    safety: {
      databaseWrites: false,
      sourceEmailWrites: false,
      purchaseSourceWrites: false,
      purchaseWrites: false,
      shipmentWrites: false,
      documentWrites: false,
      productionRegistryUsed: false,
      rawEmailOutput: false,
      subjectOutput: false,
      messageIdOutput: false,
      senderAddressOutput: false,
      senderDomainOutput: false,
      orderIdOutput: false,
      trackingIdOutput: false,
      invoiceIdOutput: false,
      amountOutput: false,
      productOutput: false,
    },
    interpretation: {
      sourceUnit: 'one email remains one source unit even when multiple review observations exist',
      observationUnit: 'independent shadow/review semantic fact inside one source email',
      hardLinkable: 'exact order+merchant-domain or exact existing tracking resolved to exactly one existing Purchase',
      noDomainTimeFallback: true,
      automaticPurchaseCreationAllowed: false,
      automaticStateMutationAllowed: false,
      automaticDocumentCreationAllowed: false,
    },
    scope: {
      totalMessages: seen.size,
      pages,
      maxMessagesSafetyCap: MAX_MESSAGES,
      truncated,
      messagesWithListBody,
      listMessagesWithoutBody: seen.size - messagesWithListBody,
      fullMessageFetches,
      fullMessageFetchFailures,
      rateLimitRetries,
      existingPurchasesLoaded: purchases.length,
      existingShipmentsLoaded: shipments.length,
    },
    candidates: {
      rawCandidateSources,
      deterministicPreemptions,
      fallbackSources,
      totalObservations,
      multiObservationSources,
      distinctMultiObservationSenderFingerprints: multiSenderFingerprints.size,
      orderDomainLinkable,
      trackingLinkable,
      totalHardLinkable: orderDomainLinkable + trackingLinkable,
      ambiguous,
      conflicts,
      unmatched,
    },
    sourceObservationCounts: sortedObject(sourceObservationCounts),
    eventCounts: sortedObject(eventCounts),
    shipmentPhaseCounts: sortedObject(phaseCounts),
    linkDecisionCounts: sortedObject(decisionCounts),
    multiObservationSenderFingerprints: sortedObject(multiSenderFingerprints),
    sourceShapes,
  }, null, 2));
}

main().catch((error) => {
  console.error('Nylas generic lifecycle v1.3 audit failed:', error instanceof Error ? error.message : 'UnknownError');
  process.exit(1);
});
