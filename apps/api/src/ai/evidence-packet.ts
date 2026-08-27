import type { EmailHeader } from '../email/types.js';
import {
  collectTechnicalEvidenceV1,
  type TechnicalEvidence,
} from '../extraction-v2/technical-evidence-v1.js';
import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import type { UnresolvedEventPoolSnapshot } from '../purchase-identity-v2/unresolved-event-pool.js';
import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';
import {
  extractDkimDomains,
  extractReturnPathDomains,
} from '../protocols/email-input.js';
import {
  summarizePurchaseJourneyContext,
  type PurchaseJourneyContextSummary,
  type PurchaseJourneyMemoryEvent,
} from './purchase-journey-context.js';

export type SpfVerdict = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'unknown';

export interface EvidencePacketUrl {
  url: string;
  host: string | null;
  source: 'html' | 'text';
}

export interface EvidencePacketStructuredData {
  jsonLd: Array<{
    block: number;
    schemaTypes: string[];
    json: string;
  }>;
  microdata: {
    schemaTypes: string[];
    itemProperties: string[];
  };
  schemaOrgTypes: string[];
  technicalEvidence: Array<Pick<TechnicalEvidence,
    'kind' | 'rawValue' | 'normalizedValue' | 'namespace' | 'source' | 'sourcePath' | 'confidence' | 'qualifiers'
  >>;
}

export interface BuyFlowEvidencePacketV1 {
  schemaVersion: 1;
  currentEmail: {
    source: {
      provider: EmailDocumentV1['provider'];
      providerMessageId: string;
      receivedAt: string;
    };
    sender: {
      primaryEmail: string | null;
      primaryDomain: string | null;
      primaryName: string | null;
      domains: string[];
    };
    authentication: {
      fromDomains: string[];
      replyToDomains: string[];
      returnPathDomains: string[];
      dkimPassDomains: string[];
      spf: SpfVerdict;
    };
    subject: string | null;
    visibleBody: string;
    htmlStructure: string | null;
    urls: EvidencePacketUrl[];
    structuredData: EvidencePacketStructuredData;
    deterministicSignals: {
      orderIds: string[];
      trackingIds: string[];
      amounts: Array<{ amount: number; currency: string }>;
      shippingAmounts: Array<{ amount: number; currency: string }>;
      codAmounts: Array<{ amount: number; currency: string }>;
      products: Array<{
        name: string;
        quantity: number;
        unitPrice: number | null;
        totalPrice: number | null;
        currency: string | null;
      }>;
      carriers: string[];
      paymentMethods: string[];
      shippingMethods: string[];
    };
    attachments: Array<{ filename: string | null; contentType: string | null }>;
  };
  priorJourney: {
    verified: PurchaseJourneyContextSummary;
    unresolved: Array<{
      eventId: string;
      eventType: string;
      status: 'unresolved';
      reason: string;
      receivedAt: string;
      sourceRole: string | null;
      merchantNamespace: string | null;
      orderId: string | null;
      trackingId: string | null;
      carrierId: string | null;
      invoiceId: string | null;
      paymentReference: string | null;
      amount: number | null;
      currency: string | null;
    }>;
  };
}

export interface EvidencePacketPrivacySummaryV1 {
  schemaVersion: 1;
  hasBody: boolean;
  hasHtml: boolean;
  urlCount: number;
  jsonLdBlockCount: number;
  microdataTypeCount: number;
  schemaOrgTypeCount: number;
  technicalEvidenceCount: number;
  deterministicSignalCounts: {
    orderIds: number;
    trackingIds: number;
    amounts: number;
    products: number;
    carriers: number;
  };
  verifiedCandidateCount: number;
  unresolvedCount: number;
  authentication: {
    dkimPassDomainCount: number;
    returnPathDomainCount: number;
    replyToDomainCount: number;
    spf: SpfVerdict;
  };
}

export function buildBuyFlowEvidencePacketV1(input: {
  document: EmailDocumentV1;
  purchaseSnapshot?: PurchaseIdentitySnapshot;
  priorEvents?: PurchaseJourneyMemoryEvent[];
  unresolvedSnapshot?: UnresolvedEventPoolSnapshot;
  maxJourneyCandidates?: number;
  maxUnresolvedEvents?: number;
}): BuyFlowEvidencePacketV1 {
  const document = input.document;
  const technical = collectTechnicalEvidenceV1(document);
  const structured = structuredData(document.html, technical.evidence);
  const purchaseSnapshot = input.purchaseSnapshot ?? emptyPurchaseSnapshot();
  const priorEvents = input.priorEvents ?? [];
  const verified = summarizePurchaseJourneyContext(
    document,
    purchaseSnapshot,
    input.maxJourneyCandidates ?? 5,
    priorEvents,
  );

  return {
    schemaVersion: 1,
    currentEmail: {
      source: {
        provider: document.provider,
        providerMessageId: document.providerMessageId,
        receivedAt: document.receivedAt,
      },
      sender: {
        primaryEmail: document.sender.primaryEmail,
        primaryDomain: document.sender.primaryDomain,
        primaryName: document.sender.primaryName,
        domains: [...document.sender.domains],
      },
      authentication: {
        fromDomains: [...document.sender.domains],
        replyToDomains: extractAddressHeaderDomains(document.headers, 'reply-to'),
        returnPathDomains: extractReturnPathDomains(document.headers),
        dkimPassDomains: extractDkimDomains(document.headers),
        spf: extractSpfVerdict(document.headers),
      },
      subject: document.subject,
      visibleBody: document.text,
      htmlStructure: document.html ? htmlEvidenceLayout(document.html, 20_000) : null,
      urls: extractUrls(document, 60),
      structuredData: structured,
      deterministicSignals: {
        orderIds: document.signals.orderNumbers.slice(0, 20),
        trackingIds: document.signals.trackingNumbers.slice(0, 20),
        amounts: document.signals.amounts.slice(0, 30).map(({ amount, currency }) => ({ amount, currency })),
        shippingAmounts: document.signals.shippingAmounts.slice(0, 10).map(({ amount, currency }) => ({ amount, currency })),
        codAmounts: document.signals.codAmounts.slice(0, 10).map(({ amount, currency }) => ({ amount, currency })),
        products: document.signals.products.slice(0, 30).map((product) => ({
          name: product.name,
          quantity: product.quantity,
          unitPrice: product.unitPrice ?? null,
          totalPrice: product.totalPrice ?? null,
          currency: product.currency ?? null,
        })),
        carriers: document.signals.couriers.slice(0, 10),
        paymentMethods: document.signals.paymentMethods.slice(0, 10),
        shippingMethods: document.signals.shippingMethods.slice(0, 10),
      },
      attachments: document.attachments.slice(0, 20).map((attachment) => ({
        filename: attachment.filename ?? null,
        contentType: attachment.contentType ?? null,
      })),
    },
    priorJourney: {
      verified,
      unresolved: unresolvedContext(
        document,
        input.unresolvedSnapshot,
        input.maxUnresolvedEvents ?? 20,
      ),
    },
  };
}

/** JSON is intended for in-memory model input only. Never log this raw value. */
export function serializeBuyFlowEvidencePacketV1(packet: BuyFlowEvidencePacketV1): string {
  return JSON.stringify(packet);
}

/** Safe for diagnostics: contains counts/statuses only, never raw mail or identifiers. */
export function summarizeEvidencePacketV1(packet: BuyFlowEvidencePacketV1): EvidencePacketPrivacySummaryV1 {
  const signals = packet.currentEmail.deterministicSignals;
  return {
    schemaVersion: 1,
    hasBody: packet.currentEmail.visibleBody.length > 0,
    hasHtml: packet.currentEmail.htmlStructure !== null,
    urlCount: packet.currentEmail.urls.length,
    jsonLdBlockCount: packet.currentEmail.structuredData.jsonLd.length,
    microdataTypeCount: packet.currentEmail.structuredData.microdata.schemaTypes.length,
    schemaOrgTypeCount: packet.currentEmail.structuredData.schemaOrgTypes.length,
    technicalEvidenceCount: packet.currentEmail.structuredData.technicalEvidence.length,
    deterministicSignalCounts: {
      orderIds: signals.orderIds.length,
      trackingIds: signals.trackingIds.length,
      amounts: signals.amounts.length,
      products: signals.products.length,
      carriers: signals.carriers.length,
    },
    verifiedCandidateCount: packet.priorJourney.verified.candidateCount,
    unresolvedCount: packet.priorJourney.unresolved.length,
    authentication: {
      dkimPassDomainCount: packet.currentEmail.authentication.dkimPassDomains.length,
      returnPathDomainCount: packet.currentEmail.authentication.returnPathDomains.length,
      replyToDomainCount: packet.currentEmail.authentication.replyToDomains.length,
      spf: packet.currentEmail.authentication.spf,
    },
  };
}

export function extractSpfVerdict(headers: EmailHeader[]): SpfVerdict {
  const values = [
    ...headerValues(headers, 'authentication-results'),
    ...headerValues(headers, 'arc-authentication-results'),
    ...headerValues(headers, 'received-spf'),
  ];
  const allowed = new Set<SpfVerdict>([
    'pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror',
  ]);
  for (const value of values) {
    const match = /(?:^|[;\s])spf\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/i.exec(value)
      ?? /^\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/i.exec(value);
    const verdict = match?.[1]?.toLowerCase() as SpfVerdict | undefined;
    if (verdict && allowed.has(verdict)) return verdict;
  }
  return 'unknown';
}

function unresolvedContext(
  document: EmailDocumentV1,
  snapshot: UnresolvedEventPoolSnapshot | undefined,
  maxEvents: number,
): BuyFlowEvidencePacketV1['priorJourney']['unresolved'] {
  return (snapshot?.records ?? [])
    .filter((record) => record.userId && record.status === 'unresolved')
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    .slice(0, Math.max(0, maxEvents))
    .map((record) => ({
      eventId: record.eventId,
      eventType: record.event.eventType,
      status: 'unresolved' as const,
      reason: record.reason,
      receivedAt: record.event.receivedAt,
      sourceRole: record.event.sourceRole ?? null,
      merchantNamespace: record.event.merchantNamespace ?? null,
      orderId: record.event.orderIdNormalized ?? record.event.orderIdRaw,
      trackingId: record.event.trackingIdNormalized ?? record.event.trackingIdRaw,
      carrierId: record.event.carrierId ?? null,
      invoiceId: record.event.invoiceIdNormalized ?? record.event.invoiceIdRaw,
      paymentReference: record.event.paymentReference,
      amount: record.event.amount,
      currency: record.event.currency,
    }));
}

function structuredData(html: string | null, rows: TechnicalEvidence[]): EvidencePacketStructuredData {
  const jsonLd = extractJsonLdBlocks(html);
  const microdata = extractMicrodata(html);
  const schemaTypes = new Set<string>();
  for (const block of jsonLd) for (const type of block.schemaTypes) schemaTypes.add(type);
  for (const type of microdata.schemaTypes) schemaTypes.add(type);

  return {
    jsonLd,
    microdata,
    schemaOrgTypes: [...schemaTypes].sort(),
    technicalEvidence: rows
      .filter((row) => row.source !== 'authentication')
      .slice(0, 100)
      .map((row) => ({
        kind: row.kind,
        rawValue: row.rawValue,
        ...(row.normalizedValue !== undefined ? { normalizedValue: row.normalizedValue } : {}),
        ...(row.namespace !== undefined ? { namespace: row.namespace } : {}),
        source: row.source,
        sourcePath: row.sourcePath,
        confidence: row.confidence,
        ...(row.qualifiers ? { qualifiers: [...row.qualifiers] } : {}),
      })),
  };
}

function extractJsonLdBlocks(html: string | null): EvidencePacketStructuredData['jsonLd'] {
  if (!html) return [];
  const results: EvidencePacketStructuredData['jsonLd'] = [];
  const pattern = /<script\b[^>]*type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let block = 0;
  for (const match of html.matchAll(pattern)) {
    const raw = decodeBasicHtmlEntities((match[1] ?? '').trim())
      .replace(/^<!--\s*/, '')
      .replace(/\s*-->$/, '')
      .trim();
    if (!raw) {
      block += 1;
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      results.push({
        block,
        schemaTypes: collectJsonLdTypes(parsed).slice(0, 30),
        json: boundedJson(parsed, 6_000),
      });
    } catch {
      // Malformed JSON-LD is intentionally not forwarded as trusted structure.
    }
    block += 1;
    if (results.length >= 10) break;
  }
  return results;
}

function collectJsonLdTypes(value: unknown): string[] {
  const types = new Set<string>();
  const seen = new Set<object>();
  function walk(current: unknown): void {
    if (!current || typeof current !== 'object') return;
    if (seen.has(current as object)) return;
    seen.add(current as object);
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }
    const record = current as Record<string, unknown>;
    const rawType = record['@type'];
    for (const item of Array.isArray(rawType) ? rawType : [rawType]) {
      if (typeof item === 'string' && item.trim()) types.add(schemaTypeName(item));
    }
    for (const child of Object.values(record)) walk(child);
  }
  walk(value);
  return [...types].sort();
}

function extractMicrodata(html: string | null): EvidencePacketStructuredData['microdata'] {
  if (!html) return { schemaTypes: [], itemProperties: [] };
  const types = new Set<string>();
  const properties = new Set<string>();
  for (const match of html.matchAll(/\bitemtype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    for (const value of raw.split(/\s+/).filter(Boolean)) types.add(schemaTypeName(value));
  }
  for (const match of html.matchAll(/\bitemprop\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    for (const value of raw.split(/\s+/).filter(Boolean)) properties.add(value);
  }
  return {
    schemaTypes: [...types].sort().slice(0, 50),
    itemProperties: [...properties].sort().slice(0, 100),
  };
}

function extractUrls(document: EmailDocumentV1, maxUrls: number): EvidencePacketUrl[] {
  const results: EvidencePacketUrl[] = [];
  const seen = new Set<string>();
  function push(raw: string, source: EvidencePacketUrl['source']) {
    const value = decodeBasicHtmlEntities(raw.trim()).replace(/[),.;]+$/, '');
    if (!/^https?:\/\//i.test(value) || value.length > 1_500 || seen.has(value)) return;
    seen.add(value);
    let host: string | null = null;
    try { host = new URL(value).hostname.toLowerCase(); } catch { /* preserve URL as unparsed evidence */ }
    results.push({ url: value, host, source });
  }

  if (document.html) {
    for (const match of document.html.matchAll(/\b(?:href|action)\s*=\s*(?:"(https?:\/\/[^"#]+(?:#[^"]*)?)"|'(https?:\/\/[^'#]+(?:#[^']*)?)'|(https?:\/\/[^\s>]+))/gi)) {
      push(match[1] ?? match[2] ?? match[3] ?? '', 'html');
      if (results.length >= maxUrls) return results;
    }
  }
  for (const match of document.text.matchAll(/https?:\/\/[^\s<>'"]+/gi)) {
    push(match[0], 'text');
    if (results.length >= maxUrls) break;
  }
  return results;
}

function htmlEvidenceLayout(html: string, maxChars: number): string {
  return decodeBasicHtmlEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<table\b[^>]*>/gi, '\n[TABLE]\n')
    .replace(/<\/table\s*>/gi, '\n[/TABLE]\n')
    .replace(/<tr\b[^>]*>/gi, '\n[ROW] ')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<th\b[^>]*>/gi, '[HEADER] ')
    .replace(/<\/th\s*>/gi, ' | ')
    .replace(/<td\b[^>]*>/gi, '[CELL] ')
    .replace(/<\/td\s*>/gi, ' | ')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n[HEADING] ')
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, maxChars);
}

function extractAddressHeaderDomains(headers: EmailHeader[], name: string): string[] {
  const domains = new Set<string>();
  for (const value of headerValues(headers, name)) {
    for (const match of value.matchAll(/@([^>\s,;]+)/g)) {
      const domain = normalizeDomain(match[1] ?? '');
      if (domain) domains.add(domain);
    }
  }
  return [...domains].sort();
}

function headerValues(headers: EmailHeader[], name: string): string[] {
  const wanted = name.toLowerCase();
  return headers
    .filter((header) => header.name.trim().toLowerCase() === wanted)
    .map((header) => header.value);
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/^<|>$/g, '').replace(/\.$/, '');
}

function schemaTypeName(value: string): string {
  return value.trim().split(/[\/#]/).filter(Boolean).pop() ?? value.trim();
}

function boundedJson(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value);
  return json.length <= maxChars ? json : `${json.slice(0, maxChars)}…`;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function emptyPurchaseSnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}
