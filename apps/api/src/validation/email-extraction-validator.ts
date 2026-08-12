import type {
  BuyFlowEmailEventType,
  EmailExtraction,
} from '../ai/openai-email-extractor.js';

export type EmailValidationStatus = 'validated' | 'guardrailed' | 'review';

export interface ValidatedEmailExtraction extends EmailExtraction {
  original_event_type: BuyFlowEmailEventType;
  validation_status: EmailValidationStatus;
  reasons: string[];
  blocked_fields: string[];
  eligible_for_purchase_creation: boolean;
}

export interface ValidateEmailExtractionInput {
  extraction: EmailExtraction;
  senderDomains: string[];
  subject?: string | null;
  bodyText?: string | null;
}

const CARRIER_DOMAIN_TOKENS = [
  'expressone',
  'gls',
  'dpd',
  'foxpost',
  'packeta',
] as const;

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

function currencyEvidence(text: string, currency: string): boolean {
  const normalized = text.toLowerCase();
  const code = currency.trim().toLowerCase();

  const aliases: Record<string, string[]> = {
    huf: ['huf', ' ft', 'forint'],
    eur: ['eur', '€', 'euro'],
    usd: ['usd', '$', 'dollar'],
    gbp: ['gbp', '£', 'pound'],
  };

  const candidates = aliases[code] ?? [code];
  return candidates.some((candidate) => normalized.includes(candidate));
}

function hasMonetaryContext(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    'total',
    'amount',
    'paid',
    'payment',
    'price',
    'összesen',
    'fizetendő',
    'fizetendo',
    'összeg',
    'osszeg',
    'ár',
    'ar:',
    'végösszeg',
    'vegosszeg',
  ].some((token) => normalized.includes(token));
}

function clearField(
  extraction: EmailExtraction,
  field: keyof EmailExtraction,
  blockedFields: string[],
) {
  if (extraction[field] !== null) {
    (extraction as unknown as Record<string, unknown>)[field] = null;
    blockedFields.push(field);
  }
}

export function validateEmailExtraction(
  input: ValidateEmailExtractionInput,
): ValidatedEmailExtraction {
  const raw = input.extraction;
  const validated: EmailExtraction = { ...raw };
  const reasons: string[] = [];
  const blockedFields: string[] = [];
  const senderIsCarrier = input.senderDomains.some(isCarrierSenderDomain);
  const contextText = `${input.subject ?? ''}\n${input.bodyText ?? ''}`;

  if (senderIsCarrier) {
    reasons.push('carrier_sender_blocks_purchase_creation');

    if (validated.event_type === 'order_created' || validated.event_type === 'order_updated') {
      validated.event_type = 'shipment';
      validated.confidence = Math.min(validated.confidence, 0.85);
      reasons.push('carrier_sender_event_downgraded_to_shipment');
    }

    if (validated.merchant !== null) {
      clearField(validated, 'merchant', blockedFields);
      reasons.push('carrier_sender_cleared_merchant');
    }

    if (validated.order_number !== null) {
      clearField(validated, 'order_number', blockedFields);
      reasons.push('carrier_sender_cleared_order_number');
    }

    if (validated.total !== null || validated.currency !== null) {
      clearField(validated, 'total', blockedFields);
      clearField(validated, 'currency', blockedFields);
      reasons.push('carrier_sender_cleared_purchase_amount');
    }
  } else if (validated.total !== null) {
    if (!validated.currency) {
      clearField(validated, 'total', blockedFields);
      reasons.push('amount_missing_currency');
    } else if (
      !currencyEvidence(contextText, validated.currency) ||
      !hasMonetaryContext(contextText)
    ) {
      clearField(validated, 'total', blockedFields);
      clearField(validated, 'currency', blockedFields);
      reasons.push('amount_lacks_monetary_context');
    }
  }

  const eligibleForPurchaseCreation = Boolean(
    !senderIsCarrier &&
      validated.event_type === 'order_created' &&
      validated.confidence >= 0.9 &&
      validated.merchant &&
      validated.order_number,
  );

  let validationStatus: EmailValidationStatus;
  if (reasons.length > 0 || blockedFields.length > 0 || validated.event_type !== raw.event_type) {
    validationStatus = 'guardrailed';
  } else if (validated.event_type === 'order_created' && !eligibleForPurchaseCreation) {
    validationStatus = 'review';
    reasons.push('order_created_not_auto_eligible');
  } else {
    validationStatus = 'validated';
  }

  return {
    ...validated,
    original_event_type: raw.event_type,
    validation_status: validationStatus,
    reasons,
    blocked_fields: [...new Set(blockedFields)],
    eligible_for_purchase_creation: eligibleForPurchaseCreation,
  };
}
