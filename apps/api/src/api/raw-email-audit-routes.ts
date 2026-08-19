import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizeForwardedEml } from '../email/mailgun-inbound.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const MAX_MESSAGES = 50;
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

type ExpectedKind = 'commerce' | 'noise' | 'unknown';

interface AuditItem {
  id?: string;
  filename?: string;
  expectedKind?: ExpectedKind;
  rawMimeBase64: string;
}

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

function detectedCommerce(classification: string | null): boolean {
  return Boolean(classification && classification !== 'other' && !classification.startsWith('security_'));
}

function extractionSnapshot(result: Record<string, unknown>) {
  const products = Array.isArray(result.products)
    ? result.products.slice(0, 50).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      const name = stringOrNull(row.name);
      return name ? [{
        name,
        quantity: numberOrNull(row.quantity),
        unitPrice: numberOrNull(row.unit_price),
        totalPrice: numberOrNull(row.total_price),
        currency: stringOrNull(row.currency),
      }] : [];
    })
    : [];

  return {
    merchant: stringOrNull(result.merchant),
    orderNumber: stringOrNull(result.order_number),
    total: numberOrNull(result.total),
    currency: stringOrNull(result.currency),
    shippingAmount: numberOrNull(result.shipping_amount),
    codAmount: numberOrNull(result.cod_amount),
    codCurrency: stringOrNull(result.cod_currency),
    carrier: stringOrNull(result.carrier),
    paymentStatus: stringOrNull(result.payment_status),
    paymentMethod: stringOrNull(result.payment_method),
    shippingMethod: stringOrNull(result.shipping_method),
    trackingNumber: stringOrNull(result.tracking_number),
    products,
  };
}

export async function auditRawMimeBatch(messages: AuditItem[]) {
  if (messages.length === 0) throw new Error('empty_batch');
  if (messages.length > MAX_MESSAGES) throw new Error('too_many_messages');

  let totalBytes = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index]!;
    const raw = Buffer.from(item.rawMimeBase64 ?? '', 'base64');
    if (raw.length === 0) throw new Error(`empty_raw_mime:${index}`);
    if (raw.length > MAX_MESSAGE_BYTES) throw new Error(`message_too_large:${index}`);
    totalBytes += raw.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('batch_too_large');

    const id = stringOrNull(item.id) ?? `message-${index + 1}`;
    const expected: ExpectedKind = item.expectedKind === 'commerce' || item.expectedKind === 'noise'
      ? item.expectedKind
      : 'unknown';

    try {
      const email = await normalizeForwardedEml(raw, `audit-${id}`);
      const plan = planNormalizedInboundEmail({ email });
      const commerce = detectedCommerce(plan.classification);
      const verdict = expected === 'commerce'
        ? (commerce ? 'true_positive' : 'false_negative')
        : expected === 'noise'
          ? (commerce ? 'false_positive' : 'true_negative')
          : 'unscored';

      rows.push({
        id,
        filename: stringOrNull(item.filename),
        expectedKind: expected,
        sender: email.from[0]?.email ?? null,
        subject: email.subject ?? null,
        classification: plan.classification,
        parserVersion: plan.parserVersion,
        recognitionStatus: plan.status,
        validationStatus: plan.validationStatus,
        detectedCommerce: commerce,
        verdict,
        extraction: extractionSnapshot(plan.structuredResult),
        productionWrites: 0,
        aiCalls: 0,
      });
    } catch (error) {
      rows.push({
        id,
        filename: stringOrNull(item.filename),
        expectedKind: expected,
        error: error instanceof Error ? error.message : 'parse_failed',
        detectedCommerce: false,
        verdict: expected === 'commerce' ? 'false_negative' : expected === 'noise' ? 'true_negative' : 'unscored',
        productionWrites: 0,
        aiCalls: 0,
      });
    }
  }

  const count = (value: string) => rows.filter((row) => row.verdict === value).length;
  const tp = count('true_positive');
  const fn = count('false_negative');
  const fp = count('false_positive');
  const tn = count('true_negative');

  return {
    ok: true,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    total: rows.length,
    bytesProcessed: totalBytes,
    summary: {
      truePositive: tp,
      falseNegative: fn,
      falsePositive: fp,
      trueNegative: tn,
      unscored: count('unscored'),
      precision: tp + fp > 0 ? tp / (tp + fp) : null,
      recall: tp + fn > 0 ? tp / (tp + fn) : null,
    },
    rows,
  };
}

export async function registerRawEmailAuditRoutes(app: FastifyInstance) {
  app.post<{ Body: { messages?: AuditItem[] } }>(
    '/api/audit/eml-batch',
    { bodyLimit: 35 * 1024 * 1024 },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const messages = Array.isArray(request.body?.messages) ? request.body.messages : [];
      try {
        const result = await auditRawMimeBatch(messages);
        request.log.info({ userId: user.id, total: result.total, ...result.summary, productionWrites: 0, aiCalls: 0 }, 'Raw MIME batch audit completed');
        return reply.code(200).send(result);
      } catch (error) {
        return reply.code(400).send({
          ok: false,
          error: error instanceof Error ? error.message : 'invalid_audit_batch',
        });
      }
    },
  );
}
