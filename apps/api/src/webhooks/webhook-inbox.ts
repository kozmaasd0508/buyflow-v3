import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { enqueueAutomaticTargetedRecoveryForSource } from '../ingestion/automatic-targeted-recovery.js';
import {
  decideGmailPurchasesGate,
  isMessageInGmailPurchases,
} from '../ingestion/gmail-purchases-gate.js';
import {
  processNylasMessage,
  type AutomaticPipelineResult,
  type AutomationMode,
} from '../pipeline/automatic-email-pipeline.js';

interface WebhookInboxRow {
  id: string;
  provider: string;
  event_type: string;
  grant_id: string;
  provider_message_id: string;
  status: string;
  attempts: number;
}

export interface WebhookInboxProcessResult {
  claimed: boolean;
  pipeline?: AutomaticPipelineResult;
  purchaseGate?: 'passed' | 'retry' | 'filtered';
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 80) : 'UnknownError';
}

export async function enqueueNylasMessageEvent(input: {
  grantId: string;
  messageId: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;
  const { data, error } = await db.rpc('enqueue_nylas_message_event', {
    p_grant_id: input.grantId,
    p_provider_message_id: input.messageId,
  });

  if (error) {
    throw new Error(`Webhook inbox enqueue failed: ${error.message}`);
  }
  if (typeof data !== 'string' || !data) {
    throw new Error('Webhook inbox enqueue returned no event id');
  }
  return data;
}

export async function processWebhookInboxEvent(
  eventId: string,
  mode: AutomationMode,
): Promise<WebhookInboxProcessResult> {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;

  const { data: claimed, error: claimError } = await db.rpc('claim_webhook_inbox_event', {
    p_id: eventId,
  });
  if (claimError) {
    throw new Error(`Webhook inbox claim failed: ${claimError.message}`);
  }
  if (claimed !== true) {
    return { claimed: false };
  }

  const { data: row, error: rowError } = await db
    .from('webhook_inbox')
    .select('id,provider,event_type,grant_id,provider_message_id,status,attempts')
    .eq('id', eventId)
    .single();
  if (rowError || !row) {
    await db.rpc('finish_webhook_inbox_event', {
      p_id: eventId,
      p_success: false,
      p_error_code: 'InboxReadError',
    });
    throw new Error(`Webhook inbox read failed: ${rowError?.message ?? 'missing row'}`);
  }

  const event = row as WebhookInboxRow;
  if (event.provider !== 'nylas' || event.event_type !== 'message.created') {
    await db.rpc('finish_webhook_inbox_event', {
      p_id: eventId,
      p_success: true,
      p_error_code: null,
    });
    return { claimed: true };
  }

  try {
    const provider = createEmailProvider({
      provider: 'nylas',
      providerAccountId: event.grant_id,
    });
    const foundInPurchases = await isMessageInGmailPurchases(
      provider,
      event.provider_message_id,
    );
    const purchaseGate = decideGmailPurchasesGate(foundInPurchases, event.attempts);

    if (purchaseGate === 'retry') {
      const { error: retryError } = await db.rpc('finish_webhook_inbox_event', {
        p_id: eventId,
        p_success: false,
        p_error_code: 'PurchasesCategoryPending',
      });
      if (retryError) {
        throw new Error(`Webhook purchases gate retry scheduling failed: ${retryError.message}`);
      }
      return { claimed: true, purchaseGate: 'retry' };
    }

    if (purchaseGate === 'reject') {
      const { error: finishError } = await db.rpc('finish_webhook_inbox_event', {
        p_id: eventId,
        p_success: true,
        p_error_code: null,
      });
      if (finishError) {
        throw new Error(`Webhook purchases gate completion failed: ${finishError.message}`);
      }
      return { claimed: true, purchaseGate: 'filtered' };
    }

    const pipeline = await processNylasMessage({
      grantId: event.grant_id,
      messageId: event.provider_message_id,
      mode,
    });

    if (pipeline.status === 'unlinked' && pipeline.sourceEmailId) {
      await enqueueAutomaticTargetedRecoveryForSource(pipeline.sourceEmailId);
    }

    const { error: finishError } = await db.rpc('finish_webhook_inbox_event', {
      p_id: eventId,
      p_success: true,
      p_error_code: null,
    });
    if (finishError) {
      throw new Error(`Webhook inbox completion failed: ${finishError.message}`);
    }

    return { claimed: true, pipeline, purchaseGate: 'passed' };
  } catch (error) {
    await db.rpc('finish_webhook_inbox_event', {
      p_id: eventId,
      p_success: false,
      p_error_code: safeErrorCode(error),
    });
    throw error;
  }
}

export async function drainWebhookInbox(
  mode: AutomationMode,
  limit = 20,
): Promise<{ scanned: number; claimed: number; failed: number }> {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();

  const { data, error } = await db
    .from('webhook_inbox')
    .select('id,status,next_attempt_at,locked_at')
    .in('status', ['pending', 'retry', 'processing'])
    .or(`and(status.in.(pending,retry),next_attempt_at.lte.${now}),and(status.eq.processing,locked_at.lt.${staleCutoff})`)
    .order('next_attempt_at', { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(`Webhook inbox recovery scan failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ id: string }>;
  let claimed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await processWebhookInboxEvent(row.id, mode);
      if (result.claimed) claimed += 1;
    } catch {
      failed += 1;
    }
  }

  return { scanned: rows.length, claimed, failed };
}
