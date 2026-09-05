import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, requireSupabaseAdminConfig } from '../config.js';
import type { Database } from './database.types.js';

let adminClient: SupabaseClient<Database> | undefined;
let archiveMaintenanceStarted = false;

function startArchiveMaintenance(client: SupabaseClient<Database>) {
  if (!env.BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED || archiveMaintenanceStarted) return;
  archiveMaintenanceStarted = true;

  const run = async () => {
    try {
      const { runEmailSourceArchiveMaintenance } = await import('../email/source-archive-maintenance.js');
      const result = await runEmailSourceArchiveMaintenance({ db: client });
      if (result.failed > 0) {
        console.warn('RawVault maintenance completed with failures', {
          scanned: result.scanned,
          failed: result.failed,
        });
      }
    } catch (error) {
      console.error('RawVault maintenance failed', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  };

  setImmediate(() => { void run(); });
  const timer = setInterval(() => { void run(); }, 60_000);
  timer.unref();
}

export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (adminClient) {
    return adminClient;
  }

  const { url, secretKey } = requireSupabaseAdminConfig();

  adminClient = createClient<Database>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  startArchiveMaintenance(adminClient);

  return adminClient;
}
