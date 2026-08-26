import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedEmail } from '../email/types.js';
import { parseGenericCommerceV5SubjectFallback } from './generic-commerce-v5-subject-fallback.js';

function email(subject: string, sender: string): NormalizedEmail {
  return {
    provider: 'mailgun',
    providerMessageId: `<${Math.random()}@example.com>`,
    subject,
    from: [{ email: sender }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-19T20:00:00.000Z',
    snippet: subject,
    folders: ['inbound', 'mailgun-shadow'],
    attachments: [],
  };
}

test('v5 fallback covers remaining v3 holdout lifecycle gaps', () => {
  const cases: Array<[NormalizedEmail, string]> = [
    [email('[Replit] Re: Refund request #503830', 'support@replit.com'), 'refund'],
    [email('Késik a kézbesítés – új ETA: 5 perc', 'ertesites@expressone.hu'), 'shipment'],
    [email('Értesítés a\u00a03408405568\u00a0számú csomag GLS Automatába helyezéséről', 'noreply@gls-hungary.com'), 'shipment'],
    [email('Értesítés a\u202f3408261506\u202fszámú csomag GLS Automatába helyezéséről', 'noreply@gls-hungary.com'), 'shipment'],
    [email('Értesítés a 3408294126 számú csomag GLS Automatába helyezéséről', 'noreply@gls-hungary.com'), 'shipment'],
    [email('❗️ Marketa.hu - 1140165 rendelés - Fontos Információ', 'hello@marketa.hu'), 'order_updated'],
  ];

  for (const [message, eventType] of cases) {
    const result = parseGenericCommerceV5SubjectFallback(message);
    assert.ok(result, message.subject ?? 'missing subject');
    assert.equal(result.extraction.event_type, eventType, message.subject ?? 'missing subject');
    assert.equal(result.parserVersion, 'generic-commerce-v5-shadow');
  }
});

test('v5 fallback keeps lookalike noise unmatched', () => {
  const cases = [
    email('Eljött a nyári pihenés ideje☀️ – fontos információ rendeléseidhez', 'info@oxygenihair.com'),
    email('Átvételi értesítő (Feladó: NAV, Dokumentum: Elfogadó nyugta)', 'ertesites@tarhely.gov.hu'),
    email('Fontos Információ az őszi akcióinkról', 'newsletter@example.com'),
    email('Új csomagautomata nyílt a közeledben!', 'promo@courier.example'),
  ];

  for (const message of cases) {
    assert.equal(parseGenericCommerceV5SubjectFallback(message), null, message.subject ?? 'missing subject');
  }
});
