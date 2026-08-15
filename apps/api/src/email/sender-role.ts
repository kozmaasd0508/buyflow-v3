const CARRIER_DOMAIN_TOKENS = [
  'expressone',
  'gls',
  'dpd',
  'foxpost',
  'packeta',
  'dhl',
  'ups',
] as const;

const EXACT_CARRIER_DOMAINS = new Set([
  'posta.hu',
]);

const PUBLIC_MAILBOX_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.de',
  'yahoo.fr',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'aol.com',
  'freemail.hu',
  'citromail.hu',
  'indamail.hu',
  'vipmail.hu',
]);

export type EmailSenderRole = 'carrier' | 'unknown';

export type MerchantKey = 'gymbeam' | 'gyerekjatekbolt' | 'alza' | 'aboutyou' | 'zalando' | 'dorko' | 'jatektenger';

export interface MerchantSenderDefinition {
  key: MerchantKey;
  displayName: string;
  exactSenderDomains: readonly string[];
}

const MERCHANT_SENDER_DEFINITIONS: readonly MerchantSenderDefinition[] = [
  {
    key: 'gymbeam',
    displayName: 'GymBeam',
    exactSenderDomains: ['service.gymbeam.hu'],
  },
  {
    key: 'gyerekjatekbolt',
    displayName: 'Gyerekjatekbolt.com',
    exactSenderDomains: ['gyerekjatekbolt.com'],
  },
  {
    key: 'alza',
    displayName: 'Alza.hu',
    exactSenderDomains: ['alza.hu'],
  },
  {
    key: 'aboutyou',
    displayName: 'ABOUT YOU',
    exactSenderDomains: ['aboutyou.hu'],
  },
  {
    key: 'zalando',
    displayName: 'Zalando',
    exactSenderDomains: ['service-mail.zalando.hu'],
  },
  {
    key: 'dorko',
    displayName: 'Dorko',
    exactSenderDomains: ['dorko.hu'],
  },
  {
    key: 'jatektenger',
    displayName: 'Játéktenger',
    exactSenderDomains: ['jatektenger.hu'],
  },
] as const;

export function normalizeSenderDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

export function isCarrierSenderDomain(domain: string): boolean {
  const normalized = normalizeSenderDomain(domain);
  if (EXACT_CARRIER_DOMAINS.has(normalized)) return true;
  return CARRIER_DOMAIN_TOKENS.some((token) => {
    const pattern = new RegExp(`(^|[.-])${token}([.-]|$)`, 'i');
    return pattern.test(normalized);
  });
}

export function isPublicMailboxSenderDomain(domain: string): boolean {
  return PUBLIC_MAILBOX_DOMAINS.has(normalizeSenderDomain(domain));
}

export function classifyEmailSenderRole(domains: string[]): EmailSenderRole {
  return domains.some(isCarrierSenderDomain) ? 'carrier' : 'unknown';
}

export function getMerchantSenderDefinition(key: MerchantKey): MerchantSenderDefinition {
  const merchant = MERCHANT_SENDER_DEFINITIONS.find((entry) => entry.key === key);
  if (!merchant) throw new Error(`Unknown merchant registry key: ${key}`);
  return merchant;
}

export function isMerchantSender(domains: string[], key: MerchantKey): boolean {
  const merchant = getMerchantSenderDefinition(key);
  const allowed = new Set(merchant.exactSenderDomains.map(normalizeSenderDomain));
  return domains
    .map(normalizeSenderDomain)
    .some((domain) => allowed.has(domain));
}

export function identifyMerchantSender(domains: string[]): MerchantSenderDefinition | null {
  const matches = MERCHANT_SENDER_DEFINITIONS.filter((merchant) =>
    isMerchantSender(domains, merchant.key));
  return matches.length === 1 ? matches[0]! : null;
}

export function merchantDisplayName(key: MerchantKey): string {
  return getMerchantSenderDefinition(key).displayName;
}

export function registeredMerchantSenders(): readonly MerchantSenderDefinition[] {
  return MERCHANT_SENDER_DEFINITIONS;
}
