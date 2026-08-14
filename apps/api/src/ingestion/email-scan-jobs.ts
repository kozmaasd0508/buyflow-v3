import { env } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import {
  processNylasMessage,
  type AutomaticPipelineResult,
  type AutomationMode,
} from '../pipeline/automatic-email-pipeline.js';
import { enqueueAutomaticTargetedRecoveryForSource } from './automatic-targeted-recovery.js';
import { guardNylasMessageWhenAiDisabled } from './deterministic-ai-off-fallback.js';
import { preprocessDeterministicNylasMessage } from './deterministic-commerce-parser.js';
import { preprocessDeterministicLifecycleNylasMessage } from './deterministic-lifecycle-parser.js';
import { processEmailForAuditBenchmark } from './email-audit-benchmark.js';

interface EmailScanJobRow {
  id: string;
  user_id: string;
  email_connection_id: string;
  kind: 'initial' | 'targeted' | 'audit';
  window_days: number;
  search_term: string | null;
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
  unlinked: number;
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

function normalizeSearchTerm(value: string): string {
  return value
    .replace(/["\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validAuditWindow(value: number): value is 7 | 30 | 90 {
  return value === 7 || value === 30 || value === 90;
}

function emptyScanResult(): InitialEmailScanResult {
  return {
    checked: 0,
    pages: 0,
    ignored: 0,
    unlinked: 0,
    review: 0,
    processed: 0,
    aiCalls: 0,
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
  };
}

function guardedReviewPipeline(sourceEmailId?: string): AutomaticPipelineResult {
  return {
    ok: true,
    status: 'review',
    ...(sourceEmailId ? { sourceEmailId } : {}),
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
    aiCalls: 0,
  };
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

export async function enqueueFullAuditEmailScan(input: {
  userId: string;
  emailConnectionId: string;
  windowDays?: 7 | 30 | 90;
}): Promise<string> {
  if (!env.BUYFLOW_AI_ENABLED) {
    throw new Error('AI audit is disabled while BuyFlow runs in deterministic-only mode');
  }

  const db = getSupabaseAdmin() as any;
  const windowDays = input.windowDays ?? 30;
  if (!validAuditWindow(windowDays)) {
    throw new Error('Full audit supports 7, 30, or 90 days');
  }

  const { data, error } = await db
    .from('email_scan_jobs')
    .insert({
      user_id: input.userId,
      email_connection_id: input.emailConnectionId,
      kind: 'audit',
      window_days: windowDays,
      search_term: null,
      automatic_dedupe_key: null,
      status: 'pending',
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      locked_at: null,
      processed_at: null,
      last_error_code: null,
      result: null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Full audit email scan enqueue failed: ${error.message}`);
  }
  if (typeof data?.id !== 'string' || !data.id) {
    throw new Error('Full audit email scan enqueue returned no job id');
  }
  return data.id;
}

export async function enqueueTargetedEmailScan(input: {
  userId: string;
  emailConnectionId: string;
  searchTerm: string;
  windowDays: 7 | 30 | 90;
}): Promise<string> {
  const db = getSupabaseAdmin() as any;
  const searchTerm = normalizeSearchTerm(input.searchTerm);
  if (searchTerm.length < 2 || searchTerm.length > 120) {
    throw new Error('Targeted email scan search term is invalid');
  }

  const { data, error } = await db.rpc('enqueue_targeted_email_scan', {
    p_user_id: input.userId,
    p_email_connection_id: input.emailConnectionId,
    p_search_term: searchTerm,
    p_window_days: input.windowDays,
  });

  if (error) {
    throw new Error(`Targeted email scan enqueue failed: ${error.message}`);
  }
  if (typeof data !== 'string' || !data) {
    throw new Error('Targeted email scan enqueue returned no job id');
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
      .select('id,user_id,email_connection_id,kind,window_days,search_term,status')
      .eq('id', jobId)
      .single();
    if (jobError || !job) {
      throw new Error(`Email scan job read failed: ${jobError?.message ?? 'missing job'}`);
    }

    const scanJob = job as EmailScanJobRow;

    if (scanJob.kind === 'audit' && !env.BUYFLOW_AI_ENABLED) {
      const result = emptyScanResult();
      const { error: finishDisabledError } = await db.rpc('finish_email_scan_job', {
        p_id: jobId,
        p_success: true,
        p_error_code: null,
        p_result: { ...result, disabledReason: 'ai_disabled' },
      });
      if (finishDisabledError) {
        throw new Error(`Disabled AI audit completion failed: ${finishDisabledError.message}`);
      }
      return { claimed: true, result };
    }

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

    const windowDays = Math.min(Math.max(scanJob.window_days, 1), 90);
    let query: string;
    let pageSize: number;
    let maxPages: number;

    if (scanJob.kind === 'targeted') {
      const searchTerm = normalizeSearchTerm(scanJob.search_term ?? '');
      if (searchTerm.length < 2) {
        throw new Error('Targeted email scan is missing a valid search term');
      }
      query = `"${searchTerm}" newer_than:${windowDays}d -in:spam -in:trash`;
      pageSize = 20;
      maxPages = 2;
    } else if (scanJob.kind === 'audit') {
      query = `newer_than:${windowDays}d -in:spam -in:trash`;
      pageSize = 50;
      maxPages = windowDays <= 7 ? 20 : windowDays <= 30 ? 50 : 100;
    } else {
      query = `category:purchases newer_than:${windowDays}d -in:spam -in:trash`;
      pageSize = 50;
      maxPages = 20;
    }

    const effectiveMode: AutomationMode = scanJob.kind === 'audit' ? 'observe' : mode;
    let cursor: string | undefined;
    let pages = 0;
    const result = emptyScanResult();

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

        if (scanJob.kind === 'audit') {
          const audit = await processEmailForAuditBenchmark({
            jobId: scanJob.id,
            userId: scanJob.user_id,
            emailConnectionId: scanJob.email_connection_id,
            email,
          });
          result.aiCalls += audit.aiCalled ? 1 : 0;
          if (audit.failed) result.review += 1;
          else if (audit.linkedPurchaseId) result.processed += 1;
          else if (audit.aiEventType === 'other') result.ignored += 1;
          else result.unlinked += 1;
          continue;
        }

        const lifecyclePreprocess = await preprocessDeterministicLifecycleNylasMessage({
          grantId: emailConnection.provider_account_id,
          messageId: email.providerMessageId,
        });

        let commerceMatched = false;
        if (!lifecyclePreprocess.matched) {
          const commercePreprocess = await preprocessDeterministicNylasMessage({
            grantId: emailConnection.provider_account_id,
            messageId: email.providerMessageId,
          });
          commerceMatched = commercePreprocess.matched;
        }

        const aiOffGuard = !lifecyclePreprocess.matched && !commerceMatched
          ? await guardNylasMessageWhenAiDisabled({
            grantId: emailConnection.provider_account_id,
            messageId: email.providerMessageId,
            sourceQuery: `scan:${scanJob.kind}`,
          })
          : null;

        const pipeline = aiOffGuard?.guarded
          ? guardedReviewPipeline(aiOffGuard.sourceEmailId)
          : await processNylasMessage({
            grantId: emailConnection.provider_account_id,
            messageId: email.providerMessageId,
            mode: effectiveMode,
          });

        if (
          scanJob.kind === 'initial' &&
          pipeline.status === 'unlinked' &&
          pipeline.sourceEmailId
        ) {
          await enqueueAutomaticTargetedRecoveryForSource(pipeline.sourceEmailId);
        }

        result.aiCalls += pipeline.aiCalls;
        result.purchaseWrites += pipeline.purchaseWrites;
        result.shipmentWrites += pipeline.shipmentWrites;
        result.documentWrites += pipeline.documentWrites;

        if (pipeline.status === 'ignored') result.ignored += 1;
        else if (pipeline.status === 'processed') result.processed += 1;
        else if (pipeline.status === 'unlinked') result.unlinked += 1;
        else result.review += 1;
      }

      await db
        .from('email_scan_jobs')
        .update({ locked_at: new Date().toISOString() })
        .eq('id', scanJob.id)
        .eq('status', 'processing');

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
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await db
    .from('email_scan_jobs')
    .select('id,status,next_attempt_at,locked_at')
    .in('status', ['pending', 'retry', 'processing'])
    .or(`and(status.in.(pending,retry),next_attempt_at.lte.${now}),and(status.eq.processing,locked_at.lt.${staleCutoff})`)
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
