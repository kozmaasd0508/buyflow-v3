import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOCUMENT_SIGNED_URL_TTL_SECONDS,
  isDocumentId,
  isPrivateStoredPdf,
} from './document-access.js';

test('document ids require canonical UUID shape', () => {
  assert.equal(isDocumentId('52f22f74-460b-4cbe-a975-caedb25b6463'), true);
  assert.equal(isDocumentId('../secret'), false);
  assert.equal(isDocumentId('not-a-uuid'), false);
});

test('only private stored PDF attachments are signable', () => {
  assert.equal(isPrivateStoredPdf({
    sourceType: 'email_attachment',
    mimeType: 'application/pdf',
    storageBucket: 'buyflow-purchase-documents',
    storagePath: 'user/source/file.pdf',
  }), true);

  assert.equal(isPrivateStoredPdf({
    sourceType: 'email_body',
    mimeType: 'application/pdf',
    storageBucket: 'buyflow-purchase-documents',
    storagePath: 'user/source/file.pdf',
  }), false);

  assert.equal(isPrivateStoredPdf({
    sourceType: 'email_attachment',
    mimeType: 'image/png',
    storageBucket: 'buyflow-purchase-documents',
    storagePath: 'user/source/file.png',
  }), false);
});

test('signed document URLs are intentionally short lived', () => {
  assert.equal(DOCUMENT_SIGNED_URL_TTL_SECONDS, 60);
});

test('signing requires the fixed bucket and canonical path under the authenticated owner', async () => {
  const { canSignStoredPdf } = await import('./document-access.js');
  const user='52f22f74-460b-4cbe-a975-caedb25b6463';
  const source='62f22f74-460b-4cbe-a975-caedb25b6463';
  const file='a'.repeat(40)+'.pdf';
  const document={sourceType:'email_attachment',mimeType:'application/pdf',
    storageBucket:'buyflow-purchase-documents',storagePath:`${user}/${source}/${file}`};
  assert.equal(canSignStoredPdf(document,user),true);
  assert.equal(canSignStoredPdf(document,source),false);
  assert.equal(canSignStoredPdf({...document,storageBucket:'other-private-bucket'},user),false);
  for(const path of [`${user}/../${file}`,`${user}/${source}/../../${file}`,
    `${user}/${source}/%2e%2e%2ffile.pdf`,`${user}suffix/${source}/${file}`,
    `${user}\\${source}\\${file}`,`/${user}/${source}/${file}`,`${document.storagePath}?download=1`]) {
    assert.equal(canSignStoredPdf({...document,storagePath:path},user),false,path);
  }
});
