import 'dotenv/config';
import { z } from 'zod';

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
  OPENAI_MODEL: z.string().min(1).default('gpt-5.4-nano'),
  BUYFLOW_AI_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),

  // Gate B is read-only by construction. This switch is an operational kill
  // switch only; disabling it never changes the production protocol registry.
  BUYFLOW_PROTOCOL_PRODUCTION_SHADOW_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // Modern source archival is separate from Purchase/Identity authority and is
  // disabled until its private bucket + additive DB migration are deployed.
  BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  BUYFLOW_EMAIL_SOURCE_ARCHIVE_BUCKET: z
    .string()
    .min(3)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]*$/)
    .default('buyflow-email-source-v1'),
  // No retention duration is guessed. Archive writes fail closed until both
  // policies are explicitly configured in the deployment environment.
  BUYFLOW_EMAIL_SOURCE_RAW_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).optional(),
  BUYFLOW_EMAIL_SOURCE_NORMALIZED_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).optional(),

  // Mailgun may feed the generic source persistence path only after both this
  // switch and BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED are explicitly enabled.
  // Default behavior remains the existing read-only Mailgun shadow route.
  BUYFLOW_MAILGUN_SOURCE_PERSIST_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // Direct Gmail is an alternative provider runtime. It is deliberately OFF by
  // default until OAuth credentials, encrypted-token storage, Pub/Sub and the
  // additive DB migrations are deployed and shadow-smoked.
  BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  GOOGLE_GMAIL_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_GMAIL_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_GMAIL_PUBSUB_TOPIC: z.string().min(1).optional(),
  GOOGLE_GMAIL_PUBSUB_AUDIENCE: z.string().url().optional(),
  GOOGLE_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  BUYFLOW_EMAIL_CREDENTIALS_KEY_BASE64: z.string().min(1).optional(),
  // Gmail categories are advisory only. Direct Gmail scans a broad mailbox
  // window and lets BuyFlow's commerce gate decide which messages matter.
  GMAIL_DIRECT_DISCOVERY_QUERY: z
    .string()
    .default('newer_than:30d -in:spam -in:trash'),

  BUYFLOW_AUTOMATION_MODE: z.enum(['observe', 'write']).default('observe'),
  BUYFLOW_SMOKE_USER_ID: z.string().uuid().optional(),
  BUYFLOW_SMOKE_CONNECTION_ID: z.string().uuid().optional(),

  // Legacy/Nylas discovery query retained unchanged for backwards compatibility.
  EMAIL_DISCOVERY_QUERY: z
    .string()
    .default('category:purchases newer_than:30d -in:spam -in:trash'),
});

export const env = envSchema.parse(process.env);

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

export function requireEmailSourceArchiveRetentionConfig() {
  if (
    !env.BUYFLOW_EMAIL_SOURCE_RAW_RETENTION_DAYS
    || !env.BUYFLOW_EMAIL_SOURCE_NORMALIZED_RETENTION_DAYS
  ) {
    throw new Error(
      'Email source archive retention is not configured. Set BUYFLOW_EMAIL_SOURCE_RAW_RETENTION_DAYS and BUYFLOW_EMAIL_SOURCE_NORMALIZED_RETENTION_DAYS before enabling archive writes.',
    );
  }
  return {
    rawDays: env.BUYFLOW_EMAIL_SOURCE_RAW_RETENTION_DAYS,
    normalizedDays: env.BUYFLOW_EMAIL_SOURCE_NORMALIZED_RETENTION_DAYS,
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

export function requireGmailDirectRuntimeConfig() {
  if (!env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) {
    throw new Error('Direct Gmail runtime is disabled');
  }
  if (
    !env.GOOGLE_GMAIL_OAUTH_CLIENT_ID
    || !env.GOOGLE_GMAIL_OAUTH_CLIENT_SECRET
    || !env.BUYFLOW_EMAIL_CREDENTIALS_KEY_BASE64
  ) {
    throw new Error(
      'Direct Gmail runtime is not configured. Set GOOGLE_GMAIL_OAUTH_CLIENT_ID, GOOGLE_GMAIL_OAUTH_CLIENT_SECRET and BUYFLOW_EMAIL_CREDENTIALS_KEY_BASE64.',
    );
  }
  return {
    clientId: env.GOOGLE_GMAIL_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_GMAIL_OAUTH_CLIENT_SECRET,
    credentialKeyBase64: env.BUYFLOW_EMAIL_CREDENTIALS_KEY_BASE64,
    pubsubTopicName: env.GOOGLE_GMAIL_PUBSUB_TOPIC ?? null,
  };
}

export function requireGmailPubSubPushConfig() {
  requireGmailDirectRuntimeConfig();
  if (
    !env.GOOGLE_GMAIL_PUBSUB_AUDIENCE
    || !env.GOOGLE_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL
  ) {
    throw new Error(
      'Gmail Pub/Sub push authentication is not configured. Set GOOGLE_GMAIL_PUBSUB_AUDIENCE and GOOGLE_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL.',
    );
  }
  return {
    audience: env.GOOGLE_GMAIL_PUBSUB_AUDIENCE,
    serviceAccountEmail: env.GOOGLE_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL.toLowerCase(),
  };
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
