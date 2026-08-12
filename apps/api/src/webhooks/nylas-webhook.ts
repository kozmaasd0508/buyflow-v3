import { createHmac, timingSafeEqual } from 'node:crypto';

export interface NylasMessageCreatedEvent {
  type: 'message.created' | 'message.created.truncated' | 'message.created.cleaned';
  grantId: string;
  messageId: string;
}

export function verifyNylasSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signature.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function parseNylasMessageCreatedEvent(rawBody: Buffer): NylasMessageCreatedEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  const type = envelope.type;
  if (
    type !== 'message.created' &&
    type !== 'message.created.truncated' &&
    type !== 'message.created.cleaned'
  ) {
    return null;
  }

  const data = envelope.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const object = (data as Record<string, unknown>).object;
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null;

  const message = object as Record<string, unknown>;
  if (typeof message.id !== 'string' || typeof message.grant_id !== 'string') return null;

  return {
    type,
    grantId: message.grant_id,
    messageId: message.id,
  };
}
