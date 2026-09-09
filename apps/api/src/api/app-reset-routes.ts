import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { resolveAuthenticatedApiUser } from './auth.js';

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

export async function registerAppResetRoutes(app: FastifyInstance) {
  app.post('/api/app-reset', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const db = getSupabaseAdmin() as any;
    const { data, error } = await db.rpc('reset_buyflow_user_data', {
      p_user_id: user.id,
    });

    if (error) {
      request.log.error({ errorType: 'BuyFlowUserResetError' }, 'Failed to reset BuyFlow user data');
      return reply.code(500).send({ error: 'app_reset_unavailable' });
    }

    return reply.code(200).send({
      ok: true,
      reset: data ?? null,
      automaticScanWindowDays: 2,
      emailConnectionPreserved: true,
    });
  });
}
