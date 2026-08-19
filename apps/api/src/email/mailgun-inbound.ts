import crypto from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
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
  } catch { return []; }
}

function headerValue(headers: EmailHeader[], name: string): string | undefined {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

function normalizedReceivedAt(timestamp: string | undefined): string {
  const seconds = Number(timestamp);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  return new Date().toISOString();
}

export function normalizeMailgunInbound(fields: MailgunInboundFields, attachments: EmailAttachmentMetadata[] = []): MailgunShadowEnvelope {
  const recipient = fields.recipient?.trim().toLowerCase();
  const sender = fields.sender?.trim().toLowerCase();
  if (!recipient) throw new Error('Mailgun inbound payload is missing recipient');
  if (!sender) throw new Error('Mailgun inbound payload is missing sender');
  const headers = parseHeaders(fields['message-headers']);
  const from = parseAddress(fields.from) ?? parseAddress(sender);
  const to = parseAddress(recipient);
  const providerMessageId = headerValue(headers, 'Message-Id')?.trim()
    || `mailgun-${crypto.createHash('sha256').update(`${recipient}\n${sender}\n${fields.timestamp ?? ''}\n${fields.subject ?? ''}`).digest('hex')}`;
  return {
    recipient, sender, attachments,
    normalizedEmail: {
      provider: 'mailgun', providerMessageId,
      ...(fields.subject ? { subject: fields.subject } : {}),
      from: from ? [from] : [], to: to ? [to] : [], cc: [], bcc: [],
      receivedAt: normalizedReceivedAt(fields.timestamp),
      ...(fields['stripped-text'] || fields['body-plain'] ? { snippet: fields['stripped-text'] || fields['body-plain'] } : {}),
      ...(fields['body-html'] ? { bodyHtml: fields['body-html'] } : {}),
      headers, folders: ['inbound', 'mailgun-shadow'], attachments,
    },
  };
}

function bodyToFields(body: unknown): MailgunInboundFields {
  if (!body || typeof body !== 'object') return {};
  return Object.fromEntries(Object.entries(body as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')])) as MailgunInboundFields;
}

export async function registerMailgunInboundRoutes(app: FastifyInstance) {
  await app.register(async (scope) => {
    await scope.register(multipart, { limits: { fields: 100, files: 20, fileSize: 25 * 1024 * 1024, parts: 150 } });
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
      try {
        const encodedBody = typeof body === 'string' ? body : body.toString('utf8');
        done(null, Object.fromEntries(new URLSearchParams(encodedBody)));
      } catch (error) { done(error as Error, undefined); }
    });
    scope.post('/api/email/mailgun/inbound', async (request, reply) => {
      const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY?.trim();
      if (!signingKey) return reply.code(503).send({ ok: false, error: 'mailgun_not_configured' });
      let fields: MailgunInboundFields = {};
      const attachments: EmailAttachmentMetadata[] = [];
      if (request.isMultipart()) {
        let attachmentIndex = 0;
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            let size = 0;
            for await (const chunk of part.file) size += Buffer.byteLength(chunk);
            attachments.push({ id: `mailgun-attachment-${attachmentIndex}`, filename: part.filename || `attachment-${attachmentIndex}`, contentType: part.mimetype || 'application/octet-stream', size });
            attachmentIndex += 1;
          } else fields[part.fieldname as keyof MailgunInboundFields] = String(part.value ?? '');
        }
      } else fields = bodyToFields(request.body);
      if (!verifyMailgunSignature(fields, signingKey)) return reply.code(401).send({ ok: false, error: 'invalid_signature' });
      let envelope: MailgunShadowEnvelope;
      try { envelope = normalizeMailgunInbound(fields, attachments); }
      catch { return reply.code(400).send({ ok: false, error: 'invalid_payload' }); }
      request.log.info({ provider: 'mailgun', mode: 'shadow', recipient: envelope.recipient, sender: envelope.sender, providerMessageId: envelope.normalizedEmail.providerMessageId, attachmentCount: envelope.attachments.length }, 'Mailgun inbound message accepted in shadow mode; no production writes performed');
      return reply.code(200).send({ ok: true, mode: 'shadow', provider: 'mailgun', accepted: true, productionWrites: 0, attachmentCount: envelope.attachments.length });
    });
  });
}
