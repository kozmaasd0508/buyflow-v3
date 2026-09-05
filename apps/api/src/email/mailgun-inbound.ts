import crypto from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { simpleParser } from 'mailparser';
import { env } from '../config.js';
import {
  persistNormalizedInboundEmail,
  planNormalizedInboundEmail,
} from '../pipeline/normalized-inbound-pipeline.js';
import type { EmailAddress, EmailAttachmentMetadata, EmailHeader, NormalizedEmail } from './types.js';

export interface MailgunSignatureFields {
  timestamp?: string;
  token?: string;
  signature?: string;
}

export interface MailgunInboundFields extends MailgunSignatureFields {
  recipient?: string;
  sender?: string;
  from?: string;
  subject?: string;
  'body-plain'?: string;
  'stripped-text'?: string;
  'body-html'?: string;
  'message-headers'?: string;
}

export interface MailgunShadowEnvelope {
  recipient: string;
  sender: string;
  normalizedEmail: NormalizedEmail;
  attachments: EmailAttachmentMetadata[];
}

interface RawEmlAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMailgunSignature(fields: MailgunSignatureFields, signingKey: string): boolean {
  const timestamp = fields.timestamp?.trim();
  const token = fields.token?.trim();
  const signature = fields.signature?.trim();
  if (!timestamp || !token || !signature || !signingKey.trim()) return false;
  const expected = crypto.createHmac('sha256', signingKey).update(`${timestamp}${token}`).digest('hex');
  return safeEqualHex(expected, signature);
}

function parseAddress(value: string | undefined): EmailAddress | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const angle = trimmed.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (angle?.[2]) {
    const name = (angle[1] ?? '').trim().replace(/^"|"$/g, '').trim();
    return { email: angle[2].toLowerCase(), ...(name ? { name } : {}) };
  }
  const plain = trimmed.match(/([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return plain?.[1] ? { email: plain[1].toLowerCase() } : null;
}

function parseHeaders(raw: string | undefined): EmailHeader[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return [];
      const name = String(entry[0] ?? '').trim();
      const value = String(entry[1] ?? '');
      return name ? [{ name, value }] : [];
    });
  } catch {
    return [];
  }
}

function headerValue(headers: EmailHeader[], name: string): string | undefined {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

function normalizedReceivedAt(timestamp: string | undefined): string {
  const seconds = Number(timestamp);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  return new Date().toISOString();
}

function parsedAddressList(value: { value?: Array<{ address?: string; name?: string }> } | undefined): EmailAddress[] {
  return (value?.value ?? []).flatMap((entry) => {
    const email = entry.address?.trim().toLowerCase();
    if (!email) return [];
    const name = entry.name?.trim();
    return [{ email, ...(name ? { name } : {}) }];
  });
}

function parsedHeaders(headers: Map<string, unknown>): EmailHeader[] {
  return [...headers.entries()].flatMap(([name, value]) => {
    if (!name.trim()) return [];
    if (Array.isArray(value)) {
      return value.map((item) => ({ name, value: String(item ?? '') }));
    }
    if (value instanceof Date) return [{ name, value: value.toISOString() }];
    if (value && typeof value === 'object') return [{ name, value: JSON.stringify(value) }];
    return [{ name, value: String(value ?? '') }];
  });
}

export async function normalizeForwardedEml(
  raw: Buffer,
  fallbackProviderMessageId: string,
): Promise<NormalizedEmail> {
  const parsed = await simpleParser(raw, {
    skipHtmlToText: true,
    skipTextToHtml: true,
  });

  const attachments: EmailAttachmentMetadata[] = parsed.attachments.map((attachment, index) => ({
    id: attachment.contentId || `eml-attachment-${index}`,
    filename: attachment.filename || `attachment-${index}`,
    contentType: attachment.contentType || 'application/octet-stream',
    size: attachment.size,
    ...(attachment.contentDisposition === 'inline' ? { isInline: true } : {}),
    ...(attachment.cid ? { contentId: attachment.cid } : {}),
  }));

  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : undefined;
  const receivedAt = parsed.date && !Number.isNaN(parsed.date.getTime())
    ? parsed.date.toISOString()
    : new Date().toISOString();

  return {
    provider: 'mailgun',
    providerMessageId: parsed.messageId?.trim() || fallbackProviderMessageId,
    ...(parsed.subject ? { subject: parsed.subject } : {}),
    from: parsedAddressList(parsed.from),
    to: parsedAddressList(Array.isArray(parsed.to) ? parsed.to[0] : parsed.to),
    cc: parsedAddressList(Array.isArray(parsed.cc) ? parsed.cc[0] : parsed.cc),
    bcc: parsedAddressList(Array.isArray(parsed.bcc) ? parsed.bcc[0] : parsed.bcc),
    receivedAt,
    ...(parsed.text ? { snippet: parsed.text, bodyText: parsed.text } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
    headers: parsedHeaders(parsed.headers as Map<string, unknown>),
    folders: ['inbound', 'mailgun-shadow', 'eml-expanded'],
    attachments,
  };
}

export function normalizeMailgunInbound(
  fields: MailgunInboundFields,
  attachments: EmailAttachmentMetadata[] = [],
): MailgunShadowEnvelope {
  const recipient = fields.recipient?.trim().toLowerCase();
  const sender = fields.sender?.trim().toLowerCase();
  if (!recipient) throw new Error('Mailgun inbound payload is missing recipient');
  if (!sender) throw new Error('Mailgun inbound payload is missing sender');

  const headers = parseHeaders(fields['message-headers']);
  const from = parseAddress(fields.from) ?? parseAddress(sender);
  const to = parseAddress(recipient);
  const providerMessageId = headerValue(headers, 'Message-Id')?.trim()
    || `mailgun-${crypto.createHash('sha256').update(`${recipient}\n${sender}\n${fields.timestamp ?? ''}\n${fields.subject ?? ''}`).digest('hex')}`;
  const bodyText = fields['stripped-text'] || fields['body-plain'];

  return {
    recipient,
    sender,
    attachments,
    normalizedEmail: {
      provider: 'mailgun',
      providerMessageId,
      ...(fields.subject ? { subject: fields.subject } : {}),
      from: from ? [from] : [],
      to: to ? [to] : [],
      cc: [],
      bcc: [],
      receivedAt: normalizedReceivedAt(fields.timestamp),
      ...(bodyText ? { snippet: bodyText, bodyText } : {}),
      ...(fields['body-html'] ? { bodyHtml: fields['body-html'] } : {}),
      headers,
      folders: ['inbound', 'mailgun-shadow'],
      attachments,
    },
  };
}

function bodyToFields(body: unknown): MailgunInboundFields {
  if (!body || typeof body !== 'object') return {};
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]),
  ) as MailgunInboundFields;
}

function isEmlAttachment(filename: string | undefined, mimetype: string | undefined): boolean {
  return mimetype?.toLowerCase() === 'message/rfc822'
    || Boolean(filename?.toLowerCase().endsWith('.eml'));
}

function shadowExtractionSnapshot(structuredResult: Record<string, unknown>) {
  const products = Array.isArray(structuredResult.products)
    ? structuredResult.products.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      const name = typeof row.name === 'string' ? row.name : null;
      const quantity = typeof row.quantity === 'number' ? row.quantity : null;
      const unitPrice = typeof row.unit_price === 'number' ? row.unit_price : null;
      const totalPrice = typeof row.total_price === 'number' ? row.total_price : null;
      const currency = typeof row.currency === 'string' ? row.currency : null;
      return name ? [{ name, quantity, unitPrice, totalPrice, currency }] : [];
    })
    : [];

  return {
    merchant: typeof structuredResult.merchant === 'string' ? structuredResult.merchant : null,
    orderNumber: typeof structuredResult.order_number === 'string' ? structuredResult.order_number : null,
    total: typeof structuredResult.total === 'number' ? structuredResult.total : null,
    currency: typeof structuredResult.currency === 'string' ? structuredResult.currency : null,
    shippingAmount: typeof structuredResult.shipping_amount === 'number' ? structuredResult.shipping_amount : null,
    codAmount: typeof structuredResult.cod_amount === 'number' ? structuredResult.cod_amount : null,
    codCurrency: typeof structuredResult.cod_currency === 'string' ? structuredResult.cod_currency : null,
    carrier: typeof structuredResult.carrier === 'string' ? structuredResult.carrier : null,
    paymentStatus: typeof structuredResult.payment_status === 'string' ? structuredResult.payment_status : null,
    paymentMethod: typeof structuredResult.payment_method === 'string' ? structuredResult.payment_method : null,
    shippingMethod: typeof structuredResult.shipping_method === 'string' ? structuredResult.shipping_method : null,
    trackingNumber: typeof structuredResult.tracking_number === 'string' ? structuredResult.tracking_number : null,
    products,
  };
}

export async function registerMailgunInboundRoutes(app: FastifyInstance) {
  await app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fields: 100, files: 20, fileSize: 25 * 1024 * 1024, parts: 150 },
    });

    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => {
        try {
          const encodedBody = typeof body === 'string' ? body : body.toString('utf8');
          done(null, Object.fromEntries(new URLSearchParams(encodedBody)));
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );

    scope.post('/api/email/mailgun/inbound', async (request, reply) => {
      const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY?.trim();
      if (!signingKey) {
        return reply.code(503).send({ ok: false, error: 'mailgun_not_configured' });
      }

      let fields: MailgunInboundFields = {};
      const attachments: EmailAttachmentMetadata[] = [];
      const emlCandidates: RawEmlAttachment[] = [];

      if (request.isMultipart()) {
        let attachmentIndex = 0;
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            const chunks: Buffer[] = [];
            let size = 0;
            const captureEml = isEmlAttachment(part.filename, part.mimetype);
            for await (const chunk of part.file) {
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              size += buffer.length;
              if (captureEml) chunks.push(buffer);
            }
            const filename = part.filename || `attachment-${attachmentIndex}`;
            const contentType = part.mimetype || 'application/octet-stream';
            attachments.push({
              id: `mailgun-attachment-${attachmentIndex}`,
              filename,
              contentType,
              size,
            });
            if (captureEml) {
              emlCandidates.push({ filename, contentType, content: Buffer.concat(chunks) });
            }
            attachmentIndex += 1;
          } else {
            fields[part.fieldname as keyof MailgunInboundFields] = String(part.value ?? '');
          }
        }
      } else {
        fields = bodyToFields(request.body);
      }

      if (!verifyMailgunSignature(fields, signingKey)) {
        return reply.code(401).send({ ok: false, error: 'invalid_signature' });
      }

      let envelope: MailgunShadowEnvelope;
      try {
        envelope = normalizeMailgunInbound(fields, attachments);
      } catch {
        return reply.code(400).send({ ok: false, error: 'invalid_payload' });
      }

      let effectiveEmail = envelope.normalizedEmail;
      let emlExpanded = false;
      let emlFilename: string | null = null;
      let rawEmlSource: RawEmlAttachment | null = null;

      if (emlCandidates.length > 0) {
        try {
          const candidate = emlCandidates[0]!;
          effectiveEmail = await normalizeForwardedEml(
            candidate.content,
            envelope.normalizedEmail.providerMessageId,
          );
          emlExpanded = true;
          emlFilename = candidate.filename;
          rawEmlSource = candidate;
        } catch (error) {
          request.log.warn({
            errorType: error instanceof Error ? error.name : 'UnknownError',
            filename: emlCandidates[0]?.filename,
          }, 'Forwarded EML attachment could not be expanded; falling back to outer Mailgun message');
        }
      }

      const plan = planNormalizedInboundEmail({ email: effectiveEmail });
      const extraction = shadowExtractionSnapshot(plan.structuredResult);
      const sourcePersistenceEnabled = env.BUYFLOW_MAILGUN_SOURCE_PERSIST_ENABLED
        && env.BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED;
      let sourcePersistence: {
        enabled: boolean;
        status: string | null;
        archived: boolean;
        deduped: boolean | null;
      } = {
        enabled: sourcePersistenceEnabled,
        status: null,
        archived: false,
        deduped: null,
      };

      if (sourcePersistenceEnabled) {
        try {
          const persisted = await persistNormalizedInboundEmail({
            email: effectiveEmail,
            recipientAddress: envelope.recipient,
            sourceQuery: 'mailgun:inbound',
            sourceArchiveEnabled: true,
            ...(rawEmlSource ? {
              rawSource: {
                bytes: rawEmlSource.content,
                contentType: rawEmlSource.contentType || 'message/rfc822',
              },
            } : {}),
          });
          sourcePersistence = {
            enabled: true,
            status: persisted.status,
            archived: persisted.sourceArchived === true,
            deduped: persisted.deduped ?? null,
          };
        } catch (error) {
          request.log.error({
            errorType: error instanceof Error ? error.name : 'UnknownError',
          }, 'Mailgun source persistence failed closed; requesting webhook retry');
          return reply.code(503).send({
            ok: false,
            error: 'source_persistence_failed',
            mode: 'shadow',
            provider: 'mailgun',
            productionCommerceWrites: 0,
          });
        }
      }

      request.log.info({
        provider: 'mailgun',
        mode: 'shadow',
        recipient: envelope.recipient,
        sender: envelope.sender,
        effectiveSender: effectiveEmail.from[0]?.email ?? null,
        providerMessageId: effectiveEmail.providerMessageId,
        attachmentCount: envelope.attachments.length,
        effectiveAttachmentCount: effectiveEmail.attachments.length,
        emlExpanded,
        emlFilename,
        recognitionStatus: plan.status,
        classification: plan.classification,
        parserVersion: plan.parserVersion,
        validationStatus: plan.validationStatus,
        extraction,
        sourcePersistence,
      }, 'Mailgun inbound evaluated in shadow mode; Purchase/Shipment/Document writes remain disabled');

      return reply.code(200).send({
        ok: true,
        mode: 'shadow',
        provider: 'mailgun',
        accepted: true,
        productionWrites: 0,
        productionCommerceWrites: 0,
        sourcePersistence,
        attachmentCount: envelope.attachments.length,
        emlExpanded,
        recognition: {
          status: plan.status,
          classification: plan.classification,
          parserVersion: plan.parserVersion,
          validationStatus: plan.validationStatus,
          extraction,
        },
      });
    });
  });
}
