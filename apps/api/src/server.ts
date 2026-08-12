import Fastify from 'fastify';
import { env, requireNylasWebhookSecret } from './config.js';
import { processNylasMessage } from './pipeline/automatic-email-pipeline.js';
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
  pipelineCompleted: 0,
  pipelineFailed: 0,
  unknownGrant: 0,
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
  version: '0.2.2',
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
    // A validly signed but unsupported notification is acknowledged so Nylas
    // does not retry it. This endpoint only acts on message.created variants.
    return reply.code(200).send();
  }

  webhookStats.parsedMessageCreated += 1;

  setImmediate(() => {
    void processNylasMessage({
      grantId: event.grantId,
      messageId: event.messageId,
      mode: env.BUYFLOW_AUTOMATION_MODE,
    })
      .then((result) => {
        webhookStats.pipelineCompleted += 1;
        if (result.status === 'unknown_grant') webhookStats.unknownGrant += 1;
        app.log.info({
          pipelineStatus: result.status,
          purchaseWrites: result.purchaseWrites,
          shipmentWrites: result.shipmentWrites,
          documentWrites: result.documentWrites,
          aiCalls: result.aiCalls,
          automationMode: env.BUYFLOW_AUTOMATION_MODE,
        }, 'Nylas message pipeline completed');
      })
      .catch((error) => {
        webhookStats.pipelineFailed += 1;
        app.log.error({
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }, 'Nylas message pipeline failed');
      });
  });

  return reply.code(200).send();
});

async function start() {
  try {
    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
