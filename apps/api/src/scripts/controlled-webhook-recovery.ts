import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { drainWebhookInbox } from '../webhooks/webhook-inbox.js';

const TEST_SUBJECT = 'BuyFlow teszt rendelés #BFTEST-003';

async function countTable(db: any, table: string): Promise<number> {
  const { count, error } = await db.from(table).select('id', { count: 'exact', head: true });
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;

  const { data: source, error: sourceError } = await db
    .from('source_emails')
    .select('id,provider_message_id,processing_status,validated_result')
    .eq('subject', TEST_SUBJECT)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sourceError || !source) {
    throw new Error(`Controlled recovery source email missing: ${sourceError?.message ?? 'not found'}`);
  }
  if (!source.validated_result) {
    throw new Error('Controlled recovery source is not already validated');
  }

  const { data: inbox, error: inboxError } = await db
    .from('webhook_inbox')
    .select('id,status,attempts,last_error_code,processed_at')
    .eq('provider', 'nylas')
    .eq('event_type', 'message.created')
    .eq('provider_message_id', source.provider_message_id)
    .limit(1)
    .maybeSingle();
  if (inboxError || !inbox) {
    throw new Error(`Controlled recovery inbox event missing: ${inboxError?.message ?? 'not found'}`);
  }
  if (inbox.status !== 'processed') {
    throw new Error(`Controlled recovery requires a processed test event, got ${inbox.status}`);
  }

  const [purchasesBefore, shipmentsBefore, documentsBefore] = await Promise.all([
    countTable(db, 'purchases'),
    countTable(db, 'shipments'),
    countTable(db, 'documents'),
  ]);

  const { count: aiRunsBefore, error: aiBeforeError } = await db
    .from('ai_processing_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source_email_id', source.id);
  if (aiBeforeError) throw new Error(`Failed to count AI runs before recovery: ${aiBeforeError.message}`);

  // Simulate one failed processing attempt using the same production RPC that real failures use.
  const { error: failError } = await db.rpc('finish_webhook_inbox_event', {
    p_id: inbox.id,
    p_success: false,
    p_error_code: 'ControlledRecoveryTest',
  });
  if (failError) throw new Error(`Failed to simulate retry state: ${failError.message}`);

  const { data: retryRow, error: retryReadError } = await db
    .from('webhook_inbox')
    .select('status,attempts,last_error_code,next_attempt_at')
    .eq('id', inbox.id)
    .single();
  if (retryReadError) throw new Error(`Failed to verify retry state: ${retryReadError.message}`);
  if (retryRow.status !== 'retry' || retryRow.last_error_code !== 'ControlledRecoveryTest') {
    throw new Error('Controlled recovery event did not enter retry state');
  }

  // Bring the retry time forward only for this controlled test so we do not need to wait a full minute.
  const { error: advanceError } = await db
    .from('webhook_inbox')
    .update({ next_attempt_at: new Date().toISOString() })
    .eq('id', inbox.id)
    .eq('status', 'retry');
  if (advanceError) throw new Error(`Failed to advance controlled retry time: ${advanceError.message}`);

  const drained = await drainWebhookInbox('write', 20);

  const { data: after, error: afterError } = await db
    .from('webhook_inbox')
    .select('status,attempts,last_error_code,processed_at')
    .eq('id', inbox.id)
    .single();
  if (afterError) throw new Error(`Failed to verify recovery completion: ${afterError.message}`);

  const [purchasesAfter, shipmentsAfter, documentsAfter] = await Promise.all([
    countTable(db, 'purchases'),
    countTable(db, 'shipments'),
    countTable(db, 'documents'),
  ]);

  const { count: aiRunsAfter, error: aiAfterError } = await db
    .from('ai_processing_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source_email_id', source.id);
  if (aiAfterError) throw new Error(`Failed to count AI runs after recovery: ${aiAfterError.message}`);

  if (after.status !== 'processed' || after.last_error_code !== null) {
    throw new Error('Controlled recovery event did not return to processed state');
  }
  if (after.attempts !== inbox.attempts + 1) {
    throw new Error('Controlled recovery attempt counter did not increment exactly once');
  }
  if (purchasesAfter !== purchasesBefore || shipmentsAfter !== shipmentsBefore || documentsAfter !== documentsBefore) {
    throw new Error('Controlled recovery created duplicate domain records');
  }
  if ((aiRunsAfter ?? 0) !== (aiRunsBefore ?? 0)) {
    throw new Error('Controlled recovery repeated AI extraction unnecessarily');
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'controlled_webhook_recovery',
    simulatedFailure: true,
    retryStateVerified: true,
    recoveryProcessed: true,
    attemptsBefore: inbox.attempts,
    attemptsAfter: after.attempts,
    aiCallsRepeated: false,
    duplicatePurchaseWrites: 0,
    duplicateShipmentWrites: 0,
    duplicateDocumentWrites: 0,
    drainScanned: drained.scanned,
    drainClaimed: drained.claimed,
    drainFailed: drained.failed,
    publicLogContainsIdentifiers: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(
    'Controlled webhook recovery test failed:',
    error instanceof Error ? error.message.replace(/[0-9a-f-]{20,}/gi, '[redacted]') : 'UnknownError',
  );
  process.exit(1);
});
