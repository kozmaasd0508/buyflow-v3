import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { getBuyFlowEmailConnection } from '../email/buyflow-address.js';
import { resolveAuthenticatedApiUser } from './auth.js';

export interface ShoppingInboxMessage {
  id: string;
  fromAddress: string | null;
  subject: string | null;
  receivedAt: string | null;
  classification: string | null;
  processingStatus: string;
  linkedPurchaseId: string | null;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

export function normalizeInboxLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 50;
  return Math.min(100, Math.max(1, Math.trunc(numeric)));
}

function messageFromRow(row: any, linkedPurchaseId: string | null): ShoppingInboxMessage {
  return {
    id: String(row.id),
    fromAddress: typeof row.from_address === 'string' ? row.from_address : null,
    subject: typeof row.subject === 'string' ? row.subject : null,
    receivedAt: typeof row.received_at === 'string' ? row.received_at : null,
    classification: typeof row.classification === 'string' ? row.classification : null,
    processingStatus: typeof row.processing_status === 'string' ? row.processing_status : 'review',
    linkedPurchaseId,
  };
}

export async function registerShoppingInboxRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>('/api/shopping-inbox', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const db = getSupabaseAdmin() as any;
    try {
      const connection = await getBuyFlowEmailConnection(db, user.id);
      if (!connection) {
        return { assigned: false, emailAddress: null, messages: [] };
      }

      const limit = normalizeInboxLimit(request.query.limit);
      const { data: rows, error } = await db
        .from('source_emails')
        .select('id,from_address,subject,received_at,classification,processing_status')
        .eq('user_id', user.id)
        .eq('email_connection_id', connection.id)
        .order('received_at', { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error) throw new Error(`Failed to load shopping inbox: ${error.message}`);

      const sourceIds = (rows ?? []).map((row: any) => String(row.id));
      const linkedBySource = new Map<string, string>();
      if (sourceIds.length > 0) {
        const { data: links, error: linkError } = await db
          .from('purchase_sources')
          .select('source_email_id,purchase_id')
          .in('source_email_id', sourceIds);
        if (linkError) throw new Error(`Failed to load shopping inbox links: ${linkError.message}`);

        for (const link of links ?? []) {
          const sourceEmailId = typeof link.source_email_id === 'string' ? link.source_email_id : null;
          const purchaseId = typeof link.purchase_id === 'string' ? link.purchase_id : null;
          if (sourceEmailId && purchaseId && !linkedBySource.has(sourceEmailId)) {
            linkedBySource.set(sourceEmailId, purchaseId);
          }
        }
      }

      return {
        assigned: true,
        emailAddress: connection.emailAddress,
        messages: (rows ?? []).map((row: any) =>
          messageFromRow(row, linkedBySource.get(String(row.id)) ?? null),
        ),
      };
    } catch (error) {
      request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Failed to load BuyFlow shopping inbox');
      return reply.code(500).send({ error: 'shopping_inbox_unavailable' });
    }
  });
}
