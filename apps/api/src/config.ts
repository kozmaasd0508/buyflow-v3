import 'dotenv/config';
import { z } from 'zod';

export const BUYFLOW_RUNTIME_OPENAI_MODEL = 'gpt-5.6-luna' as const;

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  BUYFLOW_PUBLIC_BASE_URL: z
    .string()
    .url()
    .default('https://buyflow-v3-api-dev.onrender.com'),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  NYLAS_API_KEY: z.string().min(1).optional(),
  NYLAS_API_URI: z.string().url().default('https://api.eu.nylas.com'),
  NYLAS_SMOKE_GRANT_ID: z.string().min(1).optional(),
  NYLAS_WEBHOOK_SECRET: z.string().min(1).optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),
  // BuyFlow's server-side OpenAI runtime is intentionally pinned to Luna.
  // An old deployment-level OPENAI_MODEL value must not silently move the app
  // back to a different model while this release contract is active.
  OPENAI_MODEL: z
    .string()
    .min(1)
    .default(BUYFLOW_RUNTIME_OPENAI_MODEL)
    .transform(() => BUYFLOW_RUNTIME_OPENAI_MODEL),
  // Legacy automatic-AI authority flag. Kept OFF by default.
  BUYFLOW_AI_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  // Luna may analyze unmatched transactional mail in shadow/observe mode only.
  // This never grants Purchase/Shipment/Document write authority.
  BUYFLOW_LUNA_SHADOW_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  // One-shot operational verification only. Uses a static synthetic email and
  // never reads Gmail/Nylas or writes BuyFlow data. Keep false outside a smoke.
  BUYFLOW_LUNA_STARTUP_SMOKE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // Gate B is read-only by construction. This switch is an operational kill
  // switch only; disabling it never changes the production protocol registry.
  BUYFLOW_PROTOCOL_PRODUCTION_SHADOW_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  BUYFLOW_AUTOMATION_MODE: z.enum(['observe', 'write']).default('observe'),
  BUYFLOW_SMOKE_USER_ID: z.string().uuid().optional(),
  BUYFLOW_SMOKE_CONNECTION_ID: z.string().uuid().optional(),

  EMAIL_DISCOVERY_QUERY: z
    .string()
    .default('category:purchases newer_than:30d -in:spam -in:trash'),
});

export const env = envSchema.parse(process.env);

export function isLunaShadowConfigured(): boolean {
  return env.BUYFLOW_LUNA_SHADOW_ENABLED && Boolean(env.OPENAI_API_KEY);
}

// Safe runtime receipt: intentionally reports booleans/model only, never secrets.
console.info('[luna-runtime-config]', JSON.stringify({
  model: env.OPENAI_MODEL,
  shadowEnabled: env.BUYFLOW_LUNA_SHADOW_ENABLED,
  openaiKeyConfigured: Boolean(env.OPENAI_API_KEY),
  lunaShadowConfigured: isLunaShadowConfigured(),
}));

export function requireSupabaseAdminConfig() {
  const secretKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

  if (!env.SUPABASE_URL || !secretKey) {
    throw new Error(
      'Supabase admin access is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in the server environment.',
    );
  }

  return {
    url: env.SUPABASE_URL,
    secretKey,
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

export function requireNylasWebhookSecret() {
  if (!env.NYLAS_WEBHOOK_SECRET) {
    throw new Error('Nylas webhook secret is not configured. Set NYLAS_WEBHOOK_SECRET.');
  }
  return env.NYLAS_WEBHOOK_SECRET;
}

export function requireOpenAIConfig() {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      'OpenAI is not configured. Set OPENAI_API_KEY in the server environment.',
    );
  }

  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
  };
}

export function requireSmokeImportContext() {
  if (!env.BUYFLOW_SMOKE_USER_ID || !env.BUYFLOW_SMOKE_CONNECTION_ID) {
    throw new Error(
      'Smoke import context is not configured. Set BUYFLOW_SMOKE_USER_ID and BUYFLOW_SMOKE_CONNECTION_ID.',
    );
  }

  return {
    userId: env.BUYFLOW_SMOKE_USER_ID,
    emailConnectionId: env.BUYFLOW_SMOKE_CONNECTION_ID,
  };
}
