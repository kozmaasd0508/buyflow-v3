import { registeredTestProtocolProfiles } from '../protocols/test-registry.js';
import type { ProtocolProfile } from '../protocols/types.js';
import type { ExtractionV2CarrierIdentityResolver } from './extraction-v2-adapter.js';
import { normalizeMerchantToken } from './identifier-normalizer.js';

function normalizeDomain(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase().replace(/^www\./u, '');
  return normalized || null;
}

function domainMatches(senderDomain: string | null, configuredDomain: string): boolean {
  if (!senderDomain) return false;
  const configured = normalizeDomain(configuredDomain);
  return Boolean(configured && (senderDomain === configured || senderDomain.endsWith(`.${configured}`)));
}

function stripGenericCarrierSuffixes(value: string | null): string | null {
  if (!value) return null;
  let current = value;
  const suffixes = [
    'magyarorszag',
    'magyarorszagi',
    'hungary',
    'futarszolgalat',
    'futar',
    'courier',
    'carrier',
    'parcelservice',
    'logistics',
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (current.endsWith(suffix) && current.length > suffix.length) {
        current = current.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return current || null;
}

function profileAliases(profile: ProtocolProfile): Set<string> {
  const aliases = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = stripGenericCarrierSuffixes(normalizeMerchantToken(value));
    if (normalized) aliases.add(normalized);
  };

  add(profile.display_name);
  add(profile.protocol_id.split('.').at(-1));
  for (const domain of profile.sender_domains) add(domain.split('.')[0]);
  return aliases;
}

function canonicalCarrierId(profile: ProtocolProfile): string {
  return `protocol:${profile.protocol_id}`;
}

export class TestProtocolCarrierIdentityRegistry implements ExtractionV2CarrierIdentityResolver {
  readonly profiles: readonly ProtocolProfile[];

  constructor(profiles: readonly ProtocolProfile[] = registeredTestProtocolProfiles()) {
    this.profiles = profiles.filter((profile) => profile.kind === 'carrier' && profile.status === 'test');
  }

  resolve(input: Parameters<ExtractionV2CarrierIdentityResolver['resolve']>[0]): string | null {
    const senderDomain = normalizeDomain(input.senderDomain);
    const raw = stripGenericCarrierSuffixes(normalizeMerchantToken(input.carrierRaw));
    if (!raw) return null;

    const rawMatches = this.profiles.filter((profile) => profileAliases(profile).has(raw));
    const senderMatches = this.profiles.filter((profile) =>
      profile.sender_domains.some((domain) => domainMatches(senderDomain, domain))
    );
    const directCarrierProvenance = input.provenance.some((item) =>
      item.qualifiers.includes('authenticated_direct_carrier_sender')
      || item.qualifiers.includes('direct_carrier_sender')
    );

    if (directCarrierProvenance && senderMatches.length === 1) {
      const senderProfile = senderMatches[0]!;
      if (rawMatches.length > 0 && !rawMatches.includes(senderProfile)) return null;
      return canonicalCarrierId(senderProfile);
    }

    if (rawMatches.length === 1) return canonicalCarrierId(rawMatches[0]!);
    return null;
  }
}

export function buildTestProtocolCarrierIdentityRegistry(): TestProtocolCarrierIdentityRegistry {
  return new TestProtocolCarrierIdentityRegistry();
}
