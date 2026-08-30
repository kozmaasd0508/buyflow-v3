import type { EmailProvider } from './provider.js';
import type { NormalizedEmail } from './types.js';

export interface EmailSyncCursor {
  provider: EmailProvider['name'];
  value: string;
  observedAt: string;
}

export type EmailChangeKind = 'message_created' | 'message_updated' | 'message_deleted';

export interface EmailChange {
  kind: EmailChangeKind;
  providerMessageId: string;
  message?: NormalizedEmail;
}

export interface EmailChangePage {
  changes: EmailChange[];
  nextCursor: EmailSyncCursor;
  /**
   * True when the provider can no longer continue incrementally from the supplied
   * cursor and the caller must perform a new initial sync.
   */
  resetRequired: boolean;
}

export interface EmailWatchRegistration {
  expiresAt: string | null;
  resourceId?: string | null;
  providerPayload?: Record<string, unknown>;
}

export interface InitialEmailSyncInput {
  query: string;
  limit?: number;
}

export interface InitialEmailSyncResult {
  messages: NormalizedEmail[];
  cursor: EmailSyncCursor;
}

/**
 * Capability contract for providers that support durable incremental sync.
 * Gmail implementations should map this to watch + historyId/history.list.
 * Outlook implementations can map it to change notifications + deltaLink.
 *
 * This interface is additive and does not change the existing EmailProvider
 * runtime contract until an implementation is promoted behind tests.
 */
export interface IncrementalEmailProvider extends EmailProvider {
  initialSync(input: InitialEmailSyncInput): Promise<InitialEmailSyncResult>;
  getChanges(cursor: EmailSyncCursor, limit?: number): Promise<EmailChangePage>;
  startWatch(): Promise<EmailWatchRegistration>;
  renewWatch(registration: EmailWatchRegistration): Promise<EmailWatchRegistration>;
  stopWatch(registration: EmailWatchRegistration): Promise<void>;
}
