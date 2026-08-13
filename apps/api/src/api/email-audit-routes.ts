import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { enqueueFullAuditEmailScan, processEmailScanJob } from '../ingestion/email-scan-jobs.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const AUDIT_WINDOWS = new Set([7, 30, 90]);
type AuditWindow = 7 | 30 | 90;

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function auditWindow(value: unknown): AuditWindow | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isInteger(numeric) && AUDIT_WINDOWS.has(numeric)
    ? numeric as AuditWindow
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function senderDomain(fromAddress: string | null): string | null {
  if (!fromAddress) return null;
  const match = fromAddress.toLowerCase().match(/@([^>\s,;]+)/);
  const domain = (match?.[1] ?? '').replace(/[)>]+$/, '').trim();
  return domain || null;
}

function safeProducts(result: Record<string, unknown>): unknown[] {
  return Array.isArray(result.products) ? result.products.slice(0, 50) : [];
}

function orderPayload(result: Record<string, unknown>) {
  return {
    order_number: stringOrNull(result.order_number),
    merchant_legal_name: stringOrNull(result.merchant_legal_name),
    subtotal: numberOrNull(result.subtotal),
    shipping_amount: numberOrNull(result.shipping_amount),
    discount_amount: numberOrNull(result.discount_amount),
    total: numberOrNull(result.total),
    currency: stringOrNull(result.currency),
    payment_status: stringOrNull(result.payment_status),
    payment_method: stringOrNull(result.payment_method),
    shipping_method: stringOrNull(result.shipping_method),
    carrier: stringOrNull(result.carrier),
  };
}

function publicState(input: {
  linkedPurchaseId: string | null;
  aiErrorCode: string | null;
  eventType: string | null;
  merchant: string | null;
  orderNumber: string | null;
}) {
  if (input.linkedPurchaseId) return 'in_buyflow';
  if (input.aiErrorCode) return 'ai_error';
  if (input.eventType === 'order_created' && input.merchant && input.orderNumber) return 'can_add';
  if (input.eventType === 'order_created') return 'uncertain_order';
  if (!input.eventType || input.eventType === 'other') return 'not_purchase';
  return 'related_unlinked';
}

export async function registerEmailAuditRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: { windowDays?: number };
  }>('/api/email-connections/:id/audit', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const windowDays = auditWindow(request.body?.windowDays ?? 30);
    if (!windowDays) return reply.code(400).send({ error: 'invalid_audit_window' });

    const db = getSupabaseAdmin() as any;
    const { data: connection, error } = await db
      .from('email_connections')
      .select('id')
      .eq('id', request.params.id)
      .eq('user_id', user.id)
      .eq('provider', 'nylas')
      .eq('status', 'active')
      .maybeSingle();

    if (error) return reply.code(500).send({ error: 'email_audit_unavailable' });
    if (!connection) return reply.code(404).send({ error: 'email_connection_not_found' });

    try {
      const jobId = await enqueueFullAuditEmailScan({
        userId: user.id,
        emailConnectionId: connection.id,
        windowDays,
      });
      setImmediate(() => {
        void processEmailScanJob(jobId, 'observe').catch((scanError) => {
          app.log.error({
            errorType: scanError instanceof Error ? scanError.name : 'UnknownError',
          }, 'Configurable inbox AI audit failed and was scheduled for retry');
        });
      });
      return reply.code(202).send({ jobId, status: 'pending', windowDays });
    } catch (scanError) {
      request.log.error({
        errorType: scanError instanceof Error ? scanError.name : 'UnknownError',
      }, 'Failed to enqueue configurable inbox AI audit');
      return reply.code(503).send({ error: 'email_audit_unavailable' });
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { windowDays?: string };
  }>('/api/email-connections/:id/audit', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const windowDays = auditWindow(request.query.windowDays ?? '30');
    if (!windowDays) return reply.code(400).send({ error: 'invalid_audit_window' });

    const db = getSupabaseAdmin() as any;
    const { data: connection, error: connectionError } = await db
      .from('email_connections')
      .select('id')
      .eq('id', request.params.id)
      .eq('user_id', user.id)
      .eq('provider', 'nylas')
      .eq('status', 'active')
      .maybeSingle();
    if (connectionError) return reply.code(500).send({ error: 'email_audit_unavailable' });
    if (!connection) return reply.code(404).send({ error: 'email_connection_not_found' });

    const { data: auditJob, error: jobError } = await db
      .from('email_scan_jobs')
      .select('id,status,window_days,processed_at,last_error_code,result,created_at')
      .eq('user_id', user.id)
      .eq('email_connection_id', connection.id)
      .eq('kind', 'audit')
      .eq('window_days', windowDays)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (jobError) return reply.code(500).send({ error: 'email_audit_unavailable' });

    if (!auditJob) {
      return {
        windowDays,
        query: `newer_than:${windowDays}d -in:spam -in:trash`,
        audit: null,
        summary: {
          total: 0,
          gmailPurchases: 0,
          filterRelevant: 0,
          aiCommerce: 0,
          inBuyFlow: 0,
          canAdd: 0,
          relatedUnlinked: 0,
          uncertain: 0,
          notPurchase: 0,
          aiErrors: 0,
        },
        items: [],
      };
    }

    const { data: auditRows, error: auditError } = await db
      .from('email_audit_results')
      .select('source_email_id,gmail_category_purchases,filter_relevant,filter_reasons,ai_event_type,ai_confidence,ai_validation_status,ai_result,ai_error_code,linked_purchase_id,created_at')
      .eq('job_id', auditJob.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (auditError) return reply.code(500).send({ error: 'email_audit_unavailable' });

    const rows = auditRows ?? [];
    const sourceIds = rows.map((row: any) => row.source_email_id);
    const purchaseIds = [...new Set(rows.map((row: any) => row.linked_purchase_id).filter(Boolean))];

    let sources: any[] = [];
    let purchases: any[] = [];
    if (sourceIds.length > 0) {
      const { data, error } = await db
        .from('source_emails')
        .select('id,subject,from_address,received_at,processing_status')
        .eq('user_id', user.id)
        .in('id', sourceIds);
      if (error) return reply.code(500).send({ error: 'email_audit_unavailable' });
      sources = data ?? [];
    }
    if (purchaseIds.length > 0) {
      const { data, error } = await db
        .from('purchases')
        .select('id,merchant_name,order_number,current_state')
        .eq('user_id', user.id)
        .in('id', purchaseIds);
      if (error) return reply.code(500).send({ error: 'email_audit_unavailable' });
      purchases = data ?? [];
    }

    const items = rows.map((row: any) => {
      const source = sources.find((candidate: any) => candidate.id === row.source_email_id) ?? null;
      const aiContainer = objectOrNull(row.ai_result);
      const validated = objectOrNull(aiContainer?.validated);
      const eventType = stringOrNull(row.ai_event_type ?? validated?.event_type);
      const merchant = stringOrNull(validated?.merchant);
      const orderNumber = stringOrNull(validated?.order_number);
      const productCount = Array.isArray(validated?.products) ? validated.products.length : 0;
      const linkedPurchaseId = stringOrNull(row.linked_purchase_id);
      const linkedPurchase = linkedPurchaseId
        ? purchases.find((candidate: any) => candidate.id === linkedPurchaseId) ?? null
        : null;
      const state = publicState({
        linkedPurchaseId,
        aiErrorCode: stringOrNull(row.ai_error_code),
        eventType,
        merchant,
        orderNumber,
      });

      return {
        sourceEmailId: row.source_email_id,
        jobId: auditJob.id,
        subject: source?.subject ?? '(nincs tárgy)',
        senderDomain: senderDomain(source?.from_address ?? null),
        receivedAt: source?.received_at ?? row.created_at,
        gmailCategoryPurchases: Boolean(row.gmail_category_purchases),
        filterRelevant: Boolean(row.filter_relevant),
        filterReasons: Array.isArray(row.filter_reasons) ? row.filter_reasons : [],
        aiEventType: eventType,
        aiConfidence: numberOrNull(row.ai_confidence),
        aiValidationStatus: stringOrNull(row.ai_validation_status),
        aiErrorCode: stringOrNull(row.ai_error_code),
        merchant,
        orderNumber,
        total: numberOrNull(validated?.total),
        currency: stringOrNull(validated?.currency),
        productCount,
        state,
        canAdd: state === 'can_add',
        linkedPurchase: linkedPurchase ? {
          id: linkedPurchase.id,
          merchantName: linkedPurchase.merchant_name,
          orderNumber: linkedPurchase.order_number,
          currentState: linkedPurchase.current_state,
        } : null,
      };
    });

    return {
      windowDays,
      query: `newer_than:${windowDays}d -in:spam -in:trash`,
      audit: {
        id: auditJob.id,
        status: auditJob.status,
        processedAt: auditJob.processed_at,
        errorCode: auditJob.last_error_code,
        result: auditJob.result ?? null,
        resultsReady: items.length,
      },
      summary: {
        total: items.length,
        gmailPurchases: items.filter((item: any) => item.gmailCategoryPurchases).length,
        filterRelevant: items.filter((item: any) => item.filterRelevant).length,
        aiCommerce: items.filter((item: any) => item.aiEventType && item.aiEventType !== 'other').length,
        inBuyFlow: items.filter((item: any) => item.state === 'in_buyflow').length,
        canAdd: items.filter((item: any) => item.state === 'can_add').length,
        relatedUnlinked: items.filter((item: any) => item.state === 'related_unlinked').length,
        uncertain: items.filter((item: any) => item.state === 'uncertain_order').length,
        notPurchase: items.filter((item: any) => item.state === 'not_purchase').length,
        aiErrors: items.filter((item: any) => item.state === 'ai_error').length,
      },
      items,
    };
  });

  app.post<{
    Params: { id: string; jobId: string; sourceId: string };
  }>('/api/email-connections/:id/audit/:jobId/:sourceId/add-purchase', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const db = getSupabaseAdmin() as any;

    const { data: job, error: jobError } = await db
      .from('email_scan_jobs')
      .select('id,email_connection_id')
      .eq('id', request.params.jobId)
      .eq('user_id', user.id)
      .eq('email_connection_id', request.params.id)
      .eq('kind', 'audit')
      .maybeSingle();
    if (jobError) return reply.code(500).send({ error: 'purchase_confirmation_unavailable' });
    if (!job) return reply.code(404).send({ error: 'audit_not_found' });

    const { data: audit, error: auditError } = await db
      .from('email_audit_results')
      .select('source_email_id,ai_result,ai_confidence,ai_validation_status,linked_purchase_id')
      .eq('job_id', request.params.jobId)
      .eq('source_email_id', request.params.sourceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (auditError) return reply.code(500).send({ error: 'purchase_confirmation_unavailable' });
    if (!audit) return reply.code(404).send({ error: 'audit_result_not_found' });

    if (audit.linked_purchase_id) {
      return { ok: true, purchaseId: audit.linked_purchase_id, alreadyLinked: true };
    }

    const container = objectOrNull(audit.ai_result);
    const extraction = objectOrNull(container?.extraction);
    const validated = objectOrNull(container?.validated);
    const merchant = stringOrNull(validated?.merchant);
    const orderNumber = stringOrNull(validated?.order_number);
    const eventType = stringOrNull(validated?.event_type);

    const { data: source, error: sourceError } = await db
      .from('source_emails')
      .select('id,from_address,received_at')
      .eq('id', request.params.sourceId)
      .eq('user_id', user.id)
      .eq('email_connection_id', request.params.id)
      .maybeSingle();
    if (sourceError) return reply.code(500).send({ error: 'purchase_confirmation_unavailable' });
    if (!source) return reply.code(404).send({ error: 'source_email_not_found' });

    const domain = senderDomain(source.from_address);
    if (eventType !== 'order_created' || !merchant || !orderNumber || !domain || !validated || !extraction) {
      return reply.code(409).send({ error: 'audit_result_is_not_confirmable_order' });
    }

    const confidence = Math.min(1, Math.max(0, numberOrNull(audit.ai_confidence) ?? 0.5));
    const validatedForSource = { schema_version: 2, ...validated };
    const extractionForSource = { schema_version: 2, ...extraction };

    const { error: sourceUpdateError } = await db
      .from('source_emails')
      .update({
        classification: eventType,
        structured_result: extractionForSource,
        validated_result: validatedForSource,
        validation_status: stringOrNull(audit.ai_validation_status) ?? 'review',
        validated_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
        processing_status: 'review',
      })
      .eq('id', source.id)
      .eq('user_id', user.id);
    if (sourceUpdateError) return reply.code(500).send({ error: 'purchase_confirmation_unavailable' });

    const { data: purchaseId, error: createError } = await db.rpc('controlled_create_purchase_with_sources', {
      p_user_id: user.id,
      p_merchant_name: merchant,
      p_merchant_domain: domain,
      p_order_number: orderNumber,
      p_ordered_at: source.received_at,
      p_confidence: confidence,
      p_sources: [{
        source_email_id: source.id,
        relation_type: 'user_confirmed_order',
        confidence,
      }],
    });
    if (createError || typeof purchaseId !== 'string') {
      request.log.error({ errorType: 'AuditConfirmedPurchaseCreateError' }, 'Failed to create audit-confirmed purchase');
      return reply.code(500).send({ error: 'purchase_confirmation_unavailable' });
    }

    let productsEnriched = false;
    const validationStatus = stringOrNull(validated.validation_status);
    if (validationStatus === 'validated' || validationStatus === 'guardrailed') {
      const { error: enrichError } = await db.rpc('controlled_enrich_purchase_from_order_source', {
        p_user_id: user.id,
        p_purchase_id: purchaseId,
        p_source_email_id: source.id,
        p_order: orderPayload(validated),
        p_products: safeProducts(validated),
      });
      if (!enrichError) productsEnriched = true;
    }

    await Promise.all([
      db.from('source_emails').update({ processing_status: 'processed' }).eq('id', source.id).eq('user_id', user.id),
      db.from('email_audit_results').update({ linked_purchase_id: purchaseId }).eq('job_id', request.params.jobId).eq('source_email_id', source.id).eq('user_id', user.id),
    ]);

    return { ok: true, purchaseId, productsEnriched, alreadyLinked: false };
  });
}
