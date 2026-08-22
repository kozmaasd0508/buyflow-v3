import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { collectEvidence, type EvidenceExtractor } from './collector.js';

function message(): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'collector-test',
    subject: 'Rendelésed úton van',
    from: [{ email: 'noreply@carrier.example', name: 'Carrier' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-22T00:00:00.000Z',
    snippet: 'Feladó: Example Shop Kft.\nFizetendő összeg: 14 960 Ft',
    folders: [],
    attachments: [],
  };
}

test('all evidence extractors run even when an earlier extractor emits a strong claim', () => {
  const ran: string[] = [];
  const extractors: EvidenceExtractor[] = [
    {
      id: 'provider-adapter',
      version: 'v1',
      extract: () => {
        ran.push('provider-adapter');
        return [{
          field: 'event_type',
          value: 'shipment',
          confidence: 0.99,
          source: 'provider_adapter',
          extractorId: 'provider-adapter',
          extractorVersion: 'v1',
          qualifiers: ['trusted_sender'],
        }];
      },
    },
    {
      id: 'generic-money',
      version: 'v1',
      extract: () => {
        ran.push('generic-money');
        return [{
          field: 'total',
          value: 14960,
          confidence: 0.95,
          source: 'body',
          extractorId: 'generic-money',
          extractorVersion: 'v1',
          qualifiers: ['explicit_label'],
        }];
      },
    },
  ];

  const result = collectEvidence(buildEmailDocumentV1(message()), extractors);
  assert.deepEqual(ran, ['provider-adapter', 'generic-money']);
  assert.equal(result.bundle.claims.length, 2);
  assert.equal(result.ranExtractors[0]?.claimCount, 1);
  assert.equal(result.ranExtractors[1]?.claimCount, 1);
});
