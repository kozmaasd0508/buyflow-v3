import { registeredTestProtocolProfiles } from '../protocols/test-registry.js';
import type { ProtocolProfile } from '../protocols/types.js';
import { MerchantIdentityRegistry } from './merchant-identity-registry.js';
import type { MerchantIdentityDefinition } from './types.js';

export function merchantIdentityDefinitionsFromTestProtocols(
  profiles: readonly ProtocolProfile[] = registeredTestProtocolProfiles(),
): MerchantIdentityDefinition[] {
  return profiles
    .filter((profile) => profile.kind === 'merchant' && profile.status === 'test')
    .map((profile) => ({
      merchantId: `protocol:${profile.protocol_id}`,
      canonicalName: profile.display_name,
      domains: [],
      senderDomains: [...profile.sender_domains],
      storefrontAliases: [profile.display_name],
      invoiceIssuers: [],
      paymentDescriptors: [],
      evidenceSource: `test-protocol:${profile.protocol_id}@${profile.protocol_version}`,
    }));
}

/**
 * Shadow-only bridge from already researched/tested protocol profiles into the
 * new merchant identity registry. Production registry.ts remains untouched.
 */
export function buildTestProtocolMerchantIdentityRegistry(): MerchantIdentityRegistry {
  return new MerchantIdentityRegistry(
    merchantIdentityDefinitionsFromTestProtocols(),
    { registryVersion: 'merchant-identity:test-protocols-v1' },
  );
}
