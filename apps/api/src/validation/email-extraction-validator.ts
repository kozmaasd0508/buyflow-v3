import type {
  BuyFlowEmailEventType,
  EmailExtraction,
} from '../ai/openai-email-extractor.js';
import { isCarrierSenderDomain } from '../email/sender-role.js';

export { isCarrierSenderDomain } from '../email/sender-role.js';

export type EmailValidationStatus = 'validated' | 'guardrailed' | 'review';

export interface ValidatedEmailExtraction extends EmailExtraction {
  schema_version: 2;
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
    'utánvét',
    'utanvet',
    'cash on delivery',
  ].some((token) => normalized.includes(token));
}

function clearField(
  extraction: EmailExtraction,
  field: keyof EmailExtraction,
  blockedFields: string[],
) {
  const value = extraction[field];
  if (value !== null && !(Array.isArray(value) && value.length === 0)) {
    (extraction as unknown as Record<string, unknown>)[field] = null;
    blockedFields.push(field);
  }
}

function clearProducts(extraction: EmailExtraction, blockedFields: string[]) {
  if (extraction.products.length > 0) {
    extraction.products = [];
    blockedFields.push('products');
  }
}

function validateMoneyPair(input: {
  extraction: EmailExtraction;
  amountField: 'total' | 'paid_amount';
  currencyField: 'currency' | 'paid_currency';
  contextText: string;
  reasons: string[];
  blockedFields: string[];
}) {
  const amount = input.extraction[input.amountField];
  const currency = input.extraction[input.currencyField];
  if (amount === null) return;

  if (
    amount < 0 ||
    !currency ||
    !currencyEvidence(input.contextText, currency) ||
    !hasMonetaryContext(input.contextText)
  ) {
    clearField(input.extraction, input.amountField, input.blockedFields);
    clearField(input.extraction, input.currencyField, input.blockedFields);
    input.reasons.push(`${input.amountField}_lacks_monetary_evidence`);
  }
}

export function validateEmailExtraction(
  input: ValidateEmailExtractionInput,
): ValidatedEmailExtraction {
  const raw = input.extraction;
  const validated: EmailExtraction = {
    ...raw,
    products: raw.products.map((product) => ({ ...product })),
  };
  const reasons: string[] = [];
  const blockedFields: string[] = [];
  let requiresReview = false;
  const senderIsCarrier = input.senderDomains.some(isCarrierSenderDomain);
  const contextText = `${input.subject ?? ''}\n${input.bodyText ?? ''}`;

  if (senderIsCarrier) {
    reasons.push('carrier_sender_blocks_purchase_creation');

    if (
      validated.event_type === 'order_created' ||
      validated.event_type === 'order_updated' ||
      validated.event_type === 'payment_completed'
    ) {
      validated.event_type = 'shipment';
      validated.confidence = Math.min(validated.confidence, 0.85);
      reasons.push('carrier_sender_event_downgraded_to_shipment');
    }

    const purchaseFields: Array<keyof EmailExtraction> = [
      'merchant',
      'merchant_legal_name',
      'order_number',
      'subtotal',
      'shipping_amount',
      'discount_amount',
      'total',
      'currency',
      'payment_status',
      'payment_method',
      'paid_amount',
      'paid_currency',
      'shipping_method',
    ];
    for (const field of purchaseFields) {
      clearField(validated, field, blockedFields);
    }
    clearProducts(validated, blockedFields);

    if (blockedFields.length > 0) {
      reasons.push('carrier_sender_cleared_purchase_fields');
    }

    if (validated.cod_amount !== null && validated.cod_amount < 0) {
      clearField(validated, 'cod_amount', blockedFields);
      clearField(validated, 'cod_currency', blockedFields);
      reasons.push('negative_cod_amount_blocked');
    }
  } else {
    validateMoneyPair({
      extraction: validated,
      amountField: 'total',
      currencyField: 'currency',
      contextText,
      reasons,
      blockedFields,
    });
    validateMoneyPair({
      extraction: validated,
      amountField: 'paid_amount',
      currencyField: 'paid_currency',
      contextText,
      reasons,
      blockedFields,
    });

    if (validated.cod_amount !== null && validated.cod_amount < 0) {
      clearField(validated, 'cod_amount', blockedFields);
      clearField(validated, 'cod_currency', blockedFields);
      reasons.push('negative_cod_amount_blocked');
    }
  }

  if (validated.event_type === 'payment_completed' && validated.payment_status !== 'paid') {
    requiresReview = true;
    reasons.push('payment_completed_without_explicit_paid_status');
  }

  const eligibleForPurchaseCreation = Boolean(
    !senderIsCarrier &&
      validated.event_type === 'order_created' &&
      validated.confidence >= 0.9 &&
      validated.merchant &&
      validated.order_number,
  );

  let validationStatus: EmailValidationStatus;
  if (requiresReview) {
    validationStatus = 'review';
  } else if (reasons.length > 0 || blockedFields.length > 0 || validated.event_type !== raw.event_type) {
    validationStatus = 'guardrailed';
  } else if (validated.event_type === 'order_created' && !eligibleForPurchaseCreation) {
    validationStatus = 'review';
    reasons.push('order_created_not_auto_eligible');
  } else {
    validationStatus = 'validated';
  }

  return {
    ...validated,
    schema_version: 2,
    original_event_type: raw.event_type,
    validation_status: validationStatus,
    reasons,
    blocked_fields: [...new Set(blockedFields)],
    eligible_for_purchase_creation: eligibleForPurchaseCreation,
  };
}
