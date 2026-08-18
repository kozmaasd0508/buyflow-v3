import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import {
  normalizeSesInboundMetadata,
  toNormalizedSesEmail,
  type SesInboundNotificationLike,
} from '../email/ses-inbound.js';
import type { EmailAttachmentMetadata, NormalizedEmail } from '../email/types.js';
import {
  persistNormalizedInboundEmail,
  type NormalizedInboundPersistResult,
} from '../pipeline/normalized-inbound-pipeline.js';

const MAX_HTML_CHARS = 250_000;
const MAX_SNIPPET_CHARS = 50_000;
const MAX_ATTACHMENTS = 100;

export interface SesInboundBridgePayload {
  notification: SesInboundNotificationLike;
  bodyHtml?: string;
  snippet?: string;
  attachments?: EmailAttachmentMetadata[];
}

export interface PreparedSesInboundBridge {
  recipients: string[];
  email: NormalizedEmail;
  security: {
    disposition: 'accept' | 'quarantine' | 'reject';
    signals: ReturnType<typeof normalizeSesInboundMetadata>['security'];
  };
}

export interface SesInboundBridgeResult {
  ok: true;
  status: 'accepted' | 'no_buyflow_recipient';
  providerMessageId?: string;
  recipients: Array<{
    address: string;
    status: NormalizedInboundPersistResult['status'];
    sourceEmailId?: string;
    deduped?: boolean;
  }>;
  purchaseWrites: 0;
  shipmentWrites: 0;
  documentWrites: 0;
  aiCalls: 0;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function clippedString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxChars) : undefined;
}

function normalizeAttachments(value: unknown): EmailAttachmentMetadata[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const rows: EmailAttachmentMetadata[] = [];
  for (const raw of value.slice(0, MAX_ATTACHMENTS)) {
    const item = objectOrNull(raw);
    if (!item) continue;

    const id = clippedString(item.id, 512);
    const filename = clippedString(item.filename, 512);
    const contentType = clippedString(item.contentType, 200);
    if (!id || !filename || !contentType) continue;

    const size = typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0
      ? Math.trunc(item.size)
      : undefined;
    const contentId = clippedString(item.contentId, 512);

    rows.push({
      id,
      filename,
      contentType,
      ...(size !== undefined ? { size } : {}),
      ...(typeof item.isInline === 'boolean' ? { isInline: item.isInline } : {}),
      ...(contentId ? { contentId } : {}),
    });
  }

  return rows.length > 0 ? rows : undefined;
}

export function normalizeSesInboundBridgePayload(value: unknown): SesInboundBridgePayload {
  const payload = objectOrNull(value);
  const notification = objectOrNull(payload?.notification);
  if (!payload || !notification) {
    throw new Error('SES bridge payload is missing notification');
  }

  const bodyHtml = clippedString(payload.bodyHtml, MAX_HTML_CHARS);
  const snippet = clippedString(payload.snippet, MAX_SNIPPET_CHARS);
  const attachments = normalizeAttachments(payload.attachments);

  return {
    notification: notification as SesInboundNotificationLike,
    ...(bodyHtml ? { bodyHtml } : {}),
    ...(snippet ? { snippet } : {}),
    ...(attachments ? { attachments } : {}),
  };
}

export function prepareSesInboundBridge(
  payload: SesInboundBridgePayload,
  buyflowDomain = 'buyflow.hu',
): PreparedSesInboundBridge {
  const metadata = normalizeSesInboundMetadata(payload.notification, buyflowDomain);
  return {
    recipients: metadata.buyflowRecipients,
    email: toNormalizedSesEmail({
      metadata,
      bodyHtml: payload.bodyHtml,
      snippet: payload.snippet,
      attachments: payload.attachments,
    }),
    security: {
      disposition: metadata.disposition,
      signals: metadata.security,
    },
  };
}

export function sesInboundRuntimeConfig(
  values: NodeJS.ProcessEnv = process.env,
): { enabled: boolean; secret: string | null } {
  const enabled = values.BUYFLOW_SES_INGEST_ENABLED?.trim().toLowerCase() === 'true';
  const candidate = values.BUYFLOW_SES_INGEST_SECRET?.trim() ?? '';
  return {
    enabled,
    secret: candidate.length >= 32 ? candidate : null,
  };
}

export function verifySesInboundSecret(presented: unknown, expected: string): boolean {
  const value = Array.isArray(presented) ? presented[0] : presented;
  if (typeof value !== 'string' || !value) return false;

  const received = Buffer.from(value, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (received.length !== wanted.length) return false;
  return timingSafeEqual(received, wanted);
}

export async function processSesInboundBridge(input: {
  payload: SesInboundBridgePayload;
  db?: any;
}): Promise<SesInboundBridgeResult> {
  const prepared = prepareSesInboundBridge(input.payload);
  if (prepared.recipients.length === 0) {
    return {
      ok: true,
      status: 'no_buyflow_recipient',
      recipients: [],
      purchaseWrites: 0,
      shipmentWrites: 0,
      documentWrites: 0,
      aiCalls: 0,
    };
  }

  const db = input.db ?? (getSupabaseAdmin() as any);
  const results: SesInboundBridgeResult['recipients'] = [];

  for (const address of prepared.recipients) {
    const result = await persistNormalizedInboundEmail({
      db,
      email: prepared.email,
      recipientAddress: address,
      security: prepared.security,
      sourceQuery: 'ses:receipt-bridge',
    });

    results.push({
      address,
      status: result.status,
      ...(result.sourceEmailId ? { sourceEmailId: result.sourceEmailId } : {}),
      ...(result.deduped !== undefined ? { deduped: result.deduped } : {}),
    });
  }

  return {
    ok: true,
    status: 'accepted',
    providerMessageId: prepared.email.providerMessageId,
    recipients: results,
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
    aiCalls: 0,
  };
}

export async function registerSesInboundRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>('/webhooks/ses/inbound', async (request, reply) => {
    const runtime = sesInboundRuntimeConfig();
    if (!runtime.enabled) {
      return reply.code(503).send({ error: 'ses_ingest_disabled' });
    }
    if (!runtime.secret) {
      request.log.error('SES ingest is enabled but BUYFLOW_SES_INGEST_SECRET is not safely configured');
      return reply.code(503).send({ error: 'ses_ingest_not_configured' });
    }

    if (!verifySesInboundSecret(request.headers['x-buyflow-ses-secret'], runtime.secret)) {
      request.log.warn('Rejected SES inbound bridge request with invalid shared secret');
      return reply.code(401).send({ error: 'invalid_ses_ingest_secret' });
    }

    let payload: SesInboundBridgePayload;
    try {
      payload = normalizeSesInboundBridgePayload(request.body);
    } catch {
      return reply.code(400).send({ error: 'invalid_ses_inbound_payload' });
    }

    try {
      const result = await processSesInboundBridge({ payload });
      return reply.code(200).send(result);
    } catch (error) {
      request.log.error({
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }, 'SES inbound bridge processing failed');
      return reply.code(500).send({ error: 'ses_inbound_processing_failed' });
    }
  });
}
