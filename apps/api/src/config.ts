import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  NYLAS_API_KEY: z.string().min(1).optional(),
  NYLAS_API_URI: z.string().url().default('https://api.eu.nylas.com'),
  NYLAS_SMOKE_GRANT_ID: z.string().min(1).optional(),

  EMAIL_DISCOVERY_QUERY: z
    .string()
    .default('category:purchases newer_than:30d -in:spam -in:trash'),
});

export const env = envSchema.parse(process.env);

export function requireSupabaseAdminConfig() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase admin access is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment.',
    );
  }

  return {
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function requireNylasApiConfig() {
  if (!env.NYLAS_API_KEY) {
    throw new Error(
      'Nylas is not configured. Set NYLAS_API_KEY in the server environment.',
    );
  }

  return {
    apiKey: env.NYLAS_API_KEY,
    apiUri: env.NYLAS_API_URI,
  };
}

export function requireNylasSmokeGrantId() {
  if (!env.NYLAS_SMOKE_GRANT_ID) {
    throw new Error(
      'Nylas smoke grant is not configured. Set NYLAS_SMOKE_GRANT_ID in the server environment.',
    );
  }

  return env.NYLAS_SMOKE_GRANT_ID;
}
