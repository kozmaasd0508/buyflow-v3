export function normalizeStableIdentifier(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return normalized || null;
}

export function normalizeMerchantToken(value: string | null | undefined): string | null {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^www\./, '')
    .replace(/\.(hu|com|eu|shop|store)$/i, '')
    .replace(/[^a-z0-9]+/g, '');
  return normalized || null;
}

export function normalizeCurrency(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}
