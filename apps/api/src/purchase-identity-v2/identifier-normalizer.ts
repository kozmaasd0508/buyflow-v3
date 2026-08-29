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

/**
 * Canonicalizes an already-resolved carrier label without guessing a carrier
 * from arbitrary message text. Generic locality/service suffixes are removed so
 * equivalent labels such as "Express One", "Express One futár" and
 * "Express One Hungary" share one deterministic namespace.
 */
export function normalizeCarrierToken(value: string | null | undefined): string | null {
  let normalized = normalizeMerchantToken(value);
  if (!normalized) return null;

  const suffixes = [
    'magyarorszagi',
    'magyarorszag',
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
      if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
        normalized = normalized.slice(0, -suffix.length);
        changed = true;
      }
    }
  }

  return normalized || null;
}

export function normalizeCurrency(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}
