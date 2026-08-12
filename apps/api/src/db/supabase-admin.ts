import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseAdminConfig } from '../config.js';
import type { Database } from './database.types.js';

let adminClient: SupabaseClient<Database> | undefined;

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

  return adminClient;
}
