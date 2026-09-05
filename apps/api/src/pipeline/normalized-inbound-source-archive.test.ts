import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { EmailArchiveObjectStore, EmailArchivePutInput } from '../email/source-archive-v1.js';
import type { NormalizedEmail } from '../email/types.js';
import { persistNormalizedInboundEmail } from './normalized-inbound-pipeline.js';

class MemoryStore implements EmailArchiveObjectStore {
  readonly puts: EmailArchivePutInput[] = [];
  async putImmutable(input: EmailArchivePutInput): Promise<void> {
    this.puts.push({ ...input, bytes: Buffer.from(input.bytes) });
  }
}

function email(): NormalizedEmail {
  return {
    provider: 'ses',
    providerMessageId: 'ses-private-archive-1',
    subject: 'Security rejected message',
    from: [{ email: 'sender@example.com' }],
    to: [{ email: 'buyer@buyflow.hu' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-30T20:00:00.000Z',
    bodyText: 'body',
    folders: ['inbound'],
    attachments: [],
  };
}

function dbFixture(
  insertedPayloads: Record<string, unknown>[],
  options: { existingSource?: Record<string, unknown> | null } = {},
) {
  let manifest: Record<string, any> | null = null;
  return {
    getManifest: () => manifest,
    from(table: string) {
      if (table === 'email_connections') {
        const query = {
          select() { return query; },
          eq() { return query; },
          async maybeSingle() {
            return {
              data: {
                id: '22222222-2222-4222-8222-222222222222',
                user_id: '11111111-1111-4111-8111-111111111111',
                email_address: 'buyer@buyflow.hu',
              },
              error: null,
            };
          },
        };
        return query;
      }
      if (table === 'email_source_archive_manifests') {
        const query: any = {
          upsert(payload: Record<string, unknown>) {
            if (!manifest) {
              manifest = {
                ...payload,
                raw_deleted_at: null,
                normalized_deleted_at: null,
                committed_at: null,
                created_at: '2026-09-02T10:00:00.000Z',
                updated_at: '2026-09-02T10:00:00.000Z',
              };
            }
            return Promise.resolve({ error: null });
          },
          select() { return query; },
          eq() { return query; },
          in() { return query; },
          async maybeSingle() { return { data: manifest, error: null }; },
          update(values: Record<string, unknown>) {
            manifest = { ...(manifest ?? {}), ...values };
            return query;
          },
          then(resolve: (value: unknown) => void) { resolve({ error: null }); },
        };
        return query;
      }
      if (table === 'source_emails') {
        const query: any = {
          select() { return query; },
          eq() { return query; },
          async maybeSingle() {
            return { data: options.existingSource ?? null, error: null };
          },
          insert(payload: Record<string, unknown>) {
            insertedPayloads.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: 'source-email-1' }, error: null };
                  },
                };
              },
            };
          },
        };
        return query;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test('archive-enabled inbound stages manifest before objects and persists only source provenance', async () => {
  const store = new MemoryStore();
  const insertedPayloads: Record<string, unknown>[] = [];
  const db = dbFixture(insertedPayloads);
  const result = await persistNormalizedInboundEmail({
    db,
    recipientAddress: 'buyer@buyflow.hu',
    email: email(),
    security: {
      disposition: 'reject',
      signals: { spam: 'PASS', virus: 'FAIL', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' },
    },
    sourceArchiveEnabled: true,
    sourceArchiveRetentionDays: { rawDays: 30, normalizedDays: 60 },
    sourceArchiveStore: store,
    rawSource: {
      bytes: Buffer.from('raw mime bytes'),
      contentType: 'message/rfc822',
    },
  });

  assert.equal(result.status, 'security_rejected');
  assert.equal(result.sourceArchived, true);
  assert.match(result.traceId ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(result.purchaseWrites, 0);
  assert.equal(result.shipmentWrites, 0);
  assert.equal(result.documentWrites, 0);
  assert.equal(result.aiCalls, 0);
  assert.equal(store.puts.length, 2);

  const manifest = db.getManifest();
  assert.equal(manifest?.trace_id, result.traceId);
  assert.equal(manifest?.status, 'committed');
  assert.match(String(manifest?.source_identity_sha256), /^[0-9a-f]{64}$/);
  assert.equal(typeof manifest?.normalized_retention_until, 'string');

  assert.equal(insertedPayloads.length, 1);
  const payload = insertedPayloads[0]!;
  assert.equal(payload.archive_manifest_id, result.traceId);
  assert.equal(typeof payload.raw_object_key, 'string');
  assert.equal(typeof payload.raw_sha256, 'string');
  assert.equal(payload.raw_content_type, 'message/rfc822');
  assert.equal(typeof payload.raw_retention_until, 'string');
  assert.equal(typeof payload.normalized_object_key, 'string');
  assert.equal(typeof payload.normalized_sha256, 'string');
  assert.equal(payload.normalized_content_type, 'application/json');
  assert.equal(typeof payload.normalized_retention_until, 'string');
  assert.equal(payload.normalizer_version, 'normalized-email-document-v1.1');
  assert.equal(payload.trace_id, result.traceId);

  const structured = payload.structured_result as Record<string, unknown>;
  const archiveDiagnostic = structured.modern_email_source_v1 as Record<string, unknown>;
  assert.equal(archiveDiagnostic.archived, true);
  assert.equal(archiveDiagnostic.raw_archived, true);
  assert.equal('raw_object_key' in archiveDiagnostic, false);
});

test('deduped provider message rejects changed raw bytes instead of silently trusting the old id', async () => {
  const originalHash = createHash('sha256').update('original raw').digest('hex');
  const db = dbFixture([], {
    existingSource: {
      id: 'source-email-existing',
      classification: 'ORDER_CREATED',
      processing_status: 'review',
      validated_result: null,
      raw_sha256: originalHash,
      normalized_sha256: 'a'.repeat(64),
      archive_manifest_id: '11111111-1111-5111-8111-111111111111',
      trace_id: '11111111-1111-5111-8111-111111111111',
    },
  });

  await assert.rejects(
    persistNormalizedInboundEmail({
      db,
      recipientAddress: 'buyer@buyflow.hu',
      email: email(),
      sourceArchiveEnabled: true,
      sourceArchiveRetentionDays: { rawDays: 30, normalizedDays: 60 },
      rawSource: { bytes: Buffer.from('different raw'), contentType: 'message/rfc822' },
    }),
    /immutable raw hash conflict/,
  );
});
