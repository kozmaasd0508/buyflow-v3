import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderCredentialCrypto } from './provider-credential-crypto.js';

const key = Buffer.alloc(32, 7).toString('base64');
const context = {
  userId: '11111111-1111-4111-8111-111111111111',
  emailConnectionId: '22222222-2222-4222-8222-222222222222',
  provider: 'gmail' as const,
};

test('provider credential encryption round-trips without storing plaintext', () => {
  const crypto = new ProviderCredentialCrypto(key);
  const encrypted = crypto.encrypt('refresh-token-secret', context);

  assert.notEqual(encrypted.ciphertext, 'refresh-token-secret');
  assert.equal(encrypted.keyVersion, 1);
  assert.equal(crypto.decrypt(encrypted, context), 'refresh-token-secret');
});

test('provider credential encryption is bound to user and connection context', () => {
  const crypto = new ProviderCredentialCrypto(key);
  const encrypted = crypto.encrypt('refresh-token-secret', context);

  assert.throws(() => crypto.decrypt(encrypted, {
    ...context,
    emailConnectionId: '33333333-3333-4333-8333-333333333333',
  }), /could not be decrypted/);
});

test('tampered provider credential fails closed', () => {
  const crypto = new ProviderCredentialCrypto(key);
  const encrypted = crypto.encrypt('refresh-token-secret', context);
  const bytes = Buffer.from(encrypted.ciphertext, 'base64');
  bytes[0] = (bytes[0] ?? 0) ^ 1;

  assert.throws(() => crypto.decrypt({
    ...encrypted,
    ciphertext: bytes.toString('base64'),
  }, context), /could not be decrypted/);
});

test('credential encryption requires an exact 32-byte key', () => {
  assert.throws(
    () => new ProviderCredentialCrypto(Buffer.alloc(16).toString('base64')),
    /exactly 32 bytes/,
  );
});
