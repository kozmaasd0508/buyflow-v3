import { createClient } from '@supabase/supabase-js';
import { mobileConfig } from './config.js';

export const supabase = createClient(
  mobileConfig.supabaseUrl,
  mobileConfig.supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
