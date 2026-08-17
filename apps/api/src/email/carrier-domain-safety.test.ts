import assert from 'node:assert/strict';
import test from 'node:test';
import { carrierNameForSenderDomain, isCarrierSenderDomain } from './sender-role.js';

test('trusted carrier domains and their real subdomains remain recognized', () => {
  assert.equal(carrierNameForSenderDomain('email.gls-hungary.com'), 'GLS');
  assert.equal(carrierNameForSenderDomain('notify.expressone.hu'), 'Express One');
  assert.equal(carrierNameForSenderDomain('mail.dpd.com'), 'DPD');
  assert.equal(carrierNameForSenderDomain('notify.dhl.com'), 'DHL');
  assert.equal(carrierNameForSenderDomain('ups.com'), 'UPS');
  assert.equal(isCarrierSenderDomain('posta.hu'), true);
  assert.equal(carrierNameForSenderDomain('noreply.xlsfutar.hu'), 'XLS Futár');
});

test('carrier brand tokens inside unrelated domains never establish carrier identity', () => {
  for (const domain of [
    'gls-security.example',
    'dpd-login.example',
    'expressone-support.example',
    'foxpost-pay.example',
    'xlsfutar.hu.attacker.example',
    'notify.dhl.com.attacker.example',
    'ups.com.attacker.example',
    'email.gls-hungary.com.attacker.example',
  ]) {
    assert.equal(isCarrierSenderDomain(domain), false, domain);
    assert.equal(carrierNameForSenderDomain(domain), null, domain);
  }
});
