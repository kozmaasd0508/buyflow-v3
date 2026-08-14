import assert from 'node:assert/strict';
import test from 'node:test';
import { materializeAuditBackfill } from './audit-backfill-materialization.js';

function auditResult(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    model: 'gpt-test',
    extraction: {
      event_type: 'shipment',
      confidence: 0.9,
      merchant: 'Example Shop',
      order_number: 'A12345',
    },
    validated: {
      schema_version: 2,
      event_type: 'shipment',
      original_event_type: 'shipment',
      validation_status: 'validated',
      confidence: 0.9,
      merchant: 'Example Shop',
      order_number: 'A12345',
      reasons: [],
      blocked_fields: [],
      eligible_for_purchase_creation: false,
    },
    ...overrides,
  };
}

test('materializes trusted audit evidence without requesting new AI work', () => {
  const materialized = materializeAuditBackfill({
    aiEventType: 'shipment',
    aiValidationStatus: 'validated',
    aiErrorCode: null,
    aiResult: auditResult(),
  });

  assert.ok(materialized);
  assert.equal(materialized.classification, 'shipment');
  assert.equal(materialized.initialStatus, 'pending');
  assert.equal(materialized.structuredResult.schema_version, 2);
  assert.equal(materialized.validatedResult.schema_version, 2);
});

test('keeps review evidence in review and does not auto-route it', () => {
  const result = auditResult({
    validated: {
      schema_version: 2,
      event_type: 'order_created',
      original_event_type: 'order_created',
      validation_status: 'review',
      confidence: 0.65,
      merchant: 'Example Shop',
      order_number: 'A12345',
      reasons: ['order_created_not_auto_eligible'],
      blocked_fields: [],
      eligible_for_purchase_creation: false,
    },
  });

  const materialized = materializeAuditBackfill({
    aiEventType: 'order_created',
    aiValidationStatus: 'review',
    aiErrorCode: null,
    aiResult: result,
  });

  assert.ok(materialized);
  assert.equal(materialized.initialStatus, 'review');
});

test('closes audited other messages as ignored', () => {
  const result = auditResult({
    extraction: { event_type: 'other', confidence: 0.6 },
    validated: {
      schema_version: 2,
      event_type: 'other',
      original_event_type: 'other',
      validation_status: 'validated',
      confidence: 0.6,
      reasons: [],
      blocked_fields: [],
      eligible_for_purchase_creation: false,
    },
  });

  const materialized = materializeAuditBackfill({
    aiEventType: 'other',
    aiValidationStatus: 'validated',
    aiErrorCode: null,
    aiResult: result,
  });

  assert.ok(materialized);
  assert.equal(materialized.initialStatus, 'ignored');
});

test('rejects inconsistent or failed audit payloads', () => {
  assert.equal(materializeAuditBackfill({
    aiEventType: 'shipment',
    aiValidationStatus: 'validated',
    aiErrorCode: 'SomeError',
    aiResult: auditResult(),
  }), null);

  assert.equal(materializeAuditBackfill({
    aiEventType: 'delivery',
    aiValidationStatus: 'validated',
    aiErrorCode: null,
    aiResult: auditResult(),
  }), null);

  assert.equal(materializeAuditBackfill({
    aiEventType: 'shipment',
    aiValidationStatus: 'guardrailed',
    aiErrorCode: null,
    aiResult: auditResult(),
  }), null);
});
