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

const MAX_COMPLETE_SNAPSHOT_MESSAGES = 50_000;
const MAX_SNAPSHOT_PAGES = 1_000;
const DEFAULT_MESSAGE_FETCH_CONCURRENCY = 10;
const DEFAULT_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;

export interface GmailIncrementalEmailProviderConfig {
  getAccessToken: AccessTokenSupplier;
  userId?: string;
  pubsubTopicName?: string;
  watchLabelIds?: string[];
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  /** Test/operational override; production defaults to bounded exponential retry. */
  retryDelaysMs?: number[];
  /** Bound full-message fan-out so one list page cannot burst hundreds of gets. */
  messageFetchConcurrency?: number;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function collectDetachedBodyParts(
  part: GmailPartLike | undefined,
  output: GmailPartLike[],
  depth = 0,
) {
  if (!part || depth > 30 || output.length >= 200) return;
  const mime = part.mimeType?.toLowerCase();
  if (
    (mime === 'text/plain' || mime === 'text/html')
    && !part.body?.data
    && part.body?.attachmentId?.trim()
  ) {
    output.push(part);
  }
  for (const child of part.parts ?? []) collectDetachedBodyParts(child, output, depth + 1);
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
  const partHeaders = headersOf(part);
  const disposition = firstHeader(partHeaders, 'Content-Disposition');
  const mime = part.mimeType?.toLowerCase();
  const detachedBodyOnly = Boolean(
    attachmentId
    && (mime === 'text/plain' || mime === 'text/html')
    && !filename
    && !disposition,
  );
  if (attachmentId && !detachedBodyOnly) {
    output.push({
      id: attachmentId,
      filename: filename || `gmail-attachment-${output.length}`,
      contentType: part.mimeType?.trim() || 'application/octet-stream',
      ...(part.body?.size !== undefined ? { size: part.body.size } : {}),
      ...(firstHeader(partHeaders, 'Content-ID')
        ? { contentId: firstHeader(partHeaders, 'Content-ID')!.replace(/^<|>$/g, '') }
        : {}),
      ...(disposition?.toLowerCase().includes('inline')
        ? { isInline: true }
        : {}),
    });
  }
  for (const child of part.parts ?? []) collectAttachments(child, output, depth + 1);
}

function validIsoFromMilliseconds(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolveReceivedAt(message: GmailMessageLike, headers: EmailHeader[]): string {
  const internal = validIsoFromMilliseconds(Number(message.internalDate));
  if (internal) return internal;

  const dateHeader = firstHeader(headers, 'Date');
  if (dateHeader) {
    const parsed = Date.parse(dateHeader);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  // Missing provider time is evidence absence, not 1970. Fail closed so a
  // fabricated timestamp can never influence lifecycle ordering/correlation.
  throw new Error('Gmail message is missing a valid received timestamp');
}

export function normalizeGmailMessage(message: GmailMessageLike): NormalizedEmail {
  const providerMessageId = message.id?.trim();
  if (!providerMessageId) throw new Error('Gmail message is missing id');
  const headers = headersOf(message.payload);
  const bodies = { plain: [] as string[], html: [] as string[] };
  collectBodyParts(message.payload, bodies);
  const attachments: EmailAttachmentMetadata[] = [];
  collectAttachments(message.payload, attachments);
  const receivedAt = resolveReceivedAt(message, headers);
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

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function responseRetryDelay(response: Response, fallback: number): number {
  const retryAfter = response.headers.get('retry-after')?.trim();
  if (!retryAfter) return fallback;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.trunc(seconds * 1000), 30_000);
  }
  const date = Date.parse(retryAfter);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 30_000);
  }
  return fallback;
}

export class GmailIncrementalEmailProvider implements IncrementalEmailProvider, EmailProvider {
  readonly name = 'gmail' as const;

  private readonly userId: string;
  private readonly topicName: string | undefined;
  private readonly watchLabelIds: string[];
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly retryDelaysMs: number[];
  private readonly messageFetchConcurrency: number;

  constructor(private readonly config: GmailIncrementalEmailProviderConfig) {
    this.userId = config.userId?.trim() || 'me';
    this.topicName = config.pubsubTopicName?.trim() || undefined;
    this.watchLabelIds = [...new Set((config.watchLabelIds ?? []).map((value) => value.trim()).filter(Boolean))];
    this.apiBaseUrl = (config.apiBaseUrl?.trim() || 'https://gmail.googleapis.com/gmail/v1').replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.retryDelaysMs = (config.retryDelaysMs ?? [...DEFAULT_RETRY_DELAYS_MS])
      .map((value) => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0)
      .slice(0, 5);
    this.messageFetchConcurrency = positiveInteger(
      config.messageFetchConcurrency,
      DEFAULT_MESSAGE_FETCH_CONCURRENCY,
      25,
    );
  }

  private async requestJson<T>(
    operation: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = (await this.config.getAccessToken()).trim();
    if (!token) throw new Error('Gmail access token supplier returned an empty token');

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
          ...init,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers ?? {}),
          },
        });
      } catch (error) {
        if (attempt < this.retryDelaysMs.length) {
          await sleep(this.retryDelaysMs[attempt] ?? 0);
          continue;
        }
        throw error;
      }

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < this.retryDelaysMs.length) {
          await sleep(responseRetryDelay(response, this.retryDelaysMs[attempt] ?? 0));
          continue;
        }
        throw new GmailApiError(response.status, operation);
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    }
  }

  private userPath(suffix: string): string {
    return `/users/${encodeURIComponent(this.userId)}${suffix}`;
  }

  private async getProfile(): Promise<GmailProfileResponse> {
    return this.requestJson('profile.get', this.userPath('/profile'));
  }

  private async hydrateDetachedBodies(messageId: string, message: GmailMessageLike): Promise<void> {
    const parts: GmailPartLike[] = [];
    collectDetachedBodyParts(message.payload, parts);
    for (let offset = 0; offset < parts.length; offset += this.messageFetchConcurrency) {
      const batch = parts.slice(offset, offset + this.messageFetchConcurrency);
      await Promise.all(batch.map(async (part) => {
        const attachmentId = part.body?.attachmentId?.trim();
        if (!attachmentId) return;
        const bytes = await this.downloadAttachment(messageId, attachmentId);
        part.body ??= {};
        part.body.data = bytes.toString('base64url');
      }));
    }
  }

  async searchMessages(input: SearchMessagesInput): Promise<SearchMessagesPage> {
    const params = new URLSearchParams({
      q: input.query,
      maxResults: String(positiveInteger(input.limit, 20, 500)),
    });
    if (input.cursor) params.set('pageToken', input.cursor);
    const list = await this.requestJson<GmailListResponse>('messages.list', this.userPath(`/messages?${params}`));
    const refs = (list.messages ?? []).flatMap((item) => item.id ? [item.id] : []);
    const messages: NormalizedEmail[] = [];
    for (let offset = 0; offset < refs.length; offset += this.messageFetchConcurrency) {
      const batch = refs.slice(offset, offset + this.messageFetchConcurrency);
      messages.push(...await Promise.all(batch.map((id) => this.getMessage(id))));
    }
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
    await this.hydrateDetachedBodies(id, message);
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

    const completeSnapshot = input.completeSnapshot === true;
    const totalLimit = positiveInteger(input.limit, 100, 5000);
    const pageSize = completeSnapshot
      ? positiveInteger(input.limit, 500, 500)
      : Math.min(500, totalLimit);
    const messages: NormalizedEmail[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      pages += 1;
      if (pages > MAX_SNAPSHOT_PAGES) {
        throw new Error('Gmail initial snapshot exceeded safe pagination limit; cursor was not advanced');
      }
      const page = await this.searchMessages({
        query: input.query,
        limit: completeSnapshot ? pageSize : Math.min(pageSize, totalLimit - messages.length),
        ...(pageToken ? { cursor: pageToken } : {}),
      });
      messages.push(...page.messages);

      if (completeSnapshot && messages.length > MAX_COMPLETE_SNAPSHOT_MESSAGES) {
        throw new Error('Gmail initial snapshot exceeded safe message limit; cursor was not advanced');
      }
      if (!completeSnapshot && messages.length >= totalLimit) break;
      if (!page.nextCursor) break;
      pageToken = page.nextCursor;
    } while (pageToken);

    return {
      messages: completeSnapshot ? messages : messages.slice(0, totalLimit),
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
