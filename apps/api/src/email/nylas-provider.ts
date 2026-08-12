import Nylas from 'nylas';
import type { EmailProvider } from './provider.js';
import type {
  EmailAddress,
  EmailAttachmentMetadata,
  NormalizedEmail,
  SearchMessagesInput,
  SearchMessagesPage,
} from './types.js';

type NylasEmailName = {
  email: string;
  name?: string | null;
};

type NylasAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size?: number;
  isInline?: boolean;
  contentId?: string;
};

export type NylasMessageLike = {
  id: string;
  date: number;
  threadId?: string;
  subject?: string;
  from?: NylasEmailName[];
  to?: NylasEmailName[];
  cc?: NylasEmailName[];
  bcc?: NylasEmailName[];
  snippet?: string;
  body?: string;
  attachments?: NylasAttachment[];
};

export interface NylasEmailProviderConfig {
  apiKey: string;
  apiUri: string;
  grantId: string;
}

function normalizeAddresses(addresses?: NylasEmailName[]): EmailAddress[] {
  return (addresses ?? []).map((address) => ({
    email: address.email,
    ...(address.name ? { name: address.name } : {}),
  }));
}

function normalizeAttachments(
  attachments?: NylasAttachment[],
): EmailAttachmentMetadata[] {
  return (attachments ?? []).map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    ...(attachment.isInline !== undefined
      ? { isInline: attachment.isInline }
      : {}),
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
  }));
}

export function normalizeNylasMessage(
  message: NylasMessageLike,
): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    subject: message.subject,
    from: normalizeAddresses(message.from),
    to: normalizeAddresses(message.to),
    cc: normalizeAddresses(message.cc),
    bcc: normalizeAddresses(message.bcc),
    receivedAt: new Date(message.date * 1000).toISOString(),
    snippet: message.snippet,
    bodyHtml: message.body,
    attachments: normalizeAttachments(message.attachments),
  };
}

export class NylasEmailProvider implements EmailProvider {
  readonly name = 'nylas' as const;

  private readonly client: Nylas;
  private readonly grantId: string;

  constructor(config: NylasEmailProviderConfig) {
    this.client = new Nylas({
      apiKey: config.apiKey,
      apiUri: config.apiUri,
    });
    this.grantId = config.grantId;
  }

  async searchMessages(input: SearchMessagesInput): Promise<SearchMessagesPage> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 200);

    const response = await this.client.messages.list({
      identifier: this.grantId,
      queryParams: {
        limit,
        pageToken: input.cursor,
        searchQueryNative: input.query,
      },
    });

    return {
      messages: response.data.map((message) => normalizeNylasMessage(message)),
      nextCursor: response.nextCursor,
    };
  }

  async getMessage(providerMessageId: string): Promise<NormalizedEmail> {
    const response = await this.client.messages.find({
      identifier: this.grantId,
      messageId: providerMessageId,
    });

    return normalizeNylasMessage(response.data);
  }
}
