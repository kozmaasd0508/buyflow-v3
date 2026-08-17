import type {
  PaymentShadowContext,
  PaymentShadowEvidence,
} from '../resolution/payment-shadow-resolution.js';

export type SupportedPaymentShadowProvider = 'simplepay' | 'barion';

export interface AuthenticatedPaymentProviderEmail {
  sourceEmailId: string;
  userId: string;
  provider: SupportedPaymentShadowProvider;
  providerAuthenticated: boolean;
  subject: string;
  body: string;
  receivedAt: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ').trim();
}

function normalizeCurrency(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'FT' || normalized === 'HUF') return 'HUF';
  if (normalized === 'EUR' || normalized === 'USD') return normalized;
  return null;
}

function parseConservativeAmount(raw: string, currency: string): number | null {
  const compact = raw.replace(/[\s\u00a0]/g, '');
  if (/^\d+$/.test(compact)) return Number(compact);

  // Only accept a single 1-2 digit decimal separator outside HUF. Dotted or
  // comma-separated thousands are deliberately rejected as ambiguous.
  if (currency !== 'HUF' && /^\d+[.,]\d{1,2}$/.test(compact)) {
    return Number(compact.replace(',', '.'));
  }

  return null;
}

function extractAmountCurrency(text: string): { amount: number; currency: string } | null {
  const labelled = text.match(
    /(?:Fizetett összeg\s*:\s*|Sikeresen fizettél\s+)([0-9][0-9\s\u00a0.,]*?)\s*(HUF|Ft|EUR|USD)(?:-ot|-et)?\b/i,
  );
  if (!labelled) return null;

  const currency = normalizeCurrency(labelled[2] ?? '');
  if (!currency) return null;
  const amount = parseConservativeAmount(labelled[1] ?? '', currency);
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  return { amount, currency };
}

function normalizeDomainCandidate(value: string): string | null {
  const candidate = value.trim().replace(/[)>.,;]+$/g, '');
  let host = candidate;

  try {
    if (/^https?:\/\//i.test(candidate)) {
      host = new URL(candidate).hostname;
    } else if (candidate.includes('@')) {
      host = candidate.split('@').pop() ?? '';
    }
  } catch {
    return null;
  }

  const normalized = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(normalized)) return null;
  return normalized;
}

function cleanOptionalReference(value: string | undefined): string | null {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) return null;
  if (/^(?:nincs megadva|not provided|n\/a|none|-)+$/i.test(normalized)) return null;
  if (normalized.length > 128) return null;
  return normalized;
}

function simplePayContext(text: string): PaymentShadowContext {
  if (
    /korábban eltárolásra került bankkártyája sikeresen terhelésre került/i.test(text) ||
    /ismétlődő fizetés|recurring payment/i.test(text)
  ) {
    return 'recurring_or_subscription';
  }

  if (
    /Fizetés típusa\s*:\s*(?:Érintéses fizetés\s*)?SoftPos/i.test(text) ||
    /Telefonos\s+POS/i.test(text) ||
    /\bPOS\s+(?:fizetés|payment)\b/i.test(text)
  ) {
    return 'service_or_billing';
  }

  if (/Online rendelés adatai\s*:/i.test(text)) return 'purchase';
  return 'unknown';
}

function normalizeSimplePay(
  input: AuthenticatedPaymentProviderEmail,
): PaymentShadowEvidence | null {
  const subject = normalizeWhitespace(input.subject);
  const body = input.body.replace(/\r/g, '');

  if (!/SimplePay\s*-?\s*Sikeres fizetés|^Sikeres fizetés$/i.test(subject)) return null;
  if (!/SimplePay tranzakció azonosító\s*:/i.test(body)) return null;
  if (!/sikeres fizetés megtörténését igazolja|sikeresen kifizette|sikeresen rendezte|sikeresen terhelésre került/i.test(body)) return null;

  const money = extractAmountCurrency(body);
  if (!money) return null;

  const providerReference = cleanOptionalReference(
    body.match(/SimplePay tranzakció azonosító\s*:\s*([^\n\r]+)/i)?.[1],
  );
  if (!providerReference) return null;

  const merchantRaw = cleanOptionalReference(
    body.match(/^Kereskedő\s*:\s*([^\n\r]+)/im)?.[1],
  );
  const merchantDomainHint = merchantRaw ? normalizeDomainCandidate(merchantRaw) : null;
  const merchantNameHint = merchantRaw && !merchantDomainHint ? merchantRaw : null;
  const merchantReference = cleanOptionalReference(
    body.match(/Külső hivatkozási szám\s*:\s*([^\n\r]+)/i)?.[1],
  );

  return {
    sourceEmailId: input.sourceEmailId,
    userId: input.userId,
    provider: 'simplepay',
    paymentReference: providerReference,
    merchantDomainHint,
    merchantNameHint,
    merchantReference,
    amount: money.amount,
    currency: money.currency,
    receivedAt: input.receivedAt,
    confidence: 1,
    context: simplePayContext(body),
  };
}

function normalizeBarion(
  input: AuthenticatedPaymentProviderEmail,
): PaymentShadowEvidence | null {
  const subject = normalizeWhitespace(input.subject);
  const body = input.body.replace(/\r/g, '');

  if (!/^Sikeres fizetés$/i.test(subject)) return null;
  if (!/Fizetés Barion azonosítója\s*:/i.test(body)) return null;
  if (!/Sikeresen fizettél\s+[0-9]/i.test(body)) return null;

  const money = extractAmountCurrency(body);
  if (!money) return null;

  const providerReference = cleanOptionalReference(
    body.match(/Fizetés Barion azonosítója\s*:\s*\n?\s*([^\n\r]+)/i)?.[1],
  );
  if (!providerReference) return null;

  const merchantNameHint = cleanOptionalReference(
    body.match(/Elfogadóhely neve\s*:\s*\n?\s*([^\n\r]+)/i)?.[1],
  );
  const merchantReference = cleanOptionalReference(
    body.match(/Rendelés elfogadóhelyen nyilvántartott azonosítója\s*:\s*\n?\s*([^\n\r]+)/i)?.[1],
  );

  // Only the merchant-attributed contact line may provide a merchant domain.
  // Provider/footer links and arbitrary body URLs are never considered.
  const merchantContact = body.match(/(?:📧\s*)?Email\s*:\s*([^\s<>]+@[^\s<>]+)/i)?.[1] ?? '';
  const merchantContactDomain = normalizeDomainCandidate(merchantContact);
  const merchantDomainHint = merchantContactDomain === 'barion.com' ? null : merchantContactDomain;

  return {
    sourceEmailId: input.sourceEmailId,
    userId: input.userId,
    provider: 'barion',
    paymentReference: providerReference,
    merchantDomainHint,
    merchantNameHint,
    merchantReference,
    amount: money.amount,
    currency: money.currency,
    receivedAt: input.receivedAt,
    confidence: 1,
    context: 'unknown',
  };
}

export function normalizeAuthenticatedPaymentProviderEmail(
  input: AuthenticatedPaymentProviderEmail,
): PaymentShadowEvidence | null {
  if (!input.providerAuthenticated) return null;
  if (!input.sourceEmailId || !input.userId || !input.receivedAt) return null;

  if (input.provider === 'simplepay') return normalizeSimplePay(input);
  if (input.provider === 'barion') return normalizeBarion(input);
  return null;
}
