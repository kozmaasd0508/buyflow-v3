export type EmailProviderName = 'nylas' | 'gmail' | 'ses';

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailHeader {
  name: string;
  value: string;
}

export interface EmailAttachmentMetadata {
  id: string;
  filename: string;
  contentType: string;
  size?: number;
  isInline?: boolean;
  contentId?: string;
}

export interface NormalizedEmail {
  provider: EmailProviderName;
  providerMessageId: string;
  providerThreadId?: string;
  subject?: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  receivedAt: string;
  snippet?: string;
  bodyHtml?: string;
  headers?: EmailHeader[];
  folders: string[];
  attachments: EmailAttachmentMetadata[];
}

export interface SearchMessagesInput {
  query: string;
  limit?: number;
  cursor?: string;
}

export interface SearchMessagesPage {
  messages: NormalizedEmail[];
  nextCursor?: string;
}
