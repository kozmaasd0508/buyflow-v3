import { env } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  SupabaseEmailArchiveObjectStore,
  type EmailArchiveDeletionStore,
} from './source-archive-v1.js';
import type { EmailSourceArchiveManifestRow } from './source-archive-manifest.js';

const DEFAULT_BATCH = 100;
const ORPHAN_GRACE_MS = 60 * 60_000;

interface SourceArchiveRow {
  id: string;
  archive_manifest_id: string | null;
  raw_object_key: string | null;
  raw_sha256: string | null;
  raw_retention_until: string | null;
  raw_deleted_at: string | null;
  normalized_object_key: string | null;
  normalized_sha256: string | null;
  normalized_retention_until: string | null;
  normalized_deleted_at: string | null;
}

export interface EmailSourceArchiveMaintenanceSummary {
  scanned: number;
  healedCommits: number;
  orphanObjectsDeleted: number;
  rawExpiredDeleted: number;
  normalizedExpiredDeleted: number;
  sourceMissingDeleted: number;
  failed: number;
}

function due(value: string | null | undefined, nowMs: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function manifestMatchesSource(
  manifest: EmailSourceArchiveManifestRow,
  source: SourceArchiveRow,
): boolean {
  return (
    (manifest.raw_object_key ?? null) === (source.raw_object_key ?? null)
    && (manifest.raw_sha256 ?? null) === (source.raw_sha256 ?? null)
    && manifest.normalized_object_key === source.normalized_object_key
    && manifest.normalized_sha256 === source.normalized_sha256
    && (manifest.raw_retention_until ?? null) === (source.raw_retention_until ?? null)
    && manifest.normalized_retention_until === source.normalized_retention_until
  );
}

async function loadSourceForManifest(db: any, traceId: string): Promise<SourceArchiveRow | null> {
  const { data, error } = await db
    .from('source_emails')
    .select('id,archive_manifest_id,raw_object_key,raw_sha256,raw_retention_until,raw_deleted_at,normalized_object_key,normalized_sha256,normalized_retention_until,normalized_deleted_at')
    .eq('archive_manifest_id', traceId)
    .maybeSingle();
  if (error) {
    throw new Error(`Email source archive source-row lookup failed: ${error.message ?? 'unknown database error'}`);
  }
  return data ? data as SourceArchiveRow : null;
}

async function updateManifest(db: any, traceId: string, values: Record<string, unknown>) {
  const { error } = await db
    .from('email_source_archive_manifests')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('trace_id', traceId);
  if (error) {
    throw new Error(`Email source archive manifest update failed: ${error.message ?? 'unknown database error'}`);
  }
}

async function markSourceDeleted(db: any, sourceId: string, values: Record<string, unknown>) {
  const { error } = await db
    .from('source_emails')
    .update(values)
    .eq('id', sourceId);
  if (error) {
    throw new Error(`Email source archive deletion marker failed: ${error.message ?? 'unknown database error'}`);
  }
}

async function removeAllManifestObjects(
  store: EmailArchiveDeletionStore,
  manifest: EmailSourceArchiveManifestRow,
): Promise<number> {
  const keys = [manifest.raw_object_key, manifest.normalized_object_key]
    .filter((value): value is string => Boolean(value));
  await store.removeImmutable(keys);
  return keys.length;
}

export async function runEmailSourceArchiveMaintenance(input: {
  db?: any;
  store?: EmailArchiveDeletionStore;
  nowMs?: number;
  batch?: number;
} = {}): Promise<EmailSourceArchiveMaintenanceSummary> {
  const summary: EmailSourceArchiveMaintenanceSummary = {
    scanned: 0,
    healedCommits: 0,
    orphanObjectsDeleted: 0,
    rawExpiredDeleted: 0,
    normalizedExpiredDeleted: 0,
    sourceMissingDeleted: 0,
    failed: 0,
  };
  if (!env.BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED && !input.db && !input.store) return summary;

  const db = input.db ?? (getSupabaseAdmin() as any);
  const store = input.store ?? new SupabaseEmailArchiveObjectStore(
    db,
    env.BUYFLOW_EMAIL_SOURCE_ARCHIVE_BUCKET,
  );
  const nowMs = input.nowMs ?? Date.now();
  const limit = Math.min(Math.max(Math.trunc(input.batch ?? DEFAULT_BATCH), 1), 500);

  const { data, error } = await db
    .from('email_source_archive_manifests')
    .select('*')
    .in('status', ['pending', 'committed'])
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(`Email source archive maintenance scan failed: ${error.message ?? 'unknown database error'}`);
  }

  const manifests = (data ?? []) as EmailSourceArchiveManifestRow[];
  summary.scanned = manifests.length;

  for (const manifest of manifests) {
    try {
      const source = await loadSourceForManifest(db, manifest.trace_id);

      if (!source) {
        const createdAtMs = Date.parse(manifest.created_at);
        const stalePending = manifest.status === 'pending'
          && Number.isFinite(createdAtMs)
          && createdAtMs <= nowMs - ORPHAN_GRACE_MS;
        const sourceWasDeleted = manifest.status === 'committed';
        if (!stalePending && !sourceWasDeleted) continue;

        const removed = await removeAllManifestObjects(store, manifest);
        await updateManifest(db, manifest.trace_id, {
          status: 'deleted',
          raw_deleted_at: manifest.raw_object_key ? new Date(nowMs).toISOString() : manifest.raw_deleted_at,
          normalized_deleted_at: new Date(nowMs).toISOString(),
          last_error_code: null,
        });
        if (sourceWasDeleted) summary.sourceMissingDeleted += removed;
        else summary.orphanObjectsDeleted += removed;
        continue;
      }

      if (!manifestMatchesSource(manifest, source)) {
        await updateManifest(db, manifest.trace_id, {
          status: 'error',
          last_error_code: 'ArchiveMetadataMismatch',
        });
        summary.failed += 1;
        continue;
      }

      if (manifest.status === 'pending') {
        await updateManifest(db, manifest.trace_id, {
          status: 'committed',
          committed_at: new Date(nowMs).toISOString(),
          last_error_code: null,
        });
        summary.healedCommits += 1;
      }

      const deleteRaw = Boolean(
        manifest.raw_object_key
        && !source.raw_deleted_at
        && due(source.raw_retention_until, nowMs),
      );
      const deleteNormalized = Boolean(
        source.normalized_object_key
        && !source.normalized_deleted_at
        && due(source.normalized_retention_until, nowMs),
      );
      if (!deleteRaw && !deleteNormalized) continue;

      const keys: string[] = [];
      if (deleteRaw && manifest.raw_object_key) keys.push(manifest.raw_object_key);
      if (deleteNormalized) keys.push(manifest.normalized_object_key);
      await store.removeImmutable(keys);

      const deletionIso = new Date(nowMs).toISOString();
      await markSourceDeleted(db, source.id, {
        ...(deleteRaw ? { raw_deleted_at: deletionIso } : {}),
        ...(deleteNormalized ? { normalized_deleted_at: deletionIso } : {}),
      });

      const rawDeletedAt = deleteRaw ? deletionIso : manifest.raw_deleted_at;
      const normalizedDeletedAt = deleteNormalized ? deletionIso : manifest.normalized_deleted_at;
      const rawGone = !manifest.raw_object_key || Boolean(rawDeletedAt);
      const normalizedGone = Boolean(normalizedDeletedAt);
      await updateManifest(db, manifest.trace_id, {
        ...(deleteRaw ? { raw_deleted_at: deletionIso } : {}),
        ...(deleteNormalized ? { normalized_deleted_at: deletionIso } : {}),
        ...(rawGone && normalizedGone ? { status: 'deleted' } : { status: 'committed' }),
        last_error_code: null,
      });

      if (deleteRaw) summary.rawExpiredDeleted += 1;
      if (deleteNormalized) summary.normalizedExpiredDeleted += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
