import type { FastifyInstance } from 'fastify';
import { env, requireGmailPubSubPushConfig } from '../config.js';
import { GooglePubSubOidcVerifier } from '../email/google-pubsub-oidc.js';
import { parseGmailPubSubEnvelope } from '../email/gmail-push-notification.js';
import {
  drainGmailSyncInbox,
  enqueueGmailHistoryEvent,
} from '../email/gmail-sync-inbox.js';

let cachedVerifier: GooglePubSubOidcVerifier | null = null;

function verifier(): GooglePubSubOidcVerifier {
  if (cachedVerifier) return cachedVerifier;
  const config = requireGmailPubSubPushConfig();
  cachedVerifier = new GooglePubSubOidcVerifier({
    audience: config.audience,
    serviceAccountEmail: config.serviceAccountEmail,
  });
  return cachedVerifier;
}

function scheduleDrain(app: FastifyInstance, reason: 'push' | 'startup' | 'recovery') {
  void drainGmailSyncInbox().then((result) => {
    if (result.claimed > 0 || result.failed > 0) {
      app.log.info({
        scanned: result.scanned,
        claimed: result.claimed,
        failed: result.failed,
        reason,
      }, 'Gmail sync inbox drain completed');
    }
  }).catch((error) => {
    app.log.error({
      errorType: error instanceof Error ? error.name : 'UnknownError',
      reason,
    }, 'Gmail sync inbox drain failed; durable recovery will retry');
  });
}

export async function registerGmailPushRoutes(app: FastifyInstance) {
  app.post('/webhooks/google/gmail', async (request, reply) => {
    if (!env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) {
      return reply.code(503).send({ ok: false, error: 'gmail_direct_runtime_disabled' });
    }

    let pushVerifier: GooglePubSubOidcVerifier;
    try {
      pushVerifier = verifier();
    } catch {
      request.log.error('Gmail Pub/Sub push rejected because OIDC configuration is incomplete');
      return reply.code(503).send({ ok: false, error: 'gmail_push_not_configured' });
    }

    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    try {
      await pushVerifier.verifyAuthorizationHeader(authorization);
    } catch (error) {
      request.log.warn({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Rejected Gmail Pub/Sub push with invalid Google OIDC identity');
      return reply.code(401).send({ ok: false, error: 'invalid_push_identity' });
    }

    let notification;
    try {
      notification = parseGmailPubSubEnvelope(request.body);
    } catch (error) {
      request.log.warn({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Rejected malformed Gmail Pub/Sub notification');
      return reply.code(400).send({ ok: false, error: 'invalid_push_payload' });
    }

    try {
      const enqueuedConnections = await enqueueGmailHistoryEvent({
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
      });

      // Acknowledge only after the wake-up event is durable. The worker resumes
      // from the DB-committed Gmail cursor; Pub/Sub data never becomes email or
      // Purchase evidence directly.
      setImmediate(() => scheduleDrain(app, 'push'));

      request.log.info({
        enqueuedConnections,
        provider: 'gmail',
      }, 'Authenticated Gmail Pub/Sub wake-up was persisted');
      return reply.code(204).send();
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'Gmail Pub/Sub wake-up could not be persisted');
      return reply.code(503).send({ ok: false, error: 'gmail_push_persistence_failed' });
    }
  });

  // Pub/Sub is only a wake-up mechanism. The DB inbox is the durability layer,
  // so recover pending/retry/stale-processing rows even if the process crashed
  // after acknowledging Google but before immediate processing started.
  if (env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) {
    setImmediate(() => scheduleDrain(app, 'startup'));
    const timer = setInterval(() => scheduleDrain(app, 'recovery'), 60_000);
    timer.unref();
  }
}
