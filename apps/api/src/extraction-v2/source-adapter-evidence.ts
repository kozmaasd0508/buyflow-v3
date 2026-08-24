import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { currentMessageLines } from './event-type-extractor.js';
import type { EvidenceClaim } from './types.js';

export const SOURCE_ADAPTER_EVIDENCE_VERSION = 'source-adapter-evidence-v1';

type DirectCarrierProfile = {
  name: string;
  domains: string[];
};

const DIRECT_CARRIERS: DirectCarrierProfile[] = [
  { name: 'Express One', domains: ['expressone.hu'] },
  { name: 'GLS', domains: ['gls-hungary.com'] },
  { name: 'DPD', domains: ['dpd.hu'] },
  { name: 'Foxpost', domains: ['foxpost.hu'] },
  { name: 'Packeta', domains: ['packeta.hu', 'packeta.com'] },
  { name: 'MPL', domains: ['posta.hu'] },
  { name: 'DHL', domains: ['dhl.com'] },
  { name: 'UPS', domains: ['ups.com'] },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
}

function domainMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const normalized = actual.trim().toLowerCase().replace(/\.$/, '');
  return normalized === expected || normalized.endsWith(`.${expected}`);
}

function directCarrierForDomain(domain: string | null): DirectCarrierProfile | null {
  return DIRECT_CARRIERS.find((profile) => profile.domains.some((candidate) => domainMatches(domain, candidate))) ?? null;
}

function passingDkimDomains(document: EmailDocumentV1): string[] {
  const domains: string[] = [];
  for (const header of document.headers) {
    if (header.name.trim().toLowerCase() !== 'authentication-results') continue;
    const value = header.value.toLowerCase();
    if (!/\bdkim=pass\b/.test(value)) continue;
    for (const match of value.matchAll(/\b(?:header\.d|d)=([a-z0-9.-]+)/gi)) {
      const domain = match[1]?.replace(/\.$/, '').toLowerCase();
      if (domain) domains.push(domain);
    }
  }
  return [...new Set(domains)];
}

function isDkimAuthenticated(document: EmailDocumentV1, profile: DirectCarrierProfile): boolean {
  const domains = passingDkimDomains(document);
  return domains.some((actual) => profile.domains.some((expected) => domainMatches(actual, expected)));
}

function currentText(document: EmailDocumentV1): string {
  return normalizeText([
    document.subject ?? '',
    ...currentMessageLines(document.text),
  ].join('\n'));
}

const DIRECT_DELIVERY = /\b(?:sikeresen\s+kezbesitett|kezbesitve|successfully\s+delivered|has\s+been\s+delivered)\b/i;
const DIRECT_SHIPMENT = /\b(?:kezbesitesre\s+(?:atvette|atvettuk)|futar(?:unk)?\s+a\s+mai\s+napon|kuldemeny(?:enek)?\s+feldolgozasat\s+megkezdtuk|out\s+for\s+delivery|in\s+transit|shipment\s+(?:accepted|picked\s+up)|parcel\s+(?:accepted|picked\s+up))\b/i;

function claim(input: {
  field: 'carrier' | 'event_type';
  value: string;
  confidence: number;
  qualifier: string;
}): EvidenceClaim<string> {
  return {
    field: input.field,
    value: input.value,
    confidence: input.confidence,
    source: 'provider_adapter',
    extractorId: 'source-adapter-evidence',
    extractorVersion: SOURCE_ADAPTER_EVIDENCE_VERSION,
    qualifiers: [input.qualifier],
  };
}

/**
 * Additive shadow evidence from a direct source identity. This never suppresses
 * universal extractors and does not write production data. Sender-domain identity
 * can contribute carrier identity in shadow, but source-specific lifecycle
 * promotion requires matching DKIM pass evidence.
 */
export function deriveSourceAdapterEvidence(document: EmailDocumentV1): EvidenceClaim[] {
  const profile = directCarrierForDomain(document.sender.primaryDomain);
  if (!profile) return [];

  const authenticated = isDkimAuthenticated(document, profile);
  const claims: EvidenceClaim[] = [claim({
    field: 'carrier',
    value: profile.name,
    confidence: authenticated ? 0.995 : 0.90,
    qualifier: authenticated ? 'authenticated_direct_carrier_sender' : 'direct_carrier_sender',
  })];

  if (!authenticated) return claims;

  const text = currentText(document);
  if (DIRECT_DELIVERY.test(text)) {
    claims.push(claim({
      field: 'event_type',
      value: 'delivery',
      confidence: 0.995,
      qualifier: 'direct_carrier_delivery_event',
    }));
  } else if (DIRECT_SHIPMENT.test(text)) {
    claims.push(claim({
      field: 'event_type',
      value: 'shipment',
      confidence: 0.99,
      qualifier: 'direct_carrier_shipment_event',
    }));
  }

  return claims;
}
