import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBearerToken } from './auth.js';

test('accepts a normal Bearer token', () => {
  assert.equal(parseBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
});

test('accepts Bearer case-insensitively and trims outer whitespace', () => {
  assert.equal(parseBearerToken('  bearer token-123  '), 'token-123');
});

test('rejects missing or malformed authorization headers', () => {
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken(''), null);
  assert.equal(parseBearerToken('Basic abc'), null);
  assert.equal(parseBearerToken('Bearer'), null);
  assert.equal(parseBearerToken('Bearer one two'), null);
});
