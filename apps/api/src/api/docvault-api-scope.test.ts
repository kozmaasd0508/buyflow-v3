import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routesUrl = new URL('./app-routes.ts', import.meta.url);
const routes = readFileSync(routesUrl, 'utf8');

test('DocVault document reads are explicitly scoped to the authenticated user', () => {
  const documentQueries = routes.match(/\.from\('documents'\)[\s\S]*?\.order\('created_at', \{ ascending: false \}\)/g) ?? [];
  assert.equal(documentQueries.length, 2);
  for (const query of documentQueries) {
    assert.match(query, /\.eq\('user_id', user\.id\)/);
  }
});

test('DocVault signed links remain short-lived and are created only after user-scoped Purchase lookup', () => {
  assert.match(routes, /\.eq\('id', purchaseId\)\s*\.eq\('user_id', user\.id\)/);
  assert.match(routes, /createSignedUrl\(access\.storagePath!, DOCUMENT_SIGNED_URL_TTL_SECONDS\)/);
  assert.match(routes, /Cache-Control', 'no-store'/);
});
