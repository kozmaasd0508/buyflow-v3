import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  enqueueFullAuditEmailScan,
  processEmailScanJob,
} from '../ingestion/email-scan-jobs.js';
import { resolveAuthenticatedApiUser } from './auth.js';

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function senderDomain(fromAddress: string | null): string | null {
  if (!fromAddress) return null;
  const match = fromAddress.toLowerCase().match(/@([^>\s,;]+)/);
  const domain = (match?.[1] ?? '').replace(/[)>]+$/, '').trim();
  return domain || null;
}

function resultObject(row: any): Record<string, unknown> | null {
  const value = row.validated_result ?? row.structured_result;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

function publicReasonList(result: Record<string, unknown> | null): string[] {
  if (!result || !Array.isArray(result.reasons)) return [];
  return result.reasons
    .filter((value): value is string => typeof value === 'string')
    .slice(0, 8);
}

function itemState(input: {
  processingStatus: string;
  eventType: string | null;
  merchant: string | null;
  orderNumber: string | null;
  linkedPurchaseId: string | null;
}) {
  if (input.linkedPurchaseId) return 'in_buyflow';
  if (input.eventType === 'order_created' && input.merchant && input.orderNumber) return 'can_add';
  if (input.processingStatus === 'ignored' || input.eventType === 'other' || !input.eventType) return 'not_purchase';
  if (input.eventType === 'order_created') return 'uncertain_order';
  return 'related_unlinked';
}

export async function registerEmailScanReviewRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/email-connections/:id/full-audit', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

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
      });

      setImmediate(() => {
        void processEmailScanJob(jobId, 'observe').catch((scanError) => {
          app.log.error({
            errorType: scanError instanceof Error ? scanError.name : 'UnknownError',
          }, 'Full seven day inbox audit failed and was scheduled for retry');
        });
      });

      return reply.code(202).send({ jobId, status: 'pending', windowDays: 7 });
    } catch (scanError) {
      request.log.error({
        errorType: scanError instanceof Error ? scanError.name : 'UnknownError',
      }, 'Failed to enqueue full seven day inbox audit');
      return reply.code(503).send({ error: 'email_audit_unavailable' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/email-connections/:id/full-audit', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

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

    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: sources, error: sourceError }, { data: auditJob, error: jobError }] = await Promise.all([
      db
        .from('source_emails')
        .select('id,subject,from_address,received_at,source_query,processing_status,validation_status,structured_result,validated_result')
        .eq('user_id', user.id)
        .eq('email_connection_id', connection.id)
        .gte('received_at', cutoff)
        .order('received_at', { ascending: false })
        .limit(1000),
      db
        .from('email_scan_jobs')
        .select('id,status,processed_at,last_error_code,result,created_at')
        .eq('user_id', user.id)
        .eq('email_connection_id', connection.id)
        .eq('kind', 'audit')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (sourceError || jobError) return reply.code(500).send({ error: 'email_audit_unavailable' });

    const rows = sources ?? [];
    const sourceIds = rows.map((row: any) => row.id);
    let links: any[] = [];
    let purchases: any[] = [];

    if (sourceIds.length > 0) {
      const { data: linkRows, error: linkError } = await db
        .from('purchase_sources')
        .select('source_email_id,purchase_id,relation_type')
        .in('source_email_id', sourceIds);
      if (linkError) return reply.code(500).send({ error: 'email_audit_unavailable' });
      links = linkRows ?? [];

      const purchaseIds = [...new Set(links.map((row: any) => row.purchase_id).filter(Boolean))];
      if (purchaseIds.length > 0) {
        const { data: purchaseRows, error: purchaseError } = await db
          .from('purchases')
          .select('id,merchant_name,order_number,current_state')
          .eq('user_id', user.id)
          .in('id', purchaseIds);
        if (purchaseError) return reply.code(500).send({ error: 'email_audit_unavailable' });
        purchases = purchaseRows ?? [];
      }
    }

    const items = rows.map((row: any) => {
      const result = resultObject(row);
      const link = links.find((candidate: any) => candidate.source_email_id === row.id) ?? null;
      const purchase = link
        ? purchases.find((candidate: any) => candidate.id === link.purchase_id) ?? null
        : null;
      const eventType = stringOrNull(result?.event_type);
      const merchant = stringOrNull(result?.merchant);
      const orderNumber = stringOrNull(result?.order_number);
      const productCount = Array.isArray(result?.products) ? result.products.length : 0;
      const state = itemState({
        processingStatus: row.processing_status,
        eventType,
        merchant,
        orderNumber,
        linkedPurchaseId: purchase?.id ?? null,
      });

      return {
        id: row.id,
        subject: row.subject ?? '(nincs tárgy)',
        senderDomain: senderDomain(row.from_address),
        receivedAt: row.received_at,
        sourceQuery: row.source_query,
        processingStatus: row.processing_status,
        validationStatus: row.validation_status,
        eventType,
        merchant,
        orderNumber,
        total: numberOrNull(result?.total),
        currency: stringOrNull(result?.currency),
        confidence: numberOrNull(result?.confidence),
        productCount,
        reasons: publicReasonList(result),
        state,
        canAdd: state === 'can_add',
        linkedPurchase: purchase ? {
          id: purchase.id,
          merchantName: purchase.merchant_name,
          orderNumber: purchase.order_number,
          currentState: purchase.current_state,
          relationType: link.relation_type,
        } : null,
      };
    });

    const summary = {
      totalVisible: items.length,
      inBuyFlow: items.filter((item: any) => item.state === 'in_buyflow').length,
      canAdd: items.filter((item: any) => item.state === 'can_add').length,
      relatedUnlinked: items.filter((item: any) => item.state === 'related_unlinked').length,
      uncertain: items.filter((item: any) => item.state === 'uncertain_order').length,
      notPurchase: items.filter((item: any) => item.state === 'not_purchase').length,
    };

    return {
      windowDays: 7,
      query: 'newer_than:7d -in:spam -in:trash',
      audit: auditJob ? {
        id: auditJob.id,
        status: auditJob.status,
        processedAt: auditJob.processed_at,
        errorCode: auditJob.last_error_code,
        result: auditJob.result ?? null,
      } : null,
      summary,
      items,
    };
  });

  app.post<{ Params: { id: string; sourceId: string } }>(
    '/api/email-connections/:id/full-audit/:sourceId/add-purchase',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const db = getSupabaseAdmin() as any;
      const { data: source, error: sourceError } = await db
        .from('source_emails')
        .select('id,user_id,email_connection_id,from_address,received_at,validation_status,structured_result,validated_result')
        .eq('id', request.params.sourceId)
        .eq('user_id', user.id)
        .eq('email_connection_id', request.params.id)
        .maybeSingle();

      if (sourceError) return reply.code(500).send({ error: 'purchase_confirmation_unavailable' });
      if (!source) return reply.code(404).send({ error: 'source_email_not_found' });

      const result = resultObject(source);
      const eventType = stringOrNull(result?.event_type);
      const merchant = stringOrNull(result?.merchant);
      const orderNumber = stringOrNull(result?.order_number);
      const domain = senderDomain(source.from_address);
      const confidence = Math.min(1, Math.max(0, numberOrNull(result?.confidence) ?? 0.5));

      if (eventType !== 'order_created' || !merchant || !orderNumber || !domain) {
        return reply.code(409).send({ error: 'source_is_not_confirmable_order' });
      }

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
        request.log.error({ errorType: 'UserConfirmedPurchaseCreateError' }, 'Failed to create user-confirmed purchase');
        return reply.code(500).send({ error: 'purchase_confirmation_unavailable' });
      }

      let productsEnriched = false;
      const trusted = source.validation_status === 'validated' || source.validation_status === 'guardrailed';
      if (trusted && result?.schema_version === 2) {
        const { error: enrichError } = await db.rpc('controlled_enrich_purchase_from_order_source', {
          p_user_id: user.id,
          p_purchase_id: purchaseId,
          p_source_email_id: source.id,
          p_order: orderPayload(result),
          p_products: safeProducts(result),
        });
        if (!enrichError) productsEnriched = true;
      }

      await db.from('source_emails').update({ processing_status: 'processed' }).eq('id', source.id);

      return {
        ok: true,
        purchaseId,
        productsEnriched,
      };
    },
  );
}
