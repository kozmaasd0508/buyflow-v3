import assert from 'node:assert/strict';
import test from 'node:test';
import { processCommerceMessage } from './process-commerce-message.js';

function harness(match: string | null, shadow = true) {
  const calls: string[] = [];
  const processed: any[] = [];
  const preprocess = (name: string) => async () => { calls.push(name); return { matched: name === match }; };
  const dependencies = {
    lifecycle: preprocess('lifecycle'), limone: preprocess('limone'), commerce: preprocess('commerce'),
    genericLifecycle: preprocess('generic'), shadowConfigured: () => shadow,
    guard: async () => { calls.push('guard'); return { guarded: true, sourceEmailId: 'source-1' }; },
    process: async (input: any) => {
      processed.push(input);
      return { ok: true, status: 'review' as const, sourceEmailId: 'source-1',
        purchaseWrites: 0, shipmentWrites: 0, documentWrites: 0, aiCalls: input.allowAiObservation ? 1 : 0 };
    },
  };
  return { calls, processed, dependencies };
}

test('webhook, initial and targeted routes use identical parser order and shadow authority', async () => {
  for (const match of [null, 'generic', 'commerce', 'lifecycle']) {
    const traces: unknown[] = [];
    for (const sourceQuery of ['webhook:message.created', 'scan:initial', 'scan:targeted', 'scan:targeted-lifecycle']) {
      const h = harness(match);
      await processCommerceMessage({ grantId: 'g', messageId: 'm', sourceQuery, mode: 'write' }, h.dependencies);
      traces.push({ calls: h.calls, processed: h.processed });
      assert.equal(h.processed[0].mode, match === null ? 'observe' : 'write');
    }
    for (const trace of traces) assert.deepEqual(trace, traces[0]);
  }
});

test('disabled AI stays in review for unknown mail while deterministic mail still processes', async () => {
  const input = { grantId: 'g', messageId: 'm', sourceQuery: 'scan:initial', mode: 'write' as const };
  const unknown = harness(null, false);
  assert.equal((await processCommerceMessage(input, unknown.dependencies)).aiCalls, 0);
  assert.equal(unknown.processed.length, 0);
  assert.equal(unknown.calls.at(-1), 'guard');
  const known = harness('commerce', false);
  await processCommerceMessage(input, known.dependencies);
  assert.equal(known.processed[0].mode, 'write');
  assert.equal(known.calls.includes('guard'), false);
});

test('observe mode never becomes write mode even for recognized messages', async () => {
  const h = harness('lifecycle');
  await processCommerceMessage({ grantId: 'g', messageId: 'm', sourceQuery: 'scan:initial', mode: 'observe' }, h.dependencies);
  assert.equal(h.processed[0].mode, 'observe');
});
