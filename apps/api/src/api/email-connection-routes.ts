import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, requireNylasApiConfig } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  drainEmailScanJobs,
  enqueueInitialEmailScan,
  processEmailScanJob,
} from '../ingestion/email-scan-jobs.js';
import { resolveAuthenticatedApiUser } from './auth.js';

interface NylasApplicationResponse {
  data?: {
    application_id?: string;
    callback_uris?: Array<{ url?: string }>;
  };
}

interface NylasRedirectUrisResponse {
  data?: Array<{ url?: string }>;
}

interface NylasTokenResponse {
  grant_id?: string;
  email?: string;
  provider?: string;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function stateHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function publicBaseUrl(): string {
  return env.BUYFLOW_PUBLIC_BASE_URL.replace(/\/$/, '');
}

function scheduleScan(app: FastifyInstance, jobId: string) {
  setImmediate(() => {
    void processEmailScanJob(jobId, env.BUYFLOW_AUTOMATION_MODE).catch((error) => {
      app.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Initial 7 day email scan failed and was scheduled for retry');
    });
  });
}

async function nylasJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiKey, apiUri } = requireNylasApiConfig();
  const response = await fetch(`${apiUri}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Nylas request failed with status ${response.status}`);
  }

  return await response.json() as T;
}

async function nylasApplicationId(): Promise<string> {
  const response = await nylasJson<NylasApplicationResponse>('/v3/applications');
  const applicationId = response.data?.application_id;
  if (!applicationId) throw new Error('Nylas application id is unavailable');
  return applicationId;
}

async function ensureNylasCallbackUri(callbackUri: string): Promise<void> {
  const response = await nylasJson<NylasRedirectUrisResponse>('/v3/applications/redirect-uris');
  const exists = (response.data ?? []).some((entry) => entry.url === callbackUri);
  if (exists) return;

  await nylasJson('/v3/applications/redirect-uris', {
    method: 'POST',
    body: JSON.stringify({
      platform: 'web',
      url: callbackUri,
    }),
  });
}

async function exchangeNylasCode(input: {
  code: string;
  callbackUri: string;
  applicationId: string;
}): Promise<NylasTokenResponse> {
  const { apiKey, apiUri } = requireNylasApiConfig();
  const response = await fetch(`${apiUri}/v3/connect/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: input.applicationId,
      client_secret: apiKey,
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.callbackUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Nylas token exchange failed with status ${response.status}`);
  }

  return await response.json() as NylasTokenResponse;
}

export async function registerEmailConnectionRoutes(app: FastifyInstance) {
  app.get('/api/email-connections', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const db = getSupabaseAdmin() as any;
    const { data, error } = await db
      .from('email_connections')
      .select('id,provider,email_address,status,connected_at,updated_at')
      .eq('user_id', user.id)
      .order('connected_at', { ascending: false });

    if (error) {
      request.log.error({ errorType: 'EmailConnectionListError' }, 'Failed to load email connections');
      return reply.code(500).send({ error: 'email_connections_unavailable' });
    }

    const rows = data ?? [];
    const connectionIds = rows.map((row: any) => row.id);
    let scanRows: any[] = [];

    if (connectionIds.length > 0) {
      const { data: scans, error: scanError } = await db
        .from('email_scan_jobs')
        .select('email_connection_id,window_days,status,processed_at,result')
        .eq('user_id', user.id)
        .eq('kind', 'initial')
        .in('email_connection_id', connectionIds);

      if (scanError) {
        request.log.error({ errorType: 'EmailScanStatusReadError' }, 'Failed to load initial email scan status');
        return reply.code(500).send({ error: 'email_connections_unavailable' });
      }
      scanRows = scans ?? [];
    }

    return {
      connections: rows.map((row: any) => {
        const scan = scanRows.find((candidate) => candidate.email_connection_id === row.id);
        return {
          id: row.id,
          provider: row.provider,
          emailAddress: row.email_address,
          status: row.status,
          connectedAt: row.connected_at,
          updatedAt: row.updated_at,
          initialScan: scan ? {
            windowDays: scan.window_days,
            status: scan.status,
            processedAt: scan.processed_at,
            result: scan.result ?? null,
          } : null,
        };
      }),
    };
  });

  app.post('/api/email-connections/nylas/start', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const db = getSupabaseAdmin() as any;
    const callbackUri = `${publicBaseUrl()}/auth/nylas/callback`;

    try {
      const { error: userError } = await db
        .from('users')
        .upsert({ id: user.id, email: user.email ?? null }, { onConflict: 'id' });
      if (userError) throw new Error(`Failed to ensure BuyFlow user: ${userError.message}`);

      const applicationId = await nylasApplicationId();
      await ensureNylasCallbackUri(callbackUri);

      const state = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

      await db.from('email_oauth_states').delete().lt('expires_at', new Date().toISOString());
      const { error: stateError } = await db.from('email_oauth_states').insert({
        user_id: user.id,
        provider: 'nylas',
        state_hash: stateHash(state),
        expires_at: expiresAt,
      });
      if (stateError) throw new Error(`Failed to create OAuth state: ${stateError.message}`);

      const authorizeUrl = new URL(`${requireNylasApiConfig().apiUri}/v3/connect/auth`);
      authorizeUrl.searchParams.set('client_id', applicationId);
      authorizeUrl.searchParams.set('redirect_uri', callbackUri);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('provider', 'google');
      authorizeUrl.searchParams.set('access_type', 'offline');
      authorizeUrl.searchParams.set('state', state);

      return { authorizeUrl: authorizeUrl.toString() };
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Failed to start Nylas email connection');
      return reply.code(503).send({ error: 'email_connection_start_unavailable' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/email-connections/:id/initial-scan', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const db = getSupabaseAdmin() as any;
    const { data: connection, error } = await db
      .from('email_connections')
      .select('id')
      .eq('id', request.params.id)
      .eq('user_id', user.id)
      .eq('provider', 'nylas')
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      request.log.error({ errorType: 'InitialScanConnectionReadError' }, 'Failed to verify email connection');
      return reply.code(500).send({ error: 'email_scan_unavailable' });
    }
    if (!connection) return reply.code(404).send({ error: 'email_connection_not_found' });

    try {
      const jobId = await enqueueInitialEmailScan({
        userId: user.id,
        emailConnectionId: connection.id,
        windowDays: 7,
      });

      const { data: job } = await db
        .from('email_scan_jobs')
        .select('status')
        .eq('id', jobId)
        .single();

      if (job?.status !== 'processed') scheduleScan(app, jobId);
      return reply.code(job?.status === 'processed' ? 200 : 202).send({
        status: job?.status ?? 'pending',
        windowDays: 7,
      });
    } catch (scanError) {
      request.log.error({
        errorType: scanError instanceof Error ? scanError.name : 'UnknownError',
      }, 'Failed to enqueue initial 7 day email scan');
      return reply.code(503).send({ error: 'email_scan_unavailable' });
    }
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>('/auth/nylas/callback', async (request, reply) => {
    const successUrl = `${publicBaseUrl()}/app/?gmail=connected`;
    const errorUrl = `${publicBaseUrl()}/app/?gmail=error`;

    if (request.query.error || !request.query.code || !request.query.state) {
      return reply.redirect(errorUrl);
    }

    const db = getSupabaseAdmin() as any;
    const callbackUri = `${publicBaseUrl()}/auth/nylas/callback`;

    try {
      const { data: stateRow, error: stateError } = await db
        .from('email_oauth_states')
        .delete()
        .eq('provider', 'nylas')
        .eq('state_hash', stateHash(request.query.state))
        .gt('expires_at', new Date().toISOString())
        .select('user_id')
        .maybeSingle();

      if (stateError || !stateRow?.user_id) {
        return reply.redirect(errorUrl);
      }

      const applicationId = await nylasApplicationId();
      const token = await exchangeNylasCode({
        code: request.query.code,
        callbackUri,
        applicationId,
      });

      const grantId = token.grant_id?.trim();
      const emailAddress = token.email?.trim().toLowerCase();
      if (!grantId || !emailAddress) throw new Error('Nylas token response is missing grant identity');

      const now = new Date().toISOString();
      const { data: connection, error: connectionError } = await db
        .from('email_connections')
        .upsert({
          user_id: stateRow.user_id,
          provider: 'nylas',
          provider_account_id: grantId,
          email_address: emailAddress,
          status: 'active',
          connected_at: now,
          updated_at: now,
        }, {
          onConflict: 'user_id,provider,email_address',
        })
        .select('id')
        .single();

      if (connectionError || !connection) {
        throw new Error(`Failed to save email connection: ${connectionError?.message ?? 'missing connection'}`);
      }

      const scanJobId = await enqueueInitialEmailScan({
        userId: stateRow.user_id,
        emailConnectionId: connection.id,
        windowDays: 7,
      });
      scheduleScan(app, scanJobId);

      return reply.redirect(successUrl);
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Nylas email connection callback failed');
      return reply.redirect(errorUrl);
    }
  });

  void drainEmailScanJobs(env.BUYFLOW_AUTOMATION_MODE).catch((error) => {
    app.log.error({
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }, 'Initial email scan recovery failed at startup');
  });

  const scanRecoveryTimer = setInterval(() => {
    void drainEmailScanJobs(env.BUYFLOW_AUTOMATION_MODE).catch((error) => {
      app.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Initial email scan recovery failed');
    });
  }, 60_000);
  scanRecoveryTimer.unref();
}
