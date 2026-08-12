import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import {
  processNylasMessage,
  type AutomationMode,
} from '../pipeline/automatic-email-pipeline.js';

interface EmailScanJobRow {
  id: string;
  user_id: string;
  email_connection_id: string;
  window_days: number;
  status: string;
}

interface EmailConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string | null;
  status: string;
}

export interface InitialEmailScanResult {
  checked: number;
  pages: number;
  ignored: number;
  review: number;
  processed: number;
  aiCalls: number;
  purchaseWrites: number;
  shipmentWrites: number;
  documentWrites: number;
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && error.name
    ? error.name.slice(0, 80)
    : 'UnknownError';
}

export async function enqueueInitialEmailScan(input: {
  userId: string;
  emailConnectionId: string;
  windowDays?: number;
}): Promise<string> {
  const db = getSupabaseAdmin() as any;
  const { data, error } = await db.rpc('enqueue_initial_email_scan', {
    p_user_id: input.userId,
    p_email_connection_id: input.emailConnectionId,
    p_window_days: input.windowDays ?? 7,
  });

  if (error) {
    throw new Error(`Initial email scan enqueue failed: ${error.message}`);
  }
  if (typeof data !== 'string' || !data) {
    throw new Error('Initial email scan enqueue returned no job id');
  }
  return data;
}

export async function processEmailScanJob(
  jobId: string,
  mode: AutomationMode,
): Promise<{ claimed: boolean; result?: InitialEmailScanResult }> {
  const db = getSupabaseAdmin() as any;
  const { data: claimed, error: claimError } = await db.rpc('claim_email_scan_job', {
    p_id: jobId,
  });
  if (claimError) throw new Error(`Email scan claim failed: ${claimError.message}`);
  if (claimed !== true) return { claimed: false };

  try {
    const { data: job, error: jobError } = await db
      .from('email_scan_jobs')
      .select('id,user_id,email_connection_id,window_days,status')
      .eq('id', jobId)
      .single();
    if (jobError || !job) {
      throw new Error(`Email scan job read failed: ${jobError?.message ?? 'missing job'}`);
    }

    const scanJob = job as EmailScanJobRow;
    const { data: connection, error: connectionError } = await db
      .from('email_connections')
      .select('id,user_id,provider,provider_account_id,status')
      .eq('id', scanJob.email_connection_id)
      .eq('user_id', scanJob.user_id)
      .single();
    if (connectionError || !connection) {
      throw new Error(`Email scan connection read failed: ${connectionError?.message ?? 'missing connection'}`);
    }

    const emailConnection = connection as EmailConnectionRow;
    if (
      emailConnection.provider !== 'nylas' ||
      emailConnection.status !== 'active' ||
      !emailConnection.provider_account_id
    ) {
      throw new Error('Email scan connection is not an active Nylas grant');
    }

    const provider = createEmailProvider({
      provider: 'nylas',
      providerAccountId: emailConnection.provider_account_id,
    });

    const windowDays = Math.min(Math.max(scanJob.window_days, 1), 30);
    const query = `category:purchases newer_than:${windowDays}d -in:spam -in:trash`;
    const pageSize = 50;
    const maxPages = 20;

    let cursor: string | undefined;
    let pages = 0;
    const result: InitialEmailScanResult = {
      checked: 0,
      pages: 0,
      ignored: 0,
      review: 0,
      processed: 0,
      aiCalls: 0,
      purchaseWrites: 0,
      shipmentWrites: 0,
      documentWrites: 0,
    };

    do {
      const page = await provider.searchMessages({
        query,
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
      });
      pages += 1;
      result.pages = pages;

      for (const email of page.messages) {
        result.checked += 1;
        const pipeline = await processNylasMessage({
          grantId: emailConnection.provider_account_id,
          messageId: email.providerMessageId,
          mode,
        });

        result.aiCalls += pipeline.aiCalls;
        result.purchaseWrites += pipeline.purchaseWrites;
        result.shipmentWrites += pipeline.shipmentWrites;
        result.documentWrites += pipeline.documentWrites;

        if (pipeline.status === 'ignored') result.ignored += 1;
        else if (pipeline.status === 'processed') result.processed += 1;
        else result.review += 1;
      }

      cursor = page.nextCursor;
    } while (cursor && pages < maxPages);

    const { error: finishError } = await db.rpc('finish_email_scan_job', {
      p_id: jobId,
      p_success: true,
      p_error_code: null,
      p_result: result,
    });
    if (finishError) {
      throw new Error(`Email scan completion failed: ${finishError.message}`);
    }

    return { claimed: true, result };
  } catch (error) {
    await db.rpc('finish_email_scan_job', {
      p_id: jobId,
      p_success: false,
      p_error_code: safeErrorCode(error),
      p_result: null,
    });
    throw error;
  }
}

export async function drainEmailScanJobs(
  mode: AutomationMode,
  limit = 5,
): Promise<{ scanned: number; claimed: number; failed: number }> {
  const db = getSupabaseAdmin() as any;
  const { data, error } = await db
    .from('email_scan_jobs')
    .select('id')
    .in('status', ['pending', 'retry', 'processing'])
    .order('next_attempt_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Email scan recovery read failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string }>;
  let claimed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const processed = await processEmailScanJob(row.id, mode);
      if (processed.claimed) claimed += 1;
    } catch {
      failed += 1;
    }
  }

  return { scanned: rows.length, claimed, failed };
}
