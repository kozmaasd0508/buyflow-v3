import assert from 'node:assert/strict';
import test from 'node:test';
import { runEmailSourceArchiveMaintenance } from './source-archive-maintenance.js';
import type { EmailArchiveDeletionStore } from './source-archive-v1.js';
import type { EmailSourceArchiveManifestRow } from './source-archive-manifest.js';

class MemoryDeletionStore implements EmailArchiveDeletionStore {
  readonly removed: string[][] = [];
  async removeImmutable(keys: string[]): Promise<void> {
    this.removed.push([...keys]);
  }
}

function manifest(overrides: Partial<EmailSourceArchiveManifestRow> = {}): EmailSourceArchiveManifestRow {
  return {
    trace_id: '11111111-1111-5111-8111-111111111111',
    source_identity_sha256: 'a'.repeat(64),
    status: 'committed',
    raw_object_key: 'raw.eml',
    raw_sha256: 'b'.repeat(64),
    raw_size_bytes: 10,
    raw_content_type: 'message/rfc822',
    raw_retention_until: '2026-09-02T09:00:00.000Z',
    raw_deleted_at: null,
    normalized_object_key: 'normalized.json',
    normalized_sha256: 'c'.repeat(64),
    normalized_size_bytes: 20,
    normalized_content_type: 'application/json',
    normalized_retention_until: '2026-10-02T10:00:00.000Z',
    normalized_deleted_at: null,
    committed_at: '2026-09-01T10:00:00.000Z',
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function fakeDb(input: {
  manifests: EmailSourceArchiveManifestRow[];
  sources?: Record<string, any>;
}) {
  const manifests = input.manifests;
  const sources = input.sources ?? {};

  return {
    manifests,
    sources,
    from(table: string) {
      if (table === 'email_source_archive_manifests') {
        let updateValues: Record<string, unknown> | null = null;
        let traceId: string | null = null;
        const query: any = {
          select() { return query; },
          in() { return query; },
          order() { return query; },
          limit() { return Promise.resolve({ data: manifests, error: null }); },
          update(values: Record<string, unknown>) {
            updateValues = values;
            return query;
          },
          eq(_field: string, value: string) {
            traceId = value;
            if (updateValues) {
              const row = manifests.find((item) => item.trace_id === traceId);
              if (row) Object.assign(row, updateValues);
              return Promise.resolve({ error: null });
            }
            return query;
          },
        };
        return query;
      }

      if (table === 'source_emails') {
        let manifestId: string | null = null;
        let sourceId: string | null = null;
        let updateValues: Record<string, unknown> | null = null;
        const query: any = {
          select() { return query; },
          update(values: Record<string, unknown>) {
            updateValues = values;
            return query;
          },
          eq(field: string, value: string) {
            if (field === 'archive_manifest_id') manifestId = value;
            if (field === 'id') sourceId = value;
            if (updateValues && sourceId) {
              const row = Object.values(sources).find((item: any) => item.id === sourceId) as any;
              if (row) Object.assign(row, updateValues);
              return Promise.resolve({ error: null });
            }
            return query;
          },
          async maybeSingle() {
            return { data: manifestId ? (sources[manifestId] ?? null) : null, error: null };
          },
        };
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

const nowMs = Date.parse('2026-09-02T10:00:00.000Z');

test('committed manifest with missing source row deletes raw and normalized objects', async () => {
  const row = manifest();
  const db = fakeDb({ manifests: [row] });
  const store = new MemoryDeletionStore();
  const result = await runEmailSourceArchiveMaintenance({ db, store, nowMs });

  assert.deepEqual(store.removed, [['raw.eml', 'normalized.json']]);
  assert.equal(row.status, 'deleted');
  assert.equal(result.sourceMissingDeleted, 2);
  assert.equal(result.failed, 0);
});

test('expired raw object is deleted while normalized document remains until its own boundary', async () => {
  const row = manifest();
  const source = {
    id: 'source-1',
    archive_manifest_id: row.trace_id,
    raw_object_key: row.raw_object_key,
    raw_sha256: row.raw_sha256,
    raw_retention_until: row.raw_retention_until,
    raw_deleted_at: null,
    normalized_object_key: row.normalized_object_key,
    normalized_sha256: row.normalized_sha256,
    normalized_retention_until: row.normalized_retention_until,
    normalized_deleted_at: null,
  };
  const db = fakeDb({ manifests: [row], sources: { [row.trace_id]: source } });
  const store = new MemoryDeletionStore();
  const result = await runEmailSourceArchiveMaintenance({ db, store, nowMs });

  assert.deepEqual(store.removed, [['raw.eml']]);
  assert.equal(typeof source.raw_deleted_at, 'string');
  assert.equal(source.normalized_deleted_at, null);
  assert.equal(row.status, 'committed');
  assert.equal(result.rawExpiredDeleted, 1);
  assert.equal(result.normalizedExpiredDeleted, 0);
});

test('stale pending manifest without source row is treated as an orphan journal and cleaned', async () => {
  const row = manifest({
    status: 'pending',
    committed_at: null,
    created_at: '2026-09-02T08:00:00.000Z',
  });
  const db = fakeDb({ manifests: [row] });
  const store = new MemoryDeletionStore();
  const result = await runEmailSourceArchiveMaintenance({ db, store, nowMs });

  assert.equal(row.status, 'deleted');
  assert.equal(result.orphanObjectsDeleted, 2);
  assert.equal(result.failed, 0);
});

test('pending manifest with a matching source row is healed to committed without deleting data', async () => {
  const row = manifest({ status: 'pending', committed_at: null });
  const source = {
    id: 'source-1',
    archive_manifest_id: row.trace_id,
    raw_object_key: row.raw_object_key,
    raw_sha256: row.raw_sha256,
    raw_retention_until: row.raw_retention_until,
    raw_deleted_at: null,
    normalized_object_key: row.normalized_object_key,
    normalized_sha256: row.normalized_sha256,
    normalized_retention_until: row.normalized_retention_until,
    normalized_deleted_at: null,
  };
  const db = fakeDb({ manifests: [row], sources: { [row.trace_id]: source } });
  const store = new MemoryDeletionStore();
  const result = await runEmailSourceArchiveMaintenance({
    db,
    store,
    nowMs: Date.parse('2026-09-02T08:30:00.000Z'),
  });

  assert.equal(row.status, 'committed');
  assert.equal(result.healedCommits, 1);
  assert.deepEqual(store.removed, []);
});
