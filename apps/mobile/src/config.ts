// The publishable Supabase key is intentionally safe for client apps.
// Never place SUPABASE_SECRET_KEY or any server-only credential here.
export const mobileConfig = {
  supabaseUrl:
    import.meta.env.VITE_SUPABASE_URL ?? 'https://acjenqkrvnkdvvgordry.supabase.co',
  supabasePublishableKey:
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    'sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp',
  apiBaseUrl:
    (import.meta.env.VITE_API_BASE_URL ?? 'https://buyflow-v3-api-dev.onrender.com').replace(/\/$/, ''),
};
