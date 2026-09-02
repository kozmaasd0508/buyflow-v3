import { env } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  renewDirectGmailWatch,
  runDirectGmailIncrementalSync,
} from './gmail-direct-sync.js';
import type { GmailRuntimeDb } from './gmail-runtime-state.js';

const MAINTENANCE_BATCH = 100;
const WATCH_RENEW_BEFORE_MS = 24 * 60 * 60_000;

interface GmailMaintenanceStateRow {
  user_id: string;
  email_connection_id: string;
  cursor_value: string | null;
  last_synced_at?: string | null;
  watch_expires_at?: string | null;
}

export interface GmailDirectMaintenanceSummary {
  syncScanned: number;
  syncSucceeded: number;
  syncFailed: number;
  resetRecovered: number;
  watchScanned: number;
  watchRenewed: number;
  watchFailed: number;
}

/**
 * Operational safety net for direct Gmail.
 *
 * Pub/Sub remains the low-latency wake-up path, but Google explicitly treats
 * push delivery as a notification mechanism rather than the sole durable source.
 * This sweep periodically resumes from the DB cursor even when no push arrived,
 * and renews watches before expiry. No Purchase/Identity authority is added.
 */
export async function runDirectGmailMaintenance(
  dbOverride?: GmailRuntimeDb,
): Promise<GmailDirectMaintenanceSummary> {
  const summary: GmailDirectMaintenanceSummary = {
    syncScanned: 0,
    syncSucceeded: 0,
    syncFailed: 0,
    resetRecovered: 0,
    watchScanned: 0,
    watchRenewed: 0,
    watchFailed: 0,
  };
  if (!env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) return summary;

  const db = dbOverride ?? (getSupabaseAdmin() as any);
  const { data: syncRows, error: syncError } = await db
    .from('email_sync_states')
    .select('user_id,email_connection_id,cursor_value,last_synced_at')
    .eq('provider', 'gmail')
    .not('cursor_value', 'is', null)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAINTENANCE_BATCH);
  if (syncError) {
    throw new Error(`Gmail maintenance sync scan failed: ${syncError.message ?? 'unknown database error'}`);
  }

  for (const raw of (syncRows ?? []) as GmailMaintenanceStateRow[]) {
    if (!raw.user_id || !raw.email_connection_id || !raw.cursor_value) continue;
    summary.syncScanned += 1;
    try {
      const result = await runDirectGmailIncrementalSync({
        db,
        userId: raw.user_id,
        emailConnectionId: raw.email_connection_id,
      });
      summary.syncSucceeded += 1;
      if (result.resetRecovered) summary.resetRecovered += 1;
    } catch {
      summary.syncFailed += 1;
    }
  }

  const renewBefore = new Date(Date.now() + WATCH_RENEW_BEFORE_MS).toISOString();
  const { data: watchRows, error: watchError } = await db
    .from('email_sync_states')
    .select('user_id,email_connection_id,cursor_value,watch_expires_at')
    .eq('provider', 'gmail')
    .not('cursor_value', 'is', null)
    .or(`watch_expires_at.is.null,watch_expires_at.lte.${renewBefore}`)
    .limit(MAINTENANCE_BATCH);
  if (watchError) {
    throw new Error(`Gmail maintenance watch scan failed: ${watchError.message ?? 'unknown database error'}`);
  }

  for (const raw of (watchRows ?? []) as GmailMaintenanceStateRow[]) {
    if (!raw.user_id || !raw.email_connection_id || !raw.cursor_value) continue;
    summary.watchScanned += 1;
    try {
      await renewDirectGmailWatch({
        db,
        userId: raw.user_id,
        emailConnectionId: raw.email_connection_id,
      });
      summary.watchRenewed += 1;
    } catch {
      // Missing Pub/Sub configuration or a transient provider failure must not
      // disable the fallback history sweep. The next maintenance pass retries.
      summary.watchFailed += 1;
    }
  }

  return summary;
}
