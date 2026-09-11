import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileUser } from './automatic-email-pipeline.js';
import { asAiObservation, automaticValidationStatus, isTrustedAutomaticEvidence } from './automatic-write-gate.js';

const legacyAi = {
  schema_version: 2, event_type: 'order_created', original_event_type: 'order_created',
  validation_status: 'validated', merchant: 'Example Shop', order_number: 'ORDER-1',
  confidence: 0.99, products: [], eligible_for_purchase_creation: true,
};

function database(results: Record<string, unknown>[]) {
  const calls: Array<{ name: string; args: any }> = [];
  const sources = results.map((result, index) => ({
    id: `source-${index}`, user_id: 'user-1', provider_message_id: `mail-${index}`,
    from_address: 'orders@shop.example', received_at: new Date().toISOString(),
    processing_status: 'review', validation_status: result.validation_status,
    structured_result: result, validated_result: JSON.parse(JSON.stringify(result)),
  }));
  const db = {
    from(table: string) {
      const response = { data: table === 'source_emails' ? sources : [], error: null };
      const query: any = { then: (resolve: any) => Promise.resolve(response).then(resolve) };
      for (const method of ['select', 'eq', 'not', 'gte', 'order', 'limit']) query[method] = () => query;
      return query;
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      return { data: 'purchase-1', error: null };
    },
  };
  return { db, calls };
}

test('persisted and legacy AI observations cannot create purchases on a later write pass', async () => {
  for (const observation of [legacyAi, asAiObservation(legacyAi)]) {
    const { db, calls } = database([observation]);
    await reconcileUser('user-1', 'observe', db);
    await reconcileUser('user-1', 'write', db);
    await reconcileUser('user-1', 'write', db);
    assert.deepEqual(calls, []);
    assert.equal(automaticValidationStatus('validated', observation), 'review');
  }
});

test('a later deterministic order writes only its own evidence, never the saved AI order', async () => {
  const deterministic = { ...legacyAi, extraction_source: 'deterministic', parser_version: 'deterministic-commerce-v2' };
  const { db, calls } = database([asAiObservation(legacyAi), deterministic]);
  await reconcileUser('user-1', 'write', db);
  const creation = calls.find(call => call.name === 'controlled_create_purchase_with_sources');
  assert.ok(creation);
  assert.deepEqual(creation.args.p_sources.map((source: any) => source.source_email_id), ['source-1']);
});

test('shadow authority survives serialization and conflicting trusted status labels', () => {
  for (const marker of [{ shadow_only: true }, { would_write: false }, { extraction_source: 'ai_shadow' }]) {
    const result = JSON.parse(JSON.stringify({ ...legacyAi, parser_version: 'future-parser-v1', ...marker }));
    assert.equal(isTrustedAutomaticEvidence('validated', result), false);
  }
  const observation = asAiObservation(legacyAi);
  assert.equal(observation.semantic_validation_status, 'validated');
  assert.equal(observation.validation_status, 'review');
  assert.equal(observation.eligible_for_purchase_creation, false);
});
