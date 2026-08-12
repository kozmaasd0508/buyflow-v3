import { createClient } from '@supabase/supabase-js';
import { requireSupabaseAdminConfig } from '../config.js';

let adminClient: ReturnType<typeof createClient> | undefined;

export function getSupabaseAdmin() {
  if (adminClient) {
    return adminClient;
  }

  const { url, secretKey } = requireSupabaseAdminConfig();

  adminClient = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return adminClient;
}
