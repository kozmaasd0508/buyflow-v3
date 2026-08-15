import type {
  NormalizedEmail,
  SearchMessagesInput,
  SearchMessagesPage,
} from './types.js';

export interface EmailProvider {
  readonly name: 'nylas' | 'gmail';

  searchMessages(input: SearchMessagesInput): Promise<SearchMessagesPage>;

  getMessage(providerMessageId: string): Promise<NormalizedEmail>;

  downloadAttachment(providerMessageId: string, attachmentId: string): Promise<Buffer>;
}
