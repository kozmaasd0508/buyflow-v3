import type { FastifyInstance } from 'fastify';
import { env, requireGmailPubSubPushConfig } from '../config.js';
import { runDirectGmailMaintenance } from '../email/gmail-direct-maintenance.js';
import { GooglePubSubOidcVerifier } from '../email/google-pubsub-oidc.js';
import { parseGmailPubSubEnvelope } from '../email/gmail-push-notification.js';
import {
  drainGmailSyncInbox,
  enqueueGmailHistoryEvent,
} from '../email/gmail-sync-inbox.js';

let cachedVerifier: GooglePubSubOidcVerifier | null = null;
let maintenanceRunning = false;

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

function scheduleMaintenance(app: FastifyInstance, reason: 'startup' | 'periodic') {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  void runDirectGmailMaintenance().then((result) => {
    if (
      result.syncScanned > 0
      || result.watchScanned > 0
      || result.syncFailed > 0
      || result.watchFailed > 0
    ) {
      app.log.info({
        reason,
        syncScanned: result.syncScanned,
        syncSucceeded: result.syncSucceeded,
        syncFailed: result.syncFailed,
        resetRecovered: result.resetRecovered,
        watchScanned: result.watchScanned,
        watchRenewed: result.watchRenewed,
        watchFailed: result.watchFailed,
      }, 'Direct Gmail maintenance completed');
    }
  }).catch((error) => {
    app.log.error({
      errorType: error instanceof Error ? error.name : 'UnknownError',
      reason,
    }, 'Direct Gmail maintenance failed; next periodic sweep will retry');
  }).finally(() => {
    maintenanceRunning = false;
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

  // Pub/Sub is the low-latency path, not the only recovery mechanism. Keep the
  // durable inbox drain, plus a periodic cursor-based fallback sync and watch
  // renewal so a missed push or expired watch cannot silently stop ingestion.
  if (env.BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED) {
    setImmediate(() => scheduleDrain(app, 'startup'));
    const recoveryTimer = setInterval(() => scheduleDrain(app, 'recovery'), 60_000);
    recoveryTimer.unref();

    const maintenanceStartup = setTimeout(() => scheduleMaintenance(app, 'startup'), 5_000);
    maintenanceStartup.unref();
    const maintenanceTimer = setInterval(
      () => scheduleMaintenance(app, 'periodic'),
      30 * 60_000,
    );
    maintenanceTimer.unref();
  }
}
