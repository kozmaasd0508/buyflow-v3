import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  enqueueTargetedEmailScan,
  processEmailScanJob,
} from '../ingestion/email-scan-jobs.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const ALLOWED_WINDOWS = new Set([7, 30, 90]);

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function normalizeSearchTerm(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/["\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scheduleRecovery(app: FastifyInstance, jobId: string) {
  setImmediate(() => {
    void processEmailScanJob(jobId, env.BUYFLOW_AUTOMATION_MODE).catch((error) => {
      app.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Targeted purchase recovery failed and was scheduled for retry');
    });
  });
}

function safeResult(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const number = (key: string) => typeof source[key] === 'number' ? source[key] : 0;
  return {
    checked: number('checked'),
    processed: number('processed'),
    unlinked: number('unlinked'),
    review: number('review'),
    ignored: number('ignored'),
    purchaseWrites: number('purchaseWrites'),
    shipmentWrites: number('shipmentWrites'),
    documentWrites: number('documentWrites'),
  };
}

export async function registerPurchaseRecoveryRoutes(app: FastifyInstance) {
  app.post<{
    Body: { searchTerm?: string; windowDays?: number };
  }>('/api/purchase-recovery', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const searchTerm = normalizeSearchTerm(request.body?.searchTerm);
    const windowDays = request.body?.windowDays ?? 30;

    if (searchTerm.length < 2 || searchTerm.length > 120) {
      return reply.code(400).send({ error: 'invalid_search_term' });
    }
    if (!Number.isInteger(windowDays) || !ALLOWED_WINDOWS.has(windowDays)) {
      return reply.code(400).send({ error: 'invalid_window_days' });
    }

    const db = getSupabaseAdmin() as any;
    const { data: connection, error: connectionError } = await db
      .from('email_connections')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'nylas')
      .eq('status', 'active')
      .order('connected_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connectionError) {
      request.log.error({ errorType: 'PurchaseRecoveryConnectionReadError' }, 'Failed to load recovery email connection');
      return reply.code(500).send({ error: 'purchase_recovery_unavailable' });
    }
    if (!connection) {
      return reply.code(409).send({ error: 'email_connection_required' });
    }

    try {
      const jobId = await enqueueTargetedEmailScan({
        userId: user.id,
        emailConnectionId: connection.id,
        searchTerm,
        windowDays: windowDays as 7 | 30 | 90,
      });
      scheduleRecovery(app, jobId);
      return reply.code(202).send({
        jobId,
        status: 'pending',
        windowDays,
      });
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Failed to start targeted purchase recovery');
      return reply.code(503).send({ error: 'purchase_recovery_unavailable' });
    }
  });

  app.get<{
    Params: { id: string };
  }>('/api/purchase-recovery/:id', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const db = getSupabaseAdmin() as any;
    const { data: job, error } = await db
      .from('email_scan_jobs')
      .select('id,window_days,status,processed_at,last_error_code,result,created_at')
      .eq('id', request.params.id)
      .eq('user_id', user.id)
      .eq('kind', 'targeted')
      .maybeSingle();

    if (error) {
      request.log.error({ errorType: 'PurchaseRecoveryStatusReadError' }, 'Failed to read targeted purchase recovery status');
      return reply.code(500).send({ error: 'purchase_recovery_unavailable' });
    }
    if (!job) {
      return reply.code(404).send({ error: 'purchase_recovery_not_found' });
    }

    return {
      job: {
        id: job.id,
        windowDays: job.window_days,
        status: job.status,
        processedAt: job.processed_at,
        retrying: job.status === 'retry',
        failed: Boolean(job.last_error_code) && job.status === 'retry',
        result: safeResult(job.result),
      },
    };
  });
}
