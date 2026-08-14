import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerAppApiRoutes } from './api/app-routes.js';
import { registerEmailAuditRoutes } from './api/email-audit-routes.js';
import { registerEmailConnectionRoutes } from './api/email-connection-routes.js';
import { registerEmailScanReviewRoutes } from './api/email-scan-review-routes.js';
import { registerProductActionRoutes } from './api/product-action-routes.js';
import { registerPurchaseRecoveryRoutes } from './api/purchase-recovery-routes.js';
import { passwordResetPageHtml } from './auth/reset-password-page.js';
import { env, requireNylasWebhookSecret } from './config.js';
import { drainEmailScanJobs } from './ingestion/email-scan-jobs.js';
import { drainTrackingBridgeRecoveryV21 } from './ingestion/tracking-bridge-recovery-v21.js';
import { drainUnlinkedRecoveryV2 } from './ingestion/unlinked-recovery-v2.js';
import { registerWebPreview } from './web-preview.js';
import {
  drainWebhookInbox,
  enqueueNylasMessageEvent,
  processWebhookInboxEvent,
} from './webhooks/webhook-inbox.js';
import {
  parseNylasMessageCreatedEvent,
  verifyNylasSignature,
} from './webhooks/nylas-webhook.js';

const app = Fastify({ logger: true });
const deployedGitCommit = process.env.RENDER_GIT_COMMIT ?? null;

const allowedAppOrigins = new Set([
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowedAppOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  credentials: false,
  maxAge: 86_400,
});

const webhookStats = {
  postsReceived: 0,
  invalidSignatures: 0,
  validSignatures: 0,
  parsedMessageCreated: 0,
  unsupportedSignedEvents: 0,
  inboxPersisted: 0,
  inboxPersistenceFailed: 0,
  inboxClaimed: 0,
  pipelineCompleted: 0,
  pipelineFailed: 0,
  unknownGrant: 0,
  recoveryRuns: 0,
  recoveryClaimed: 0,
  recoveryFailed: 0,
  emailScanRecoveryRuns: 0,
  emailScanRecoveryClaimed: 0,
  emailScanRecoveryFailed: 0,
};

app.removeContentTypeParser('application/json');
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (request, body, done) => {
    if (request.url.startsWith('/webhooks/nylas')) {
      done(null, body);
      return;
    }
    try {
      done(null, JSON.parse(body.toString('utf8')) as unknown);
    } catch (error) {
      done(error as Error, undefined);
    }
  },
);

await registerAppApiRoutes(app);
await registerProductActionRoutes(app);
await registerEmailConnectionRoutes(app);
await registerEmailScanReviewRoutes(app);
await registerEmailAuditRoutes(app);
await registerPurchaseRecoveryRoutes(app);
await registerWebPreview(app);

app.get('/auth/reset-password', async (_request, reply) => reply
  .code(200)
  .type('text/html; charset=utf-8')
  .header('Cache-Control', 'no-store')
  .header('Referrer-Policy', 'no-referrer')
  .header('X-Content-Type-Options', 'nosniff')
  .send(passwordResetPageHtml()));

app.get('/health', async () => ({
  ok: true,
  service: 'buyflow-api',
  version: '0.4.0',
  commit: deployedGitCommit,
  automationMode: env.BUYFLOW_AUTOMATION_MODE,
  webhook: { ...webhookStats },
}));

app.get<{ Querystring: { challenge?: string } }>('/webhooks/nylas', async (request, reply) => {
  const challenge = request.query.challenge;
  if (!challenge) return reply.code(400).type('text/plain').send('missing challenge');
  return reply.code(200).type('text/plain').header('Content-Length', Buffer.byteLength(challenge).toString()).send(challenge);
});

async function runInboxEvent(eventId: string) {
  try {
    const result = await processWebhookInboxEvent(eventId, env.BUYFLOW_AUTOMATION_MODE);
    if (!result.claimed) return;
    webhookStats.inboxClaimed += 1;
    if (result.pipeline) {
      webhookStats.pipelineCompleted += 1;
      if (result.pipeline.status === 'unknown_grant') webhookStats.unknownGrant += 1;
      app.log.info({
        pipelineStatus: result.pipeline.status,
        purchaseWrites: result.pipeline.purchaseWrites,
        shipmentWrites: result.pipeline.shipmentWrites,
        documentWrites: result.pipeline.documentWrites,
        aiCalls: result.pipeline.aiCalls,
        automationMode: env.BUYFLOW_AUTOMATION_MODE,
      }, 'Durable Nylas message pipeline completed');
    }
  } catch (error) {
    webhookStats.pipelineFailed += 1;
    app.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Durable Nylas message pipeline failed and was scheduled for retry');
  }
}

async function runRecovery() {
  try {
    const result = await drainWebhookInbox(env.BUYFLOW_AUTOMATION_MODE);
    webhookStats.recoveryRuns += 1;
    webhookStats.recoveryClaimed += result.claimed;
    webhookStats.recoveryFailed += result.failed;
    if (result.claimed > 0 || result.failed > 0) {
      app.log.info({ scanned: result.scanned, claimed: result.claimed, failed: result.failed }, 'Webhook inbox recovery completed');
    }
  } catch (error) {
    webhookStats.recoveryFailed += 1;
    app.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Webhook inbox recovery scan failed');
  }

  try {
    const result = await drainEmailScanJobs(env.BUYFLOW_AUTOMATION_MODE);
    webhookStats.emailScanRecoveryRuns += 1;
    webhookStats.emailScanRecoveryClaimed += result.claimed;
    webhookStats.emailScanRecoveryFailed += result.failed;
    if (result.claimed > 0 || result.failed > 0) {
      app.log.info({ scanned: result.scanned, claimed: result.claimed, failed: result.failed }, 'Email scan recovery completed');
    }
  } catch (error) {
    webhookStats.emailScanRecoveryFailed += 1;
    app.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Email scan recovery scan failed');
  }

  try {
    const result = await drainUnlinkedRecoveryV2(env.BUYFLOW_AUTOMATION_MODE);
    if (result.linked > 0 || result.healed > 0 || result.review > 0 || result.failed > 0) {
      app.log.info({
        scanned: result.scanned,
        linked: result.linked,
        healed: result.healed,
        review: result.review,
        unmatched: result.unmatched,
        failed: result.failed,
        automationMode: env.BUYFLOW_AUTOMATION_MODE,
      }, 'Unlinked resolver V2 recovery completed');
    }
  } catch (error) {
    app.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Unlinked resolver V2 recovery scan failed');
  }

  try {
    const result = await drainTrackingBridgeRecoveryV21(env.BUYFLOW_AUTOMATION_MODE);
    if (result.linkedClusters > 0 || result.reviewClusters > 0 || result.failedClusters > 0) {
      app.log.info({
        scanned: result.scanned,
        clusters: result.clusters,
        linkedClusters: result.linkedClusters,
        linkedSources: result.linkedSources,
        reviewClusters: result.reviewClusters,
        unmatchedClusters: result.unmatchedClusters,
        failedClusters: result.failedClusters,
        automationMode: env.BUYFLOW_AUTOMATION_MODE,
      }, 'Tracking bridge resolver V2.1 recovery completed');
    }
  } catch (error) {
    app.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Tracking bridge resolver V2.1 recovery scan failed');
  }
}

app.post('/webhooks/nylas', async (request, reply) => {
  webhookStats.postsReceived += 1;
  const rawBody = request.body;
  if (!Buffer.isBuffer(rawBody)) return reply.code(400).send();

  let secret: string;
  try {
    secret = requireNylasWebhookSecret();
  } catch {
    request.log.error('Nylas webhook POST rejected because webhook secret is not configured');
    return reply.code(503).send();
  }

  const signature = request.headers['x-nylas-signature'];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;
  if (!verifyNylasSignature(rawBody, signatureValue, secret)) {
    webhookStats.invalidSignatures += 1;
    request.log.warn('Rejected Nylas webhook with invalid signature');
    return reply.code(401).send();
  }

  webhookStats.validSignatures += 1;
  const event = parseNylasMessageCreatedEvent(rawBody);
  if (!event) {
    webhookStats.unsupportedSignedEvents += 1;
    return reply.code(200).send();
  }

  webhookStats.parsedMessageCreated += 1;
  let inboxEventId: string;
  try {
    inboxEventId = await enqueueNylasMessageEvent({ grantId: event.grantId, messageId: event.messageId });
    webhookStats.inboxPersisted += 1;
  } catch (error) {
    webhookStats.inboxPersistenceFailed += 1;
    request.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Nylas webhook could not be persisted; returning retryable response');
    return reply.code(503).send();
  }

  setImmediate(() => { void runInboxEvent(inboxEventId); });
  return reply.code(200).send();
});

async function start() {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    void runRecovery();
    const recoveryTimer = setInterval(() => { void runRecovery(); }, 60_000);
    recoveryTimer.unref();
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();