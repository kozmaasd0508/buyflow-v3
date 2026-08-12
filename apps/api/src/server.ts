import Fastify from 'fastify';
import { env, requireNylasWebhookSecret } from './config.js';
import {
  drainWebhookInbox,
  enqueueNylasMessageEvent,
  processWebhookInboxEvent,
} from './webhooks/webhook-inbox.js';
import {
  parseNylasMessageCreatedEvent,
  verifyNylasSignature,
} from './webhooks/nylas-webhook.js';

const app = Fastify({
  logger: true,
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
};

// Nylas signs the exact raw request body. Preserve raw bytes for its webhook
// while keeping normal JSON parsing behavior for future API routes.
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

app.get('/health', async () => ({
  ok: true,
  service: 'buyflow-api',
  version: '0.2.3',
  automationMode: env.BUYFLOW_AUTOMATION_MODE,
  webhook: { ...webhookStats },
}));

app.get<{ Querystring: { challenge?: string } }>('/webhooks/nylas', async (request, reply) => {
  const challenge = request.query.challenge;
  if (!challenge) {
    return reply.code(400).type('text/plain').send('missing challenge');
  }

  return reply
    .code(200)
    .type('text/plain')
    .header('Content-Length', Buffer.byteLength(challenge).toString())
    .send(challenge);
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
    app.log.error({
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }, 'Durable Nylas message pipeline failed and was scheduled for retry');
  }
}

async function runRecovery() {
  try {
    const result = await drainWebhookInbox(env.BUYFLOW_AUTOMATION_MODE);
    webhookStats.recoveryRuns += 1;
    webhookStats.recoveryClaimed += result.claimed;
    webhookStats.recoveryFailed += result.failed;
    if (result.claimed > 0 || result.failed > 0) {
      app.log.info({
        scanned: result.scanned,
        claimed: result.claimed,
        failed: result.failed,
      }, 'Webhook inbox recovery completed');
    }
  } catch (error) {
    webhookStats.recoveryFailed += 1;
    app.log.error({
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }, 'Webhook inbox recovery scan failed');
  }
}

app.post('/webhooks/nylas', async (request, reply) => {
  webhookStats.postsReceived += 1;

  const rawBody = request.body;
  if (!Buffer.isBuffer(rawBody)) {
    return reply.code(400).send();
  }

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
    // Validly signed notifications that this endpoint does not consume are
    // acknowledged so Nylas does not retry unsupported event types forever.
    return reply.code(200).send();
  }

  webhookStats.parsedMessageCreated += 1;

  let inboxEventId: string;
  try {
    // Durability boundary: do not acknowledge Nylas until the normalized event
    // identity is safely stored. Duplicate deliveries reuse the same row.
    inboxEventId = await enqueueNylasMessageEvent({
      grantId: event.grantId,
      messageId: event.messageId,
    });
    webhookStats.inboxPersisted += 1;
  } catch (error) {
    webhookStats.inboxPersistenceFailed += 1;
    request.log.error({
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }, 'Nylas webhook could not be persisted; returning retryable response');
    return reply.code(503).send();
  }

  setImmediate(() => {
    void runInboxEvent(inboxEventId);
  });

  return reply.code(200).send();
});

async function start() {
  try {
    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    // Recover queued or stale work after a deploy/restart. While the free
    // service is awake, retry due work every minute. The timer is not relied on
    // for durability; the database inbox is the source of truth.
    void runRecovery();
    const recoveryTimer = setInterval(() => {
      void runRecovery();
    }, 60_000);
    recoveryTimer.unref();
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
