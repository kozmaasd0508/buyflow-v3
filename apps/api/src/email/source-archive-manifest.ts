import type {
  ArchivedEmailSourceV1,
  PreparedEmailSourceArchiveV1,
} from './source-archive-v1.js';

export interface EmailSourceArchiveManifestRow {
  trace_id: string;
  source_identity_sha256: string;
  status: 'pending' | 'committed' | 'deleted' | 'error';
  raw_object_key: string | null;
  raw_sha256: string | null;
  raw_size_bytes: number | null;
  raw_content_type: string | null;
  raw_retention_until: string | null;
  raw_deleted_at: string | null;
  normalized_object_key: string;
  normalized_sha256: string;
  normalized_size_bytes: number;
  normalized_content_type: string;
  normalized_retention_until: string;
  normalized_deleted_at: string | null;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
}

function manifestPayload(prepared: PreparedEmailSourceArchiveV1) {
  return {
    trace_id: prepared.traceId,
    source_identity_sha256: prepared.sourceIdentitySha256,
    status: 'pending',
    raw_object_key: prepared.rawRef?.objectKey ?? null,
    raw_sha256: prepared.rawRef?.sha256 ?? null,
    raw_size_bytes: prepared.rawRef?.sizeBytes ?? null,
    raw_content_type: prepared.rawRef?.contentType ?? null,
    raw_retention_until: prepared.rawRef?.retainedUntil ?? null,
    normalized_object_key: prepared.normalizedRef.objectKey,
    normalized_sha256: prepared.normalizedRef.sha256,
    normalized_size_bytes: prepared.normalizedRef.sizeBytes,
    normalized_content_type: prepared.normalizedRef.contentType,
    normalized_retention_until: prepared.normalizedRef.retainedUntil,
  };
}

function sameNullable(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

export function assertArchiveManifestMatchesPrepared(
  row: Partial<EmailSourceArchiveManifestRow>,
  prepared: PreparedEmailSourceArchiveV1,
): void {
  const expected = manifestPayload(prepared);
  const checks: Array<[string, unknown, unknown]> = [
    ['source_identity_sha256', row.source_identity_sha256, expected.source_identity_sha256],
    ['raw_object_key', row.raw_object_key, expected.raw_object_key],
    ['raw_sha256', row.raw_sha256, expected.raw_sha256],
    ['raw_size_bytes', row.raw_size_bytes, expected.raw_size_bytes],
    ['raw_content_type', row.raw_content_type, expected.raw_content_type],
    ['raw_retention_until', row.raw_retention_until, expected.raw_retention_until],
    ['normalized_object_key', row.normalized_object_key, expected.normalized_object_key],
    ['normalized_sha256', row.normalized_sha256, expected.normalized_sha256],
    ['normalized_size_bytes', row.normalized_size_bytes, expected.normalized_size_bytes],
    ['normalized_content_type', row.normalized_content_type, expected.normalized_content_type],
    ['normalized_retention_until', row.normalized_retention_until, expected.normalized_retention_until],
  ];
  for (const [field, actual, wanted] of checks) {
    if (!sameNullable(actual, wanted)) {
      throw new Error(`Email source archive manifest conflict: ${field}`);
    }
  }
}

export async function stageEmailSourceArchiveManifest(input: {
  db: any;
  prepared: PreparedEmailSourceArchiveV1;
}): Promise<void> {
  const payload = manifestPayload(input.prepared);
  const { error: insertError } = await input.db
    .from('email_source_archive_manifests')
    .upsert(payload, { onConflict: 'trace_id', ignoreDuplicates: true });
  if (insertError) {
    throw new Error(`Email source archive manifest stage failed: ${insertError.message ?? 'unknown database error'}`);
  }

  const { data, error } = await input.db
    .from('email_source_archive_manifests')
    .select('*')
    .eq('trace_id', input.prepared.traceId)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`Email source archive manifest verification failed: ${error?.message ?? 'missing manifest'}`);
  }
  assertArchiveManifestMatchesPrepared(data, input.prepared);
  if (!['pending', 'committed'].includes(String(data.status))) {
    throw new Error(`Email source archive manifest is not writable from status ${String(data.status)}`);
  }
}

export async function markEmailSourceArchiveCommitted(input: {
  db: any;
  source: ArchivedEmailSourceV1;
}): Promise<void> {
  const { error } = await input.db
    .from('email_source_archive_manifests')
    .update({
      status: 'committed',
      committed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('trace_id', input.source.traceId)
    .in('status', ['pending', 'committed']);
  if (error) {
    throw new Error(`Email source archive manifest commit failed: ${error.message ?? 'unknown database error'}`);
  }
}

export function assertExistingArchivedRawMatches(input: {
  existingRawSha256: unknown;
  incomingRawSha256: string | null;
}): void {
  const existing = typeof input.existingRawSha256 === 'string'
    ? input.existingRawSha256.toLowerCase()
    : null;
  if (!existing || !input.incomingRawSha256) return;
  if (existing !== input.incomingRawSha256.toLowerCase()) {
    throw new Error('Email source archive immutable raw hash conflict');
  }
}
