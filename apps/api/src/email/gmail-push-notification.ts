const MAX_PUBSUB_DATA_BYTES = 16 * 1024;

export interface GmailPushNotification {
  emailAddress: string;
  historyId: string;
  messageId: string | null;
  publishTime: string | null;
}

interface PubSubEnvelopeLike {
  message?: {
    data?: string;
    messageId?: string;
    message_id?: string;
    publishTime?: string;
    publish_time?: string;
  };
}

interface GmailPushDataLike {
  emailAddress?: string;
  historyId?: string | number;
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizedHistoryId(value: unknown): string | null {
  const candidate = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  return /^\d+$/.test(candidate) ? candidate : null;
}

export function parseGmailPubSubEnvelope(body: unknown): GmailPushNotification {
  if (!body || typeof body !== 'object') {
    throw new Error('Gmail Pub/Sub body is invalid');
  }
  const envelope = body as PubSubEnvelopeLike;
  const encoded = envelope.message?.data?.trim();
  if (!encoded || encoded.length > MAX_PUBSUB_DATA_BYTES * 2) {
    throw new Error('Gmail Pub/Sub message data is missing or too large');
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, 'base64');
  } catch {
    throw new Error('Gmail Pub/Sub message data is not valid base64');
  }
  if (decoded.byteLength === 0 || decoded.byteLength > MAX_PUBSUB_DATA_BYTES) {
    throw new Error('Gmail Pub/Sub decoded data is empty or too large');
  }

  let data: GmailPushDataLike;
  try {
    data = JSON.parse(decoded.toString('utf8')) as GmailPushDataLike;
  } catch {
    throw new Error('Gmail Pub/Sub decoded data is not valid JSON');
  }
  const emailAddress = normalizedEmail(data.emailAddress);
  const historyId = normalizedHistoryId(data.historyId);
  if (!emailAddress || !historyId) {
    throw new Error('Gmail Pub/Sub notification is missing valid emailAddress/historyId');
  }

  const rawMessageId = envelope.message?.messageId ?? envelope.message?.message_id;
  const rawPublishTime = envelope.message?.publishTime ?? envelope.message?.publish_time;
  return {
    emailAddress,
    historyId,
    messageId: typeof rawMessageId === 'string' && rawMessageId.trim()
      ? rawMessageId.trim().slice(0, 256)
      : null,
    publishTime: typeof rawPublishTime === 'string' && !Number.isNaN(Date.parse(rawPublishTime))
      ? new Date(rawPublishTime).toISOString()
      : null,
  };
}
