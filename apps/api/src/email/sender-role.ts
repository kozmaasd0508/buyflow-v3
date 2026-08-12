const CARRIER_DOMAIN_TOKENS = [
  'expressone',
  'gls',
  'dpd',
  'foxpost',
  'packeta',
] as const;

export type EmailSenderRole = 'carrier' | 'unknown';

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, '');
}

export function isCarrierSenderDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return CARRIER_DOMAIN_TOKENS.some((token) => {
    const pattern = new RegExp(`(^|[.-])${token}([.-]|$)`, 'i');
    return pattern.test(normalized);
  });
}

export function classifyEmailSenderRole(domains: string[]): EmailSenderRole {
  return domains.some(isCarrierSenderDomain) ? 'carrier' : 'unknown';
}
