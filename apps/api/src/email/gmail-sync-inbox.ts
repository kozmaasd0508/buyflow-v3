import { env } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { runDirectGmailIncrementalSync } from './gmail-direct-sync.js';
import type { GmailRuntimeDb } from './gmail-runtime-state.js';

interface GmailSyncInboxRow {
  id: string;
  user_id: string;
  email_connection_id: string;
  history_id: string;
  status: string;
  attempts: number;
}

export interface GmailSyncInboxProcessResult {
  claimed: boolean;
  resetRequired?: boolean;
  cursorCommitted?: boolean;
  observed?: number;
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && error.name
    ? error.name.slice(0, 80)
    : 'UnknownError';
}

export async function enqueueGmailHistoryEvent(input: {
  db?: GmailRuntimeDb;
  emailAddress: string;
  historyId: string;
}): Promise<number> {
  const db = input.db ?? (getSupabaseAdmin() as any);
  const { data, error } = await db.rpc('enqueue_gmail_history_event', {
    p_email_address: input.emailAddress,
    p_history_id: input.historyId,
  });
  if (error) {
    throw new Error(`Gmail sync inbox enqueue failed: ${error.message ?? 'unknown database error'}`);
  }
  const count = Number(data);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Gmail sync inbox enqueue returned invalid count');
  }
  return count;
}

export async function processGmailSyncInboxEvent(
  eventId: string,
  dbOverride?: GmailRuntimeDb,
): Promise<GmailSyncInboxProcessResult> {
  if (!env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) return { claimed: false };
  const db = dbOverride ?? (getSupabaseAdmin() as any);
  const { data: claimed, error: claimError } = await db.rpc('claim_gmail_sync_inbox_event', {
    p_id: eventId,
  });
  if (claimError) {
    throw new Error(`Gmail sync inbox claim failed: ${claimError.message ?? 'unknown database error'}`);
  }
  if (claimed !== true) return { claimed: false };

  const { data, error: rowError } = await db
    .from('gmail_sync_inbox')
    .select('id,user_id,email_connection_id,history_id,status,attempts')
    .eq('id', eventId)
    .single();
  if (rowError || !data) {
    await db.rpc('finish_gmail_sync_inbox_event', {
      p_id: eventId,
      p_success: false,
      p_error_code: 'InboxReadError',
    });
    throw new Error(`Gmail sync inbox read failed: ${rowError?.message ?? 'missing row'}`);
  }
  const row = data as GmailSyncInboxRow;

  try {
    // The notification historyId is a durable wake-up identity only. The worker
    // always resumes from the last DB-committed cursor and Gmail history.list
    // decides the exact change range. Pub/Sub therefore has no email/Purchase
    // evidence authority of its own.
    const summary = await runDirectGmailIncrementalSync({
      db,
      userId: row.user_id,
      emailConnectionId: row.email_connection_id,
    });
    const { error: finishError } = await db.rpc('finish_gmail_sync_inbox_event', {
      p_id: eventId,
      p_success: true,
      p_error_code: null,
    });
    if (finishError) {
      throw new Error(`Gmail sync inbox completion failed: ${finishError.message ?? 'unknown database error'}`);
    }
    return {
      claimed: true,
      resetRequired: summary.resetRequired,
      cursorCommitted: summary.cursorCommitted,
      observed: summary.observed,
    };
  } catch (error) {
    await db.rpc('finish_gmail_sync_inbox_event', {
      p_id: eventId,
      p_success: false,
      p_error_code: safeErrorCode(error),
    });
    throw error;
  }
}

export async function drainGmailSyncInbox(
  limit = 10,
  dbOverride?: GmailRuntimeDb,
): Promise<{ scanned: number; claimed: number; failed: number }> {
  if (!env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) {
    return { scanned: 0, claimed: 0, failed: 0 };
  }
  const db = dbOverride ?? (getSupabaseAdmin() as any);
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await db
    .from('gmail_sync_inbox')
    .select('id,status,next_attempt_at,locked_at')
    .in('status', ['pending', 'retry', 'processing'])
    .or(`and(status.in.(pending,retry),next_attempt_at.lte.${now}),and(status.eq.processing,locked_at.lt.${staleCutoff})`)
    .order('next_attempt_at', { ascending: true })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 100));
  if (error) {
    throw new Error(`Gmail sync inbox recovery scan failed: ${error.message ?? 'unknown database error'}`);
  }

  const rows = (data ?? []) as Array<{ id: string }>;
  let claimed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await processGmailSyncInboxEvent(row.id, db);
      if (result.claimed) claimed += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: rows.length, claimed, failed };
}
