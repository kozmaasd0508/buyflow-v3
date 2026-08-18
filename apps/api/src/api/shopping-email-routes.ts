import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  BuyFlowEmailAddressUnavailableError,
  BuyFlowEmailAlreadyAssignedError,
  InvalidBuyFlowEmailLocalPartError,
  buildBuyFlowEmailAddress,
  claimBuyFlowEmailConnection,
  findAvailableBuyFlowLocalPart,
  getBuyFlowEmailConnection,
  isBuyFlowLocalPartAvailable,
  isValidBuyFlowLocalPart,
} from '../email/buyflow-address.js';
import { resolveAuthenticatedApiUser } from './auth.js';
import { registerShoppingInboxRoutes } from './shopping-inbox-routes.js';

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function localPartFromAddress(emailAddress: string): string {
  return emailAddress.slice(0, emailAddress.lastIndexOf('@'));
}

export async function registerShoppingEmailRoutes(app: FastifyInstance) {
  await registerShoppingInboxRoutes(app);

  app.get('/api/shopping-email', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const db = getSupabaseAdmin() as any;
    try {
      const existing = await getBuyFlowEmailConnection(db, user.id);
      if (existing) {
        return {
          assigned: true,
          emailAddress: existing.emailAddress,
          localPart: localPartFromAddress(existing.emailAddress),
          status: existing.status,
          changeable: false,
        };
      }

      const suggestedLocalPart = await findAvailableBuyFlowLocalPart({
        db,
        userId: user.id,
        userEmail: user.email,
      });
      return {
        assigned: false,
        emailAddress: null,
        localPart: null,
        suggestedLocalPart,
        suggestedEmailAddress: buildBuyFlowEmailAddress(suggestedLocalPart),
        changeable: true,
      };
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Failed to load BuyFlow shopping email');
      return reply.code(500).send({ error: 'shopping_email_unavailable' });
    }
  });

  app.get<{
    Querystring: { localPart?: string };
  }>('/api/shopping-email/availability', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const localPart = request.query.localPart?.trim().toLowerCase() ?? '';
    if (!isValidBuyFlowLocalPart(localPart)) {
      return reply.code(400).send({
        error: 'invalid_shopping_email_name',
        available: false,
      });
    }

    const db = getSupabaseAdmin() as any;
    try {
      const existing = await getBuyFlowEmailConnection(db, user.id);
      const requestedAddress = buildBuyFlowEmailAddress(localPart);
      const ownedByYou = existing?.emailAddress.toLowerCase() === requestedAddress;
      const available = await isBuyFlowLocalPartAvailable({
        db,
        localPart,
        userId: user.id,
      });

      return {
        localPart,
        emailAddress: requestedAddress,
        available,
        ownedByYou,
        canChoose: !existing || ownedByYou,
      };
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Failed to check BuyFlow shopping email availability');
      return reply.code(500).send({ error: 'shopping_email_availability_unavailable' });
    }
  });

  app.post<{
    Body: { localPart?: string } | undefined;
  }>('/api/shopping-email', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const db = getSupabaseAdmin() as any;
    try {
      const before = await getBuyFlowEmailConnection(db, user.id);
      let localPart = request.body?.localPart?.trim().toLowerCase();

      if (before && !localPart) {
        return reply.code(200).send({
          assigned: true,
          emailAddress: before.emailAddress,
          localPart: localPartFromAddress(before.emailAddress),
          status: before.status,
          changeable: false,
        });
      }

      if (!localPart) {
        localPart = await findAvailableBuyFlowLocalPart({
          db,
          userId: user.id,
          userEmail: user.email,
        });
      }

      if (!isValidBuyFlowLocalPart(localPart)) {
        return reply.code(400).send({ error: 'invalid_shopping_email_name' });
      }

      const connection = await claimBuyFlowEmailConnection({
        db,
        userId: user.id,
        userEmail: user.email,
        localPart,
      });

      return reply.code(before ? 200 : 201).send({
        assigned: true,
        emailAddress: connection.emailAddress,
        localPart: localPartFromAddress(connection.emailAddress),
        status: connection.status,
        changeable: false,
      });
    } catch (error) {
      if (error instanceof InvalidBuyFlowEmailLocalPartError) {
        return reply.code(400).send({ error: 'invalid_shopping_email_name' });
      }
      if (error instanceof BuyFlowEmailAddressUnavailableError) {
        return reply.code(409).send({ error: 'shopping_email_name_taken' });
      }
      if (error instanceof BuyFlowEmailAlreadyAssignedError) {
        return reply.code(409).send({ error: 'shopping_email_already_assigned' });
      }

      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Failed to assign BuyFlow shopping email');
      return reply.code(500).send({ error: 'shopping_email_unavailable' });
    }
  });
}
