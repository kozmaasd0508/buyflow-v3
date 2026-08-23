import type { ExtractionV2MerchantIdentityResolver } from './extraction-v2-adapter.js';
import type {
  EvidenceProvenance,
  IdentityRecordStatus,
  MerchantIdentityDefinition,
  MerchantIdentitySignalDefinition,
  MerchantIdentitySignalKind,
} from './types.js';

export type MerchantIdentityResolutionStatus = 'resolved' | 'unresolved' | 'ambiguous' | 'conflict';

export interface MerchantIdentityMatchedSignal {
  merchantId: string;
  kind: MerchantIdentitySignalKind;
  value: string;
  status: IdentityRecordStatus;
  validFrom: string | null;
  validTo: string | null;
  evidenceSource: string | null;
}

export interface MerchantIdentityResolution {
  status: MerchantIdentityResolutionStatus;
  merchantId: string | null;
  aliasCandidateIds: string[];
  domainCandidateIds: string[];
  matchedSignals: MerchantIdentityMatchedSignal[];
  registryVersion: string;
  reasons: string[];
}

interface NormalizedSignal extends MerchantIdentityMatchedSignal {
  normalizedValue: string;
  definitionStatus: IdentityRecordStatus;
  definitionValidFrom: string | null;
  definitionValidTo: string | null;
}

export interface MerchantIdentityRegistryOptions {
  registryVersion?: string;
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

function recordStatus(value: IdentityRecordStatus | undefined): IdentityRecordStatus {
  return value ?? 'active';
}

function timestampOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assertTimestamp(label: string, value: string | null | undefined): void {
  if (value && timestampOrNull(value) === null) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
}

function assertWindow(label: string, validFrom: string | null | undefined, validTo: string | null | undefined): void {
  assertTimestamp(`${label}.validFrom`, validFrom);
  assertTimestamp(`${label}.validTo`, validTo);
  const from = timestampOrNull(validFrom);
  const to = timestampOrNull(validTo);
  if (from !== null && to !== null && to <= from) {
    throw new Error(`${label} requires validTo to be later than validFrom.`);
  }
}

function withinWindow(observedAt: number, validFrom: string | null, validTo: string | null): boolean {
  const from = timestampOrNull(validFrom);
  const to = timestampOrNull(validTo);
  if (from !== null && observedAt < from) return false;
  if (to !== null && observedAt >= to) return false;
  return true;
}

function signalUsable(signal: NormalizedSignal, observedAt: number | null): boolean {
  if (signal.definitionStatus === 'disabled' || signal.status === 'disabled') return false;

  if (observedAt === null) {
    const requiresObservationTime =
      signal.definitionStatus === 'historical'
      || signal.status === 'historical'
      || Boolean(signal.definitionValidFrom)
      || Boolean(signal.definitionValidTo)
      || Boolean(signal.validFrom)
      || Boolean(signal.validTo);
    return !requiresObservationTime;
  }

  return withinWindow(observedAt, signal.definitionValidFrom, signal.definitionValidTo)
    && withinWindow(observedAt, signal.validFrom, signal.validTo);
}

function legacySignal(input: {
  definition: MerchantIdentityDefinition;
  kind: MerchantIdentitySignalKind;
  value: string;
}): MerchantIdentitySignalDefinition {
  return {
    kind: input.kind,
    value: input.value,
    status: input.definition.status,
    validFrom: input.definition.validFrom,
    validTo: input.definition.validTo,
    evidenceSource: input.definition.evidenceSource,
  };
}

function normalizedSignals(definition: MerchantIdentityDefinition): NormalizedSignal[] {
  const rawSignals: MerchantIdentitySignalDefinition[] = [
    legacySignal({ definition, kind: 'canonical_name', value: definition.canonicalName }),
    ...definition.storefrontAliases.map((value) => legacySignal({ definition, kind: 'storefront_alias', value })),
    ...definition.domains.map((value) => legacySignal({ definition, kind: 'domain', value })),
    ...definition.senderDomains.map((value) => legacySignal({ definition, kind: 'sender_domain', value })),
    ...(definition.identitySignals ?? []),
  ];

  return rawSignals
    .map((signal) => {
      const isDomain = signal.kind === 'domain' || signal.kind === 'sender_domain';
      const normalizedValue = isDomain
        ? normalizeDomain(signal.value) ?? ''
        : normalizeName(signal.value);
      return {
        merchantId: definition.merchantId,
        kind: signal.kind,
        value: signal.value.trim(),
        normalizedValue,
        status: recordStatus(signal.status ?? definition.status),
        validFrom: signal.validFrom ?? definition.validFrom ?? null,
        validTo: signal.validTo ?? definition.validTo ?? null,
        evidenceSource: signal.evidenceSource ?? definition.evidenceSource ?? null,
        definitionStatus: recordStatus(definition.status),
        definitionValidFrom: definition.validFrom ?? null,
        definitionValidTo: definition.validTo ?? null,
      } satisfies NormalizedSignal;
    })
    .filter((signal) => Boolean(signal.value) && Boolean(signal.normalizedValue));
}

function relevantMerchantProvenance(provenance: EvidenceProvenance[]): EvidenceProvenance[] {
  return provenance.filter((item) => item.field === 'merchant');
}

function publicSignal(signal: NormalizedSignal): MerchantIdentityMatchedSignal {
  return {
    merchantId: signal.merchantId,
    kind: signal.kind,
    value: signal.value,
    status: signal.status,
    validFrom: signal.validFrom,
    validTo: signal.validTo,
    evidenceSource: signal.evidenceSource,
  };
}

function uniqueMatchedSignals(signals: NormalizedSignal[]): MerchantIdentityMatchedSignal[] {
  const byKey = new Map<string, MerchantIdentityMatchedSignal>();
  for (const signal of signals) {
    const item = publicSignal(signal);
    const key = [
      item.merchantId,
      item.kind,
      item.value,
      item.status,
      item.validFrom ?? '',
      item.validTo ?? '',
      item.evidenceSource ?? '',
    ].join('|');
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.merchantId}|${a.kind}|${a.value}`.localeCompare(`${b.merchantId}|${b.kind}|${b.value}`),
  );
}

/**
 * Deterministic canonical merchant identity resolver.
 *
 * Auto-resolution requires two independent namespace signals: an exact merchant
 * name/alias match AND a sender-domain match to the same registry identity.
 * Time-bounded or historical signals are evaluated against the email's observed
 * timestamp, so a provider can safely change names or domains without rewriting
 * historical identity. Disabled signals never resolve. Unknown or conflicting
 * signals never guess a winner.
 */
export class MerchantIdentityRegistry implements ExtractionV2MerchantIdentityResolver {
  private readonly definitions: MerchantIdentityDefinition[];
  private readonly registryVersion: string;

  constructor(definitions: MerchantIdentityDefinition[], options: MerchantIdentityRegistryOptions = {}) {
    const ids = definitions.map((definition) => definition.merchantId.trim()).filter(Boolean);
    if (ids.length !== definitions.length) throw new Error('Merchant identity definitions require non-empty merchantId values.');
    if (new Set(ids).size !== ids.length) throw new Error('Merchant identity definitions require unique merchantId values.');

    this.registryVersion = options.registryVersion?.trim() || 'merchant-identity-registry-v2';
    this.definitions = definitions.map((definition, definitionIndex) => {
      assertWindow(`merchant[${definitionIndex}]`, definition.validFrom, definition.validTo);
      for (const [signalIndex, signal] of (definition.identitySignals ?? []).entries()) {
        if (!signal.value.trim()) throw new Error(`merchant[${definitionIndex}].identitySignals[${signalIndex}] requires a non-empty value.`);
        assertWindow(
          `merchant[${definitionIndex}].identitySignals[${signalIndex}]`,
          signal.validFrom,
          signal.validTo,
        );
      }

      return {
        ...definition,
        merchantId: definition.merchantId.trim(),
        canonicalName: definition.canonicalName.trim(),
        domains: [...definition.domains],
        senderDomains: [...definition.senderDomains],
        storefrontAliases: [...definition.storefrontAliases],
        invoiceIssuers: [...definition.invoiceIssuers],
        paymentDescriptors: [...definition.paymentDescriptors],
        status: recordStatus(definition.status),
        validFrom: definition.validFrom ?? null,
        validTo: definition.validTo ?? null,
        evidenceSource: definition.evidenceSource ?? null,
        identitySignals: (definition.identitySignals ?? []).map((signal) => ({
          ...signal,
          value: signal.value.trim(),
          status: recordStatus(signal.status ?? definition.status),
          validFrom: signal.validFrom ?? null,
          validTo: signal.validTo ?? null,
          evidenceSource: signal.evidenceSource ?? definition.evidenceSource ?? null,
        })),
      };
    });
  }

  resolve(input: {
    merchantRaw: string;
    senderDomain: string | null;
    provenance: EvidenceProvenance[];
    observedAt?: string | null;
  }): string | null {
    return this.resolveDetailed(input).merchantId;
  }

  resolveDetailed(input: {
    merchantRaw: string;
    senderDomain: string | null;
    provenance: EvidenceProvenance[];
    observedAt?: string | null;
  }): MerchantIdentityResolution {
    const merchantName = normalizeName(input.merchantRaw);
    const senderDomain = normalizeDomain(input.senderDomain);
    const merchantProvenance = relevantMerchantProvenance(input.provenance);
    const observedAt = input.observedAt ? timestampOrNull(input.observedAt) : null;

    if (input.observedAt && observedAt === null) {
      return {
        status: 'unresolved',
        merchantId: null,
        aliasCandidateIds: [],
        domainCandidateIds: [],
        matchedSignals: [],
        registryVersion: this.registryVersion,
        reasons: ['merchant_identity_observed_at_invalid'],
      };
    }

    if (!merchantName) {
      return {
        status: 'unresolved',
        merchantId: null,
        aliasCandidateIds: [],
        domainCandidateIds: [],
        matchedSignals: [],
        registryVersion: this.registryVersion,
        reasons: ['merchant_name_missing_after_normalization'],
      };
    }

    const allSignals = this.definitions.flatMap(normalizedSignals);
    const usableSignals = allSignals.filter((signal) => signalUsable(signal, observedAt));
    const aliasSignals = usableSignals.filter((signal) =>
      (signal.kind === 'canonical_name' || signal.kind === 'storefront_alias')
      && signal.normalizedValue === merchantName,
    );
    const domainSignals = usableSignals.filter((signal) =>
      (signal.kind === 'domain' || signal.kind === 'sender_domain')
      && domainMatches(senderDomain, signal.normalizedValue),
    );

    const aliasCandidateIds = unique(aliasSignals.map((signal) => signal.merchantId));
    const domainCandidateIds = unique(domainSignals.map((signal) => signal.merchantId));
    const matchedSignals = uniqueMatchedSignals([...aliasSignals, ...domainSignals]);

    if (aliasCandidateIds.length > 1 || domainCandidateIds.length > 1) {
      return {
        status: 'ambiguous',
        merchantId: null,
        aliasCandidateIds,
        domainCandidateIds,
        matchedSignals,
        registryVersion: this.registryVersion,
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
        matchedSignals,
        registryVersion: this.registryVersion,
        reasons: ['merchant_alias_and_sender_domain_disagree'],
      };
    }

    if (aliasId && domainId && aliasId === domainId) {
      const resolvedSignals = matchedSignals.filter((signal) => signal.merchantId === aliasId);
      return {
        status: 'resolved',
        merchantId: aliasId,
        aliasCandidateIds,
        domainCandidateIds,
        matchedSignals: resolvedSignals,
        registryVersion: this.registryVersion,
        reasons: [
          'exact_merchant_alias_match',
          'matching_sender_domain_namespace',
          ...(input.observedAt ? ['merchant_identity_evaluated_at_email_time'] : []),
          ...(resolvedSignals.some((signal) => signal.status === 'historical') ? ['historical_merchant_identity_signal_used'] : []),
          ...(merchantProvenance.length > 0 ? ['merchant_field_provenance_present'] : []),
        ],
      };
    }

    return {
      status: 'unresolved',
      merchantId: null,
      aliasCandidateIds,
      domainCandidateIds,
      matchedSignals,
      registryVersion: this.registryVersion,
      reasons: [
        ...(aliasId ? ['alias_match_without_sender_domain_corroboration'] : []),
        ...(domainId ? ['sender_domain_match_without_exact_merchant_alias'] : []),
        ...(!aliasId && !domainId ? ['no_registry_identity_match'] : []),
      ],
    };
  }
}
