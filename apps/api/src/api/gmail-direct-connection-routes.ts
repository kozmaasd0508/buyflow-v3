import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env, requireGmailDirectRuntimeConfig } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  GoogleGmailOAuthClient,
  createGmailPkcePair,
} from '../email/gmail-oauth.js';
import { ProviderCredentialCrypto } from '../email/provider-credential-crypto.js';
import {
  ensureGmailSyncState,
  loadGmailRefreshCredential,
  saveGmailRefreshCredential,
} from '../email/gmail-runtime-state.js';
import { resolveAuthenticatedApiUser } from './auth.js';

function stateHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function publicBaseUrl(): string {
  return env.BUYFLOW_PUBLIC_BASE_URL.replace(/\/$/, '');
}

function callbackUri(): string {
  return `${publicBaseUrl()}/auth/google/gmail/callback`;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function oauthClient() {
  const config = requireGmailDirectRuntimeConfig();
  return new GoogleGmailOAuthClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: callbackUri(),
  });
}

export async function registerGmailDirectConnectionRoutes(app: FastifyInstance) {
  app.post('/api/email-connections/gmail/start', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    if (!env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) {
      return reply.code(503).send({ error: 'gmail_direct_runtime_disabled' });
    }

    const db = getSupabaseAdmin() as any;
    try {
      const config = requireGmailDirectRuntimeConfig();
      const { error: userError } = await db
        .from('users')
        .upsert({ id: user.id, email: user.email ?? null }, { onConflict: 'id' });
      if (userError) throw new Error(`Failed to ensure BuyFlow user: ${userError.message}`);

      const state = randomBytes(32).toString('base64url');
      const pkce = createGmailPkcePair();
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

      await db.from('email_oauth_states').delete().lt('expires_at', new Date().toISOString());
      const { error: stateError } = await db.from('email_oauth_states').insert({
        user_id: user.id,
        provider: 'gmail',
        state_hash: stateHash(state),
        pkce_verifier: pkce.verifier,
        redirect_uri: callbackUri(),
        expires_at: expiresAt,
      });
      if (stateError) throw new Error(`Failed to create Gmail OAuth state: ${stateError.message}`);

      const client = new GoogleGmailOAuthClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: callbackUri(),
      });
      return {
        authorizeUrl: client.buildAuthorizeUrl({
          state,
          codeChallenge: pkce.challenge,
        }),
      };
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Failed to start direct Gmail connection');
      return reply.code(503).send({ error: 'gmail_connection_start_unavailable' });
    }
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>('/auth/google/gmail/callback', async (request, reply) => {
    const successUrl = `${publicBaseUrl()}/app/?gmail=connected&provider=direct`;
    const errorUrl = `${publicBaseUrl()}/app/?gmail=error&provider=direct`;
    if (!env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) return reply.redirect(errorUrl);
    if (request.query.error || !request.query.code || !request.query.state) {
      return reply.redirect(errorUrl);
    }

    const db = getSupabaseAdmin() as any;
    try {
      const runtimeConfig = requireGmailDirectRuntimeConfig();
      const { data: stateRow, error: stateError } = await db
        .from('email_oauth_states')
        .delete()
        .eq('provider', 'gmail')
        .eq('state_hash', stateHash(request.query.state))
        .gt('expires_at', new Date().toISOString())
        .select('user_id,pkce_verifier,redirect_uri')
        .maybeSingle();
      if (
        stateError
        || !stateRow?.user_id
        || !stateRow?.pkce_verifier
        || stateRow.redirect_uri !== callbackUri()
      ) {
        return reply.redirect(errorUrl);
      }

      const client = oauthClient();
      const token = await client.exchangeCode({
        code: request.query.code,
        codeVerifier: stateRow.pkce_verifier,
      });
      const profile = await client.getGmailProfile(token.accessToken);
      const now = new Date().toISOString();

      // Create/update the connection in an error state first. It becomes active
      // only after a usable encrypted refresh credential and sync-state row exist.
      const { data: connection, error: connectionError } = await db
        .from('email_connections')
        .upsert({
          user_id: stateRow.user_id,
          provider: 'gmail',
          provider_account_id: profile.emailAddress,
          email_address: profile.emailAddress,
          status: 'error',
          connected_at: now,
          updated_at: now,
        }, { onConflict: 'user_id,provider,email_address' })
        .select('id')
        .single();
      if (connectionError || !connection?.id) {
        throw new Error(`Failed to save Gmail connection: ${connectionError?.message ?? 'missing connection'}`);
      }

      const credentialCrypto = new ProviderCredentialCrypto(
        runtimeConfig.credentialKeyBase64,
      );
      if (token.refreshToken) {
        await saveGmailRefreshCredential({
          db,
          crypto: credentialCrypto,
          userId: stateRow.user_id,
          emailConnectionId: connection.id,
          refreshToken: token.refreshToken,
          scopes: token.scopes,
        });
      } else {
        // Google can omit a refresh token on a reconnect. Reuse only an already
        // valid encrypted credential for this exact user + connection.
        await loadGmailRefreshCredential({
          db,
          crypto: credentialCrypto,
          userId: stateRow.user_id,
          emailConnectionId: connection.id,
        });
      }

      await ensureGmailSyncState({
        db,
        userId: stateRow.user_id,
        emailConnectionId: connection.id,
      });

      const { error: activateError } = await db
        .from('email_connections')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', connection.id)
        .eq('user_id', stateRow.user_id)
        .eq('provider', 'gmail');
      if (activateError) {
        throw new Error(`Failed to activate Gmail connection: ${activateError.message}`);
      }

      return reply.redirect(successUrl);
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Direct Gmail connection callback failed');
      return reply.redirect(errorUrl);
    }
  });
}
