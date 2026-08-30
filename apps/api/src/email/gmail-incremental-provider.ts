import type { EmailProvider } from './provider.js';
import type {
  EmailAddress,
  EmailAttachmentMetadata,
  EmailHeader,
  NormalizedEmail,
  SearchMessagesInput,
  SearchMessagesPage,
} from './types.js';
import type {
  EmailChange,
  EmailChangePage,
  EmailSyncCursor,
  EmailWatchRegistration,
  IncrementalEmailProvider,
  InitialEmailSyncInput,
  InitialEmailSyncResult,
} from './incremental-provider.js';

interface GmailHeaderLike {
  name?: string;
  value?: string;
}

interface GmailBodyLike {
  attachmentId?: string;
  size?: number;
  data?: string;
}

interface GmailPartLike {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeaderLike[];
  body?: GmailBodyLike;
  parts?: GmailPartLike[];
}

interface GmailMessageLike {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPartLike;
  raw?: string;
}

interface GmailListResponse {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailProfileResponse {
  emailAddress?: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

interface GmailHistoryMessageRef {
  id?: string;
  threadId?: string;
}

interface GmailHistoryRecord {
  id?: string;
  messagesAdded?: Array<{ message?: GmailHistoryMessageRef }>;
  messagesDeleted?: Array<{ message?: GmailHistoryMessageRef }>;
  labelsAdded?: Array<{ message?: GmailHistoryMessageRef; labelIds?: string[] }>;
  labelsRemoved?: Array<{ message?: GmailHistoryMessageRef; labelIds?: string[] }>;
}

interface GmailHistoryResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  historyId?: string;
}

interface GmailWatchResponse {
  historyId?: string;
  expiration?: string;
}

type FetchLike = typeof fetch;
type AccessTokenSupplier = () => string | Promise<string>;

export interface GmailIncrementalEmailProviderConfig {
  getAccessToken: AccessTokenSupplier;
  userId?: string;
  pubsubTopicName?: string;
  watchLabelIds?: string[];
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    super(`Gmail API ${operation} failed with HTTP ${status}`);
    this.name = 'GmailApiError';
  }
}

function encodeBase64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function headersOf(payload: GmailPartLike | undefined): EmailHeader[] {
  return (payload?.headers ?? []).flatMap((header) => {
    const name = header.name?.trim();
    if (!name || header.value === undefined) return [];
    return [{ name, value: String(header.value) }];
  });
}

function headerValues(headers: EmailHeader[], name: string): string[] {
  const expected = name.toLowerCase();
  return headers
    .filter((header) => header.name.toLowerCase() === expected)
    .map((header) => header.value)
    .filter(Boolean);
}

function firstHeader(headers: EmailHeader[], name: string): string | undefined {
  return headerValues(headers, name)[0];
}

function splitAddressHeader(value: string): string[] {
  const output: string[] = [];
  let current = '';
  let quoted = false;
  let angleDepth = 0;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '<') angleDepth += 1;
    if (!quoted && char === '>' && angleDepth > 0) angleDepth -= 1;
    if (char === ',' && !quoted && angleDepth === 0) {
      if (current.trim()) output.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) output.push(current.trim());
  return output;
}

function parseAddress(value: string): EmailAddress | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const angle = trimmed.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (angle?.[2]) {
    const name = (angle[1] ?? '').trim().replace(/^"|"$/g, '').trim();
    return {
      email: angle[2].trim().toLowerCase(),
      ...(name ? { name } : {}),
    };
  }
  const plain = trimmed.match(/([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  return plain?.[1] ? { email: plain[1].toLowerCase() } : null;
}

function parseAddresses(headers: EmailHeader[], name: string): EmailAddress[] {
  const output: EmailAddress[] = [];
  for (const value of headerValues(headers, name)) {
    for (const candidate of splitAddressHeader(value)) {
      const parsed = parseAddress(candidate);
      if (parsed) output.push(parsed);
    }
  }
  const deduped = new Map<string, EmailAddress>();
  for (const address of output) {
    if (!deduped.has(address.email)) deduped.set(address.email, address);
  }
  return [...deduped.values()];
}

function decodedBody(part: GmailPartLike): string | null {
  const data = part.body?.data;
  if (!data) return null;
  try {
    return encodeBase64UrlToBuffer(data).toString('utf8');
  } catch {
    return null;
  }
}

function collectBodyParts(
  part: GmailPartLike | undefined,
  output: { plain: string[]; html: string[] },
  depth = 0,
) {
  if (!part || depth > 30) return;
  const mime = part.mimeType?.toLowerCase();
  if (mime === 'text/plain') {
    const value = decodedBody(part);
    if (value) output.plain.push(value);
  } else if (mime === 'text/html') {
    const value = decodedBody(part);
    if (value) output.html.push(value);
  }
  for (const child of part.parts ?? []) collectBodyParts(child, output, depth + 1);
}

function boundedJoin(values: string[], maxChars = 500_000): string | undefined {
  if (values.length === 0) return undefined;
  return values.join('\n').slice(0, maxChars) || undefined;
}

function collectAttachments(
  part: GmailPartLike | undefined,
  output: EmailAttachmentMetadata[],
  depth = 0,
) {
  if (!part || depth > 30 || output.length >= 200) return;
  const attachmentId = part.body?.attachmentId?.trim();
  const filename = part.filename?.trim();
  if (attachmentId) {
    output.push({
      id: attachmentId,
      filename: filename || `gmail-attachment-${output.length}`,
      contentType: part.mimeType?.trim() || 'application/octet-stream',
      ...(part.body?.size !== undefined ? { size: part.body.size } : {}),
      ...(firstHeader(headersOf(part), 'Content-ID')
        ? { contentId: firstHeader(headersOf(part), 'Content-ID')!.replace(/^<|>$/g, '') }
        : {}),
      ...(firstHeader(headersOf(part), 'Content-Disposition')?.toLowerCase().includes('inline')
        ? { isInline: true }
        : {}),
    });
  }
  for (const child of part.parts ?? []) collectAttachments(child, output, depth + 1);
}

export function normalizeGmailMessage(message: GmailMessageLike): NormalizedEmail {
  const providerMessageId = message.id?.trim();
  if (!providerMessageId) throw new Error('Gmail message is missing id');
  const headers = headersOf(message.payload);
  const bodies = { plain: [] as string[], html: [] as string[] };
  collectBodyParts(message.payload, bodies);
  const attachments: EmailAttachmentMetadata[] = [];
  collectAttachments(message.payload, attachments);
  const receivedAtMs = Number(message.internalDate);
  const receivedAt = Number.isFinite(receivedAtMs) && receivedAtMs > 0
    ? new Date(receivedAtMs).toISOString()
    : new Date(0).toISOString();
  const bodyText = boundedJoin(bodies.plain);
  const bodyHtml = boundedJoin(bodies.html);

  return {
    provider: 'gmail',
    providerMessageId,
    ...(message.threadId ? { providerThreadId: message.threadId } : {}),
    ...(firstHeader(headers, 'Subject') ? { subject: firstHeader(headers, 'Subject') } : {}),
    from: parseAddresses(headers, 'From'),
    to: parseAddresses(headers, 'To'),
    cc: parseAddresses(headers, 'Cc'),
    bcc: parseAddresses(headers, 'Bcc'),
    receivedAt,
    ...(message.snippet ? { snippet: message.snippet } : {}),
    ...(bodyText ? { bodyText } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
    headers,
    folders: [...(message.labelIds ?? [])],
    attachments,
  };
}

function cursor(value: string): EmailSyncCursor {
  return {
    provider: 'gmail',
    value,
    observedAt: new Date().toISOString(),
  };
}

function positiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

export class GmailIncrementalEmailProvider implements IncrementalEmailProvider, EmailProvider {
  readonly name = 'gmail' as const;

  private readonly userId: string;
  private readonly topicName: string | undefined;
  private readonly watchLabelIds: string[];
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: GmailIncrementalEmailProviderConfig) {
    this.userId = config.userId?.trim() || 'me';
    this.topicName = config.pubsubTopicName?.trim() || undefined;
    this.watchLabelIds = [...new Set((config.watchLabelIds ?? []).map((value) => value.trim()).filter(Boolean))];
    this.apiBaseUrl = (config.apiBaseUrl?.trim() || 'https://gmail.googleapis.com/gmail/v1').replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async requestJson<T>(
    operation: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = (await this.config.getAccessToken()).trim();
    if (!token) throw new Error('Gmail access token supplier returned an empty token');
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) throw new GmailApiError(response.status, operation);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  private userPath(suffix: string): string {
    return `/users/${encodeURIComponent(this.userId)}${suffix}`;
  }

  private async getProfile(): Promise<GmailProfileResponse> {
    return this.requestJson('profile.get', this.userPath('/profile'));
  }

  async searchMessages(input: SearchMessagesInput): Promise<SearchMessagesPage> {
    const params = new URLSearchParams({
      q: input.query,
      maxResults: String(positiveInteger(input.limit, 20, 500)),
    });
    if (input.cursor) params.set('pageToken', input.cursor);
    const list = await this.requestJson<GmailListResponse>('messages.list', this.userPath(`/messages?${params}`));
    const messages = await Promise.all(
      (list.messages ?? []).flatMap((item) => item.id ? [this.getMessage(item.id)] : []),
    );
    return {
      messages,
      ...(list.nextPageToken ? { nextCursor: list.nextPageToken } : {}),
    };
  }

  async getMessage(providerMessageId: string): Promise<NormalizedEmail> {
    const id = providerMessageId.trim();
    if (!id) throw new Error('Gmail provider message id is required');
    const message = await this.requestJson<GmailMessageLike>(
      'messages.get',
      this.userPath(`/messages/${encodeURIComponent(id)}?format=full`),
    );
    return normalizeGmailMessage(message);
  }

  async getRawMessage(providerMessageId: string): Promise<Buffer> {
    const id = providerMessageId.trim();
    if (!id) throw new Error('Gmail provider message id is required');
    const message = await this.requestJson<GmailMessageLike>(
      'messages.get.raw',
      this.userPath(`/messages/${encodeURIComponent(id)}?format=raw`),
    );
    if (!message.raw) throw new Error('Gmail raw message response did not contain raw MIME data');
    return encodeBase64UrlToBuffer(message.raw);
  }

  async downloadAttachment(providerMessageId: string, attachmentId: string): Promise<Buffer> {
    const messageId = providerMessageId.trim();
    const id = attachmentId.trim();
    if (!messageId || !id) throw new Error('Gmail message id and attachment id are required');
    const response = await this.requestJson<{ data?: string }>(
      'attachments.get',
      this.userPath(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(id)}`),
    );
    if (!response.data) throw new Error('Gmail attachment response did not contain data');
    return encodeBase64UrlToBuffer(response.data);
  }

  async initialSync(input: InitialEmailSyncInput): Promise<InitialEmailSyncResult> {
    // Capture the mailbox history cursor before reading the snapshot. Any change
    // racing with the initial scan will then be replayed by history.list rather
    // than being silently missed. Duplicate observations are safe downstream.
    const profile = await this.getProfile();
    if (!profile.historyId) throw new Error('Gmail profile did not contain historyId');

    const limit = positiveInteger(input.limit, 100, 5000);
    const messages: NormalizedEmail[] = [];
    let pageToken: string | undefined;
    while (messages.length < limit) {
      const page = await this.searchMessages({
        query: input.query,
        limit: Math.min(500, limit - messages.length),
        ...(pageToken ? { cursor: pageToken } : {}),
      });
      messages.push(...page.messages);
      if (!page.nextCursor) break;
      pageToken = page.nextCursor;
    }

    return {
      messages: messages.slice(0, limit),
      cursor: cursor(profile.historyId),
    };
  }

  async getChanges(inputCursor: EmailSyncCursor, limit?: number): Promise<EmailChangePage> {
    if (inputCursor.provider !== 'gmail' || !/^\d+$/.test(inputCursor.value)) {
      throw new Error('Gmail change cursor must be a numeric Gmail historyId');
    }

    const perPage = positiveInteger(limit, 100, 500);
    let pageToken: string | undefined;
    let latestHistoryId = inputCursor.value;
    const kindByMessage = new Map<string, 'message_created' | 'message_updated' | 'message_deleted'>();
    let pages = 0;

    try {
      do {
        pages += 1;
        if (pages > 1000) {
          throw new Error('Gmail history window exceeded safe pagination limit; cursor was not advanced');
        }
        const params = new URLSearchParams({
          startHistoryId: inputCursor.value,
          maxResults: String(perPage),
        });
        if (pageToken) params.set('pageToken', pageToken);
        const response = await this.requestJson<GmailHistoryResponse>(
          'history.list',
          this.userPath(`/history?${params}`),
        );
        if (response.historyId) latestHistoryId = response.historyId;

        for (const history of response.history ?? []) {
          for (const entry of history.messagesAdded ?? []) {
            const id = entry.message?.id?.trim();
            if (id) kindByMessage.set(id, 'message_created');
          }
          for (const entry of history.labelsAdded ?? []) {
            const id = entry.message?.id?.trim();
            if (id && !kindByMessage.has(id)) kindByMessage.set(id, 'message_updated');
          }
          for (const entry of history.labelsRemoved ?? []) {
            const id = entry.message?.id?.trim();
            if (id && !kindByMessage.has(id)) kindByMessage.set(id, 'message_updated');
          }
          for (const entry of history.messagesDeleted ?? []) {
            const id = entry.message?.id?.trim();
            if (id) kindByMessage.set(id, 'message_deleted');
          }
        }
        pageToken = response.nextPageToken;
      } while (pageToken);
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) {
        return {
          changes: [],
          nextCursor: inputCursor,
          resetRequired: true,
        };
      }
      throw error;
    }

    const changes: EmailChange[] = [];
    for (const [providerMessageId, kind] of kindByMessage) {
      if (kind === 'message_deleted') {
        changes.push({ kind, providerMessageId });
        continue;
      }
      try {
        changes.push({
          kind,
          providerMessageId,
          message: await this.getMessage(providerMessageId),
        });
      } catch (error) {
        // If the message disappeared between history.list and messages.get,
        // represent the strongest observable state: it is no longer readable.
        if (error instanceof GmailApiError && error.status === 404) {
          changes.push({ kind: 'message_deleted', providerMessageId });
          continue;
        }
        throw error;
      }
    }

    return {
      changes,
      nextCursor: cursor(latestHistoryId),
      resetRequired: false,
    };
  }

  async startWatch(): Promise<EmailWatchRegistration> {
    if (!this.topicName) {
      throw new Error('Gmail watch requires a configured Pub/Sub topic name');
    }
    const body: Record<string, unknown> = { topicName: this.topicName };
    if (this.watchLabelIds.length > 0) {
      body.labelIds = this.watchLabelIds;
      body.labelFilterBehavior = 'INCLUDE';
    }
    const response = await this.requestJson<GmailWatchResponse>(
      'users.watch',
      this.userPath('/watch'),
      { method: 'POST', body: JSON.stringify(body) },
    );
    const expirationMs = Number(response.expiration);
    return {
      expiresAt: Number.isFinite(expirationMs) && expirationMs > 0
        ? new Date(expirationMs).toISOString()
        : null,
      providerPayload: {
        ...(response.historyId ? { historyId: response.historyId } : {}),
      },
    };
  }

  async renewWatch(_registration: EmailWatchRegistration): Promise<EmailWatchRegistration> {
    return this.startWatch();
  }

  async stopWatch(_registration: EmailWatchRegistration): Promise<void> {
    await this.requestJson<void>(
      'users.stop',
      this.userPath('/stop'),
      { method: 'POST', body: JSON.stringify({}) },
    );
  }
}
