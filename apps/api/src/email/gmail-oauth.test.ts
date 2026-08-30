import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GMAIL_READONLY_SCOPE,
  GoogleGmailOAuthClient,
  createGmailPkcePair,
} from './gmail-oauth.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Gmail OAuth authorize URL uses least-privilege readonly scope and PKCE', () => {
  const client = new GoogleGmailOAuthClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://api.example.com/auth/google/gmail/callback',
  });
  const pkce = createGmailPkcePair();
  const url = new URL(client.buildAuthorizeUrl({ state: 'state-1', codeChallenge: pkce.challenge }));

  assert.equal(url.searchParams.get('scope'), GMAIL_READONLY_SCOPE);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), pkce.challenge);
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.ok(pkce.verifier.length >= 43);
});

test('Gmail OAuth code exchange sends PKCE verifier server-to-server', async () => {
  let requestBody = '';
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body ?? '');
    return jsonResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      scope: GMAIL_READONLY_SCOPE,
      token_type: 'Bearer',
    });
  }) as typeof fetch;
  const client = new GoogleGmailOAuthClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://api.example.com/auth/google/gmail/callback',
    fetchImpl,
  });
  const token = await client.exchangeCode({ code: 'code-1', codeVerifier: 'verifier-1' });
  const params = new URLSearchParams(requestBody);

  assert.equal(params.get('code_verifier'), 'verifier-1');
  assert.equal(params.get('client_secret'), 'client-secret');
  assert.equal(token.accessToken, 'access-1');
  assert.equal(token.refreshToken, 'refresh-1');
  assert.deepEqual(token.scopes, [GMAIL_READONLY_SCOPE]);
});

test('Gmail OAuth refresh and profile lookup keep credentials out of URLs', async () => {
  const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get('Authorization'),
      body: String(init?.body ?? ''),
    });
    if (url.includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'fresh-access', expires_in: 1800, token_type: 'Bearer' });
    }
    if (url.endsWith('/users/me/profile')) {
      return jsonResponse({ emailAddress: 'Buyer@Example.com', historyId: '12345' });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  const client = new GoogleGmailOAuthClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://api.example.com/auth/google/gmail/callback',
    fetchImpl,
  });

  const refreshed = await client.refreshAccessToken('refresh-secret');
  const profile = await client.getGmailProfile(refreshed.accessToken);

  assert.equal(refreshed.accessToken, 'fresh-access');
  assert.equal(profile.emailAddress, 'buyer@example.com');
  assert.equal(profile.historyId, '12345');
  assert.ok(calls.every((call) => !call.url.includes('refresh-secret')));
  assert.equal(calls.at(-1)?.authorization, 'Bearer fresh-access');
  assert.match(calls[0]?.body ?? '', /refresh_token=refresh-secret/);
});
