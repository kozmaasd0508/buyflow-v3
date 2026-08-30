import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { GooglePubSubOidcVerifier } from './google-pubsub-oidc.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const kid = 'test-key-1';
const audience = 'https://api.example.com/webhooks/google/gmail';
const serviceAccountEmail = 'pubsub-push@example-project.iam.gserviceaccount.com';
const nowMs = Date.parse('2026-08-30T22:00:00.000Z');

function jwt(overrides: Record<string, unknown> = {}, signingKey = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com',
    aud: audience,
    sub: '123456789',
    email: serviceAccountEmail,
    email_verified: true,
    iat: Math.floor(nowMs / 1000) - 30,
    exp: Math.floor(nowMs / 1000) + 300,
    ...overrides,
  })).toString('base64url');
  const input = `${header}.${claims}`;
  const signature = sign('RSA-SHA256', Buffer.from(input, 'ascii'), signingKey).toString('base64url');
  return `${input}.${signature}`;
}

function verifier() {
  let fetches = 0;
  const fetchImpl = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({
      keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }],
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=3600',
      },
    });
  }) as typeof fetch;
  return {
    instance: new GooglePubSubOidcVerifier({
      audience,
      serviceAccountEmail,
      fetchImpl,
      now: () => nowMs,
    }),
    fetches: () => fetches,
  };
}

test('verifies signed Google Pub/Sub OIDC identity and caches signing keys', async () => {
  const subject = verifier();
  const first = await subject.instance.verifyAuthorizationHeader(`Bearer ${jwt()}`);
  const second = await subject.instance.verifyAuthorizationHeader(`Bearer ${jwt({ sub: '987654321' })}`);

  assert.equal(first.email, serviceAccountEmail);
  assert.equal(first.audience, audience);
  assert.equal(second.subject, '987654321');
  assert.equal(subject.fetches(), 1);
});

test('rejects a Pub/Sub token for the wrong audience', async () => {
  const subject = verifier();
  await assert.rejects(
    () => subject.instance.verifyAuthorizationHeader(`Bearer ${jwt({ aud: 'https://evil.example' })}`),
    /audience is invalid/,
  );
});

test('rejects a Pub/Sub token for an unexpected service account', async () => {
  const subject = verifier();
  await assert.rejects(
    () => subject.instance.verifyAuthorizationHeader(`Bearer ${jwt({ email: 'other@example.com' })}`),
    /service account identity is invalid/,
  );
});

test('rejects an expired Pub/Sub token', async () => {
  const subject = verifier();
  await assert.rejects(
    () => subject.instance.verifyAuthorizationHeader(`Bearer ${jwt({ exp: Math.floor(nowMs / 1000) - 120 })}`),
    /token is expired/,
  );
});

test('rejects a token with a forged signature', async () => {
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const subject = verifier();
  await assert.rejects(
    () => subject.instance.verifyAuthorizationHeader(`Bearer ${jwt({}, attacker)}`),
    /signature is invalid/,
  );
});
