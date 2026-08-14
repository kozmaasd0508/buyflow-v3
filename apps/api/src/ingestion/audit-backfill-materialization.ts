export type AuditBackfillEventType =
  | 'order_created'
  | 'order_updated'
  | 'payment_completed'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'subscription'
  | 'refund'
  | 'return'
  | 'other';

export type AuditBackfillValidationStatus = 'validated' | 'guardrailed' | 'review';

export interface AuditBackfillInput {
  aiEventType: string | null;
  aiValidationStatus: string | null;
  aiErrorCode: string | null;
  aiResult: unknown;
}

export interface AuditBackfillMaterialization {
  classification: AuditBackfillEventType;
  validationStatus: AuditBackfillValidationStatus;
  structuredResult: Record<string, unknown>;
  validatedResult: Record<string, unknown>;
  initialStatus: 'pending' | 'review' | 'ignored';
}

const EVENT_TYPES = new Set<AuditBackfillEventType>([
  'order_created',
  'order_updated',
  'payment_completed',
  'shipment',
  'delivery',
  'invoice_or_receipt',
  'subscription',
  'refund',
  'return',
  'other',
]);

const VALIDATION_STATUSES = new Set<AuditBackfillValidationStatus>([
  'validated',
  'guardrailed',
  'review',
]);

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function materializeAuditBackfill(
  input: AuditBackfillInput,
): AuditBackfillMaterialization | null {
  if (input.aiErrorCode) return null;
  if (!input.aiEventType || !EVENT_TYPES.has(input.aiEventType as AuditBackfillEventType)) return null;
  if (
    !input.aiValidationStatus ||
    !VALIDATION_STATUSES.has(input.aiValidationStatus as AuditBackfillValidationStatus)
  ) return null;

  const audit = objectOrNull(input.aiResult);
  const extraction = objectOrNull(audit?.extraction);
  const validated = objectOrNull(audit?.validated);
  if (!audit || !extraction || !validated) return null;

  if (audit.schema_version !== 2) return null;
  if (validated.schema_version !== 2) return null;
  if (validated.event_type !== input.aiEventType) return null;
  if (validated.validation_status !== input.aiValidationStatus) return null;

  const confidence = validated.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }

  const classification = input.aiEventType as AuditBackfillEventType;
  const validationStatus = input.aiValidationStatus as AuditBackfillValidationStatus;
  const initialStatus = classification === 'other'
    ? 'ignored'
    : validationStatus === 'review'
      ? 'review'
      : 'pending';

  return {
    classification,
    validationStatus,
    structuredResult: {
      ...extraction,
      schema_version: 2,
    },
    validatedResult: {
      ...validated,
      schema_version: 2,
    },
    initialStatus,
  };
}
