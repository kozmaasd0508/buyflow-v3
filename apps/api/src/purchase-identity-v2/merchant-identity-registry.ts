import type { ExtractionV2MerchantIdentityResolver } from './extraction-v2-adapter.js';
import type { EvidenceProvenance, MerchantIdentityDefinition } from './types.js';

export type MerchantIdentityResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous' | 'conflict';

export interface MerchantIdentityResolution {
  status: MerchantIdentityResolutionStatus;
  merchantId: string | null;
  aliasCandidateIds: string[];
  domainCandidateIds: string[];
  reasons: string[];
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeDomain(value: string | null | undefined): string | null {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  return normalized || null;
}

function domainMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const normalizedExpected = normalizeDomain(expected);
  if (!normalizedExpected) return false;
  return actual === normalizedExpected || actual.endsWith(`.${normalizedExpected}`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function merchantAliases(definition: MerchantIdentityDefinition): string[] {
  return unique([
    definition.canonicalName,
    ...definition.storefrontAliases,
  ].map(normalizeName).filter(Boolean));
}

function merchantDomains(definition: MerchantIdentityDefinition): string[] {
  return unique([
    ...definition.domains,
    ...definition.senderDomains,
  ].map((value) => normalizeDomain(value)).filter((value): value is string => Boolean(value)));
}

function relevantMerchantProvenance(provenance: EvidenceProvenance[]): EvidenceProvenance[] {
  return provenance.filter((item) => item.field === 'merchant');
}

/**
 * Deterministic canonical merchant identity resolver.
 *
 * Auto-resolution deliberately requires two independent namespace signals:
 * an exact canonical-name/storefront-alias match AND a sender-domain match to
 * the same registry identity. There is no fuzzy contains matching and no
 * domain-only promotion. If alias and domain point to different identities the
 * result is conflict, never a guessed winner.
 */
export class MerchantIdentityRegistry implements ExtractionV2MerchantIdentityResolver {
  private readonly definitions: MerchantIdentityDefinition[];

  constructor(definitions: MerchantIdentityDefinition[]) {
    const ids = definitions.map((definition) => definition.merchantId.trim()).filter(Boolean);
    if (ids.length !== definitions.length) throw new Error('Merchant identity definitions require non-empty merchantId values.');
    if (new Set(ids).size !== ids.length) throw new Error('Merchant identity definitions require unique merchantId values.');
    this.definitions = definitions.map((definition) => ({
      ...definition,
      merchantId: definition.merchantId.trim(),
      canonicalName: definition.canonicalName.trim(),
      domains: [...definition.domains],
      senderDomains: [...definition.senderDomains],
      storefrontAliases: [...definition.storefrontAliases],
      invoiceIssuers: [...definition.invoiceIssuers],
      paymentDescriptors: [...definition.paymentDescriptors],
    }));
  }

  resolve(input: {
    merchantRaw: string;
    senderDomain: string | null;
    provenance: EvidenceProvenance[];
  }): string | null {
    return this.resolveDetailed(input).merchantId;
  }

  resolveDetailed(input: {
    merchantRaw: string;
    senderDomain: string | null;
    provenance: EvidenceProvenance[];
  }): MerchantIdentityResolution {
    const merchantName = normalizeName(input.merchantRaw);
    const senderDomain = normalizeDomain(input.senderDomain);
    const merchantProvenance = relevantMerchantProvenance(input.provenance);

    if (!merchantName) {
      return {
        status: 'unresolved',
        merchantId: null,
        aliasCandidateIds: [],
        domainCandidateIds: [],
        reasons: ['merchant_name_missing_after_normalization'],
      };
    }

    const aliasCandidateIds = unique(this.definitions
      .filter((definition) => merchantAliases(definition).includes(merchantName))
      .map((definition) => definition.merchantId));
    const domainCandidateIds = unique(this.definitions
      .filter((definition) => merchantDomains(definition).some((domain) => domainMatches(senderDomain, domain)))
      .map((definition) => definition.merchantId));

    if (aliasCandidateIds.length > 1 || domainCandidateIds.length > 1) {
      return {
        status: 'ambiguous',
        merchantId: null,
        aliasCandidateIds,
        domainCandidateIds,
        reasons: ['merchant_registry_signal_is_not_unique'],
      };
    }

    const aliasId = aliasCandidateIds[0] ?? null;
    const domainId = domainCandidateIds[0] ?? null;

    if (aliasId && domainId && aliasId !== domainId) {
      return {
        status: 'conflict',
        merchantId: null,
        aliasCandidateIds,
        domainCandidateIds,
        reasons: ['merchant_alias_and_sender_domain_disagree'],
      };
    }

    if (aliasId && domainId && aliasId === domainId) {
      return {
        status: 'resolved',
        merchantId: aliasId,
        aliasCandidateIds,
        domainCandidateIds,
        reasons: [
          'exact_merchant_alias_match',
          'matching_sender_domain_namespace',
          ...(merchantProvenance.length > 0 ? ['merchant_field_provenance_present'] : []),
        ],
      };
    }

    return {
      status: 'unresolved',
      merchantId: null,
      aliasCandidateIds,
      domainCandidateIds,
      reasons: [
        ...(aliasId ? ['alias_match_without_sender_domain_corroboration'] : []),
        ...(domainId ? ['sender_domain_match_without_exact_merchant_alias'] : []),
        ...(!aliasId && !domainId ? ['no_registry_identity_match'] : []),
      ],
    };
  }
}
