import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordResetPageHtml } from './reset-password-page.js';

test('password reset page requires a strong 12-character password', () => {
  const html = passwordResetPageHtml();
  assert.match(html, /minlength="12"/);
  assert.match(html, /maxlength="128"/);
  assert.match(html, /\[a-z\]/);
  assert.match(html, /\[A-Z\]/);
  assert.match(html, /\[0-9\]/);
  assert.match(html, /\[\^A-Za-z0-9\]/);
  assert.match(html, /Legalább 12 karakter/);
});

test('recovery token is removed from the visible URL before password submission', () => {
  const html = passwordResetPageHtml();
  const scrubIndex = html.indexOf("history.replaceState(null, '', location.pathname + location.search)");
  const submitIndex = html.indexOf("form.addEventListener('submit'");
  assert.ok(scrubIndex > 0, 'expected immediate recovery URL scrub');
  assert.ok(submitIndex > scrubIndex, 'URL scrub must happen before the user can submit a new password');
  assert.equal(html.match(/history\.replaceState/g)?.length, 1);
});

test('password reset page handles server-side weak-password rejection distinctly', () => {
  const html = passwordResetPageHtml();
  assert.match(html, /errorCode === 'weak_password'/);
  assert.match(html, /túl gyengének vagy ismertnek találta/);
});

test('password reset page is marked as non-indexable and does not expose recovery token in form markup', () => {
  const html = passwordResetPageHtml();
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.doesNotMatch(html, /name="access_token"/);
});
