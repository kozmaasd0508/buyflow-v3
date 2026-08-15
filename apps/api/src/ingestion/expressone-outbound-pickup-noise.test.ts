import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { filterCommerceEmail, isExpressOneOutboundPickupNoise } from './commerce-email-filter.js';
import { parseDeterministicCommerceEmail } from './deterministic-commerce-parser.js';

function email(overrides: Partial<NormalizedEmail>): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: 'm1',
    receivedAt: '2026-08-15T10:00:00.000Z',
    from: [{ email: 'no-reply@expressone.hu' }],
    to: [],
    cc: [],
    bcc: [],
    folders: [],
    attachments: [],
    ...overrides,
  };
}

test('ignores an Express One WEBCAS outbound pickup booking confirmation', () => {
  const message = email({
    subject: 'Expressone értesítés #771023',
    snippet: 'Köszönjük megrendelését, amelyet rendszerünkben rögzítettünk a #771023 azonosító alatt. Az árufelvétel munkaidőben történhet.',
    bodyHtml: '<p>Az árufelvétel munkaidőben történhet.</p><a href="https://webcas.expressone.hu/request_curier">Online rögzítő</a>',
  });

  assert.equal(isExpressOneOutboundPickupNoise(message), true);
  const filtered = filterCommerceEmail(message);
  assert.equal(filtered.relevant, false);
  assert.ok(filtered.reasons.includes('excluded_expressone_outbound_pickup_service'));

  const parsed = parseDeterministicCommerceEmail({
    senderDomains: ['expressone.hu'],
    subject: message.subject,
    bodyText: message.snippet,
  });
  assert.equal(parsed, null);
});

test('ignores the paired Express One pickup status update', () => {
  const message = email({
    subject: 'Expressone értesítés',
    snippet: 'Az "771023" azonosítóval rögzített árufelvétel státusza megváltozott: a megbízást a futár elfogadta.',
  });

  assert.equal(isExpressOneOutboundPickupNoise(message), true);
  assert.equal(filterCommerceEmail(message).relevant, false);
});

test('keeps a real incoming Express One parcel email in commerce processing', () => {
  const message = email({
    subject: 'Küldemény kézbesítve',
    snippet: 'A küldeményt sikeresen kézbesítettük. Csomagszám: 12345678901234',
  });

  assert.equal(isExpressOneOutboundPickupNoise(message), false);
  const filtered = filterCommerceEmail(message);
  assert.equal(filtered.relevant, true);
  assert.ok(filtered.reasons.includes('known_carrier_sender'));
});

test('does not exclude a merchant merely for mentioning pickup wording', () => {
  const message = email({
    from: [{ email: 'orders@example-shop.hu' }],
    subject: 'Rendelés visszaigazolás',
    snippet: 'Az árufelvétel a boltban is kérhető. Rendelésszám: SHOP-1234',
  });

  assert.equal(isExpressOneOutboundPickupNoise(message), false);
  assert.equal(filterCommerceEmail(message).relevant, true);
});
