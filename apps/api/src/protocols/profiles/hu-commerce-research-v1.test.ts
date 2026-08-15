import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProtocolEvidence } from '../detect.js';
import { validateProtocolProfile } from '../profile-validator.js';
import { UNAS_RESEARCH_V1 } from './unas-research-v1.js';
import {
  SHOPRENTER_NOTIFICATION_RESEARCH_V1,
  SHOPRENTER_RESEARCH_V1,
  SHOPRENTER_STRUCTURAL_SIGNALS_V1,
} from './shoprenter-research-v1.js';

test('UNAS stays research-only until rendered email fingerprints are verified', () => {
  assert.equal(UNAS_RESEARCH_V1.status, 'research');
  assert.equal(UNAS_RESEARCH_V1.executable_raw_email_profile, false);
  assert.ok(UNAS_RESEARCH_V1.structural_signals.some((row) => row.name === '[order_key]'));
  assert.ok(UNAS_RESEARCH_V1.structural_signals.some((row) => row.name === '[order_package_number]'));
});

test('UNAS status and package signals never guess physical lifecycle globally', () => {
  const status = UNAS_RESEARCH_V1.events.find((entry) => entry.source_event === 'order status change notification');
  const packageRow = UNAS_RESEARCH_V1.events.find((entry) => entry.source_event.includes('package number'));
  assert.equal(status?.event_candidate, 'OTHER');
  assert.ok(status?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(packageRow?.event_candidate, 'OTHER');
  assert.ok(packageRow?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(packageRow?.prohibitions.includes('DO_NOT_MARK_IN_TRANSIT'));
});

test('Shoprenter shared fallback sender creates protocol evidence only', () => {
  assert.deepEqual(validateProtocolProfile(SHOPRENTER_RESEARCH_V1), []);
  const [evidence] = detectProtocolEvidence({
    senderDomains: ['myshoprenter.hu'],
    senderAddresses: ['order@myshoprenter.hu'],
    subject: 'Webshop notification',
  }, [SHOPRENTER_RESEARCH_V1]);
  assert.ok(evidence);
  assert.equal(evidence.event_candidate, 'OTHER');
  assert.equal(evidence.production_eligible, false);
  assert.deepEqual(evidence.prohibitions, ['DO_NOT_CREATE_PURCHASE', 'DO_NOT_AUTO_LINK']);
});

test('merchant-owned sender is not identified as Shoprenter by generic order wording', () => {
  assert.deepEqual(detectProtocolEvidence({
    senderDomains: ['merchant.example'],
    senderAddresses: ['orders@merchant.example'],
    subject: 'Rendelés visszaigazolás',
    bodyText: 'Köszönjük rendelését.',
  }, [SHOPRENTER_RESEARCH_V1]), []);
});

test('Shoprenter status and tracking tags remain identity/evidence only', () => {
  const status = SHOPRENTER_NOTIFICATION_RESEARCH_V1.find((entry) => entry.source_event === 'Rendelés állapot váltás automatic email');
  const tracking = SHOPRENTER_NOTIFICATION_RESEARCH_V1.find((entry) => entry.source_event.includes('tracking link'));
  assert.equal(status?.event_candidate, 'OTHER');
  assert.ok(status?.prohibitions.includes('DO_NOT_MARK_DELIVERED'));
  assert.equal(tracking?.event_candidate, 'OTHER');
  assert.ok(tracking?.prohibitions.includes('DO_NOT_SET_SHIPPED_AT'));
  assert.ok(SHOPRENTER_STRUCTURAL_SIGNALS_V1.some((entry) => entry.tag === '[SHOPRENTER_GO_TRACKING_LINK]'));
});

test('Shoprenter payment description is not payment success evidence', () => {
  const row = SHOPRENTER_NOTIFICATION_RESEARCH_V1.find((entry) => entry.source_event.includes('payment description'));
  assert.equal(row?.event_candidate, 'OTHER');
});
