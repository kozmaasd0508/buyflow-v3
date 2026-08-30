import { GmailIncrementalEmailProvider } from './gmail-incremental-provider.js';
import {
  GoogleGmailOAuthClient,
  assertGmailReadonlyScope,
} from './gmail-oauth.js';
import type {
  EmailChangePage,
  EmailSyncCursor,
  EmailWatchRegistration,
  InitialEmailSyncInput,
  InitialEmailSyncResult,
} from './incremental-provider.js';
import { ProviderCredentialCrypto } from './provider-credential-crypto.js';
import {
  commitGmailSyncCursor,
  ensureGmailSyncState,
  loadGmailRefreshCredential,
  loadGmailSyncState,
  markGmailSyncResetRequired,
  saveGmailWatchRegistration,
  type GmailRuntimeDb,
} from './gmail-runtime-state.js';

export interface GmailCursorCheckpoint {
  expectedCursor: EmailSyncCursor | null;
  nextCursor: EmailSyncCursor;
}

export interface GmailInitialSyncRead {
  result: InitialEmailSyncResult;
  checkpoint: GmailCursorCheckpoint;
}

export interface GmailChangesRead {
  page: EmailChangePage;
  checkpoint: GmailCursorCheckpoint | null;
}

export interface GmailRuntimeProviderConfig {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  credentialCrypto: ProviderCredentialCrypto;
  oauthClient: GoogleGmailOAuthClient;
  pubsubTopicName?: string | null;
  watchLabelIds?: string[];
  fetchImpl?: typeof fetch;
}

interface CachedAccessToken {
  value: string;
  expiresAtMs: number;
}

/**
 * Server-only direct Gmail adapter.
 *
 * Important durability rule: reading messages/history never advances the DB
 * cursor. Call commitCheckpoint only after downstream source persistence has
 * succeeded. This keeps provider observation separate from Purchase authority.
 */
export class GmailRuntimeProvider {
  private cachedAccessToken: CachedAccessToken | null = null;
  readonly provider: GmailIncrementalEmailProvider;

  constructor(private readonly config: GmailRuntimeProviderConfig) {
    this.provider = new GmailIncrementalEmailProvider({
      getAccessToken: () => this.getAccessToken(),
      pubsubTopicName: config.pubsubTopicName ?? undefined,
      watchLabelIds: config.watchLabelIds,
      fetchImpl: config.fetchImpl,
    });
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs - now > 60_000) {
      return this.cachedAccessToken.value;
    }
    const credential = await loadGmailRefreshCredential({
      db: this.config.db,
      crypto: this.config.credentialCrypto,
      userId: this.config.userId,
      emailConnectionId: this.config.emailConnectionId,
    });
    // Scope is stored at the original authorization boundary. A refresh token
    // response can omit the scope field, so validate the durable grant before
    // asking Google for a new short-lived access token.
    assertGmailReadonlyScope(credential.scopes);
    const refreshed = await this.config.oauthClient.refreshAccessToken(credential.refreshToken);
    const expiry = Date.parse(refreshed.expiresAt);
    this.cachedAccessToken = {
      value: refreshed.accessToken,
      expiresAtMs: Number.isFinite(expiry) ? expiry : now + 30 * 60_000,
    };
    return refreshed.accessToken;
  }

  async readInitialSync(input: InitialEmailSyncInput): Promise<GmailInitialSyncRead> {
    await ensureGmailSyncState({
      db: this.config.db,
      userId: this.config.userId,
      emailConnectionId: this.config.emailConnectionId,
    });
    const state = await loadGmailSyncState({
      db: this.config.db,
      userId: this.config.userId,
      emailConnectionId: this.config.emailConnectionId,
    });
    const result = await this.provider.initialSync(input);
    return {
      result,
      checkpoint: {
        expectedCursor: state?.cursor ?? null,
        nextCursor: result.cursor,
      },
    };
  }

  async readChanges(limit?: number): Promise<GmailChangesRead> {
    const state = await loadGmailSyncState({
      db: this.config.db,
      userId: this.config.userId,
      emailConnectionId: this.config.emailConnectionId,
    });
    if (!state?.cursor) {
      throw new Error('Gmail incremental sync has no committed cursor; initial sync is required');
    }
    const page = await this.provider.getChanges(state.cursor, limit);
    if (page.resetRequired) {
      await markGmailSyncResetRequired({
        db: this.config.db,
        userId: this.config.userId,
        emailConnectionId: this.config.emailConnectionId,
      });
      return { page, checkpoint: null };
    }
    return {
      page,
      checkpoint: {
        expectedCursor: state.cursor,
        nextCursor: page.nextCursor,
      },
    };
  }

  async commitCheckpoint(checkpoint: GmailCursorCheckpoint): Promise<void> {
    const committed = await commitGmailSyncCursor({
      db: this.config.db,
      userId: this.config.userId,
      emailConnectionId: this.config.emailConnectionId,
      expectedCursor: checkpoint.expectedCursor,
      nextCursor: checkpoint.nextCursor,
    });
    if (!committed) {
      throw new Error('Gmail sync cursor changed concurrently; stale checkpoint was not committed');
    }
  }

  async startOrRenewWatch(): Promise<EmailWatchRegistration> {
    const state = await loadGmailSyncState({
      db: this.config.db,
      userId: this.config.userId,
      emailConnectionId: this.config.emailConnectionId,
    });
    const registration = state?.watch
      ? await this.provider.renewWatch(state.watch)
      : await this.provider.startWatch();
    await saveGmailWatchRegistration({
      db: this.config.db,
      userId: this.config.userId,
      emailConnectionId: this.config.emailConnectionId,
      registration,
    });
    return registration;
  }

  getRawMessage(providerMessageId: string): Promise<Buffer> {
    return this.provider.getRawMessage(providerMessageId);
  }
}
