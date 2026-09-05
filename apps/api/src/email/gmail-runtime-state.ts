import type { EmailSyncCursor, EmailWatchRegistration } from './incremental-provider.js';
import {
  ProviderCredentialCrypto,
  type EncryptedProviderSecret,
} from './provider-credential-crypto.js';

export interface GmailRuntimeDb {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface GmailSyncState {
  emailConnectionId: string;
  userId: string;
  cursor: EmailSyncCursor | null;
  watch: EmailWatchRegistration | null;
  syncStatus: 'idle' | 'syncing' | 'reset_required' | 'error';
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
}

function context(userId: string, emailConnectionId: string) {
  return { userId, emailConnectionId, provider: 'gmail' as const };
}

export async function saveGmailRefreshCredential(input: {
  db: GmailRuntimeDb;
  crypto: ProviderCredentialCrypto;
  userId: string;
  emailConnectionId: string;
  refreshToken: string;
  scopes: string[];
}): Promise<void> {
  const encrypted = input.crypto.encrypt(
    input.refreshToken,
    context(input.userId, input.emailConnectionId),
  );
  const { error } = await input.db
    .from('email_provider_credentials')
    .upsert({
      user_id: input.userId,
      email_connection_id: input.emailConnectionId,
      provider: 'gmail',
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_iv: encrypted.iv,
      refresh_token_auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
      scopes: [...new Set(input.scopes.map((scope) => scope.trim()).filter(Boolean))],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email_connection_id' });
  if (error) {
    throw new Error(`Failed to save encrypted Gmail credential: ${error.message ?? 'unknown database error'}`);
  }
}

export async function loadGmailRefreshCredential(input: {
  db: GmailRuntimeDb;
  crypto: ProviderCredentialCrypto;
  userId: string;
  emailConnectionId: string;
}): Promise<{ refreshToken: string; scopes: string[] }> {
  const { data, error } = await input.db
    .from('email_provider_credentials')
    .select('refresh_token_ciphertext,refresh_token_iv,refresh_token_auth_tag,key_version,scopes')
    .eq('user_id', input.userId)
    .eq('email_connection_id', input.emailConnectionId)
    .eq('provider', 'gmail')
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load Gmail credential: ${error.message ?? 'unknown database error'}`);
  }
  if (!data) throw new Error('Gmail credential is not available');
  const encrypted: EncryptedProviderSecret = {
    ciphertext: String(data.refresh_token_ciphertext ?? ''),
    iv: String(data.refresh_token_iv ?? ''),
    authTag: String(data.refresh_token_auth_tag ?? ''),
    keyVersion: Number(data.key_version),
  };
  const refreshToken = input.crypto.decrypt(
    encrypted,
    context(input.userId, input.emailConnectionId),
  );
  return {
    refreshToken,
    scopes: Array.isArray(data.scopes)
      ? data.scopes.map((scope: unknown) => String(scope)).filter(Boolean)
      : [],
  };
}

export async function ensureGmailSyncState(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  initialCursor?: EmailSyncCursor | null;
}): Promise<void> {
  if (input.initialCursor && input.initialCursor.provider !== 'gmail') {
    throw new Error('Gmail sync state requires a Gmail cursor');
  }
  const { error } = await input.db
    .from('email_sync_states')
    .upsert({
      email_connection_id: input.emailConnectionId,
      user_id: input.userId,
      provider: 'gmail',
      cursor_value: input.initialCursor?.value ?? null,
      cursor_observed_at: input.initialCursor?.observedAt ?? null,
      sync_status: 'idle',
      last_error_code: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email_connection_id', ignoreDuplicates: true });
  if (error) {
    throw new Error(`Failed to initialize Gmail sync state: ${error.message ?? 'unknown database error'}`);
  }
}

export async function loadGmailSyncState(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
}): Promise<GmailSyncState | null> {
  const { data, error } = await input.db
    .from('email_sync_states')
    .select('email_connection_id,user_id,cursor_value,cursor_observed_at,watch_expires_at,watch_resource_id,watch_payload,sync_status,last_synced_at,last_error_code')
    .eq('user_id', input.userId)
    .eq('email_connection_id', input.emailConnectionId)
    .eq('provider', 'gmail')
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load Gmail sync state: ${error.message ?? 'unknown database error'}`);
  }
  if (!data) return null;
  const cursorValue = typeof data.cursor_value === 'string' ? data.cursor_value : null;
  const cursorObservedAt = typeof data.cursor_observed_at === 'string' ? data.cursor_observed_at : null;
  const watchExpiresAt = typeof data.watch_expires_at === 'string' ? data.watch_expires_at : null;
  const watchResourceId = typeof data.watch_resource_id === 'string' ? data.watch_resource_id : null;
  const watchPayload = data.watch_payload && typeof data.watch_payload === 'object'
    ? data.watch_payload as Record<string, unknown>
    : {};
  return {
    emailConnectionId: String(data.email_connection_id),
    userId: String(data.user_id),
    cursor: cursorValue && cursorObservedAt
      ? { provider: 'gmail', value: cursorValue, observedAt: cursorObservedAt }
      : null,
    watch: watchExpiresAt || watchResourceId || Object.keys(watchPayload).length > 0
      ? {
        expiresAt: watchExpiresAt,
        ...(watchResourceId ? { resourceId: watchResourceId } : {}),
        providerPayload: watchPayload,
      }
      : null,
    syncStatus: data.sync_status as GmailSyncState['syncStatus'],
    lastSyncedAt: typeof data.last_synced_at === 'string' ? data.last_synced_at : null,
    lastErrorCode: typeof data.last_error_code === 'string' ? data.last_error_code : null,
  };
}

export async function commitGmailSyncCursor(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  expectedCursor: EmailSyncCursor | null;
  nextCursor: EmailSyncCursor;
}): Promise<boolean> {
  if (input.nextCursor.provider !== 'gmail' || input.expectedCursor?.provider === 'nylas') {
    throw new Error('Gmail cursor commit received a non-Gmail cursor');
  }
  const { data, error } = await input.db.rpc('commit_email_sync_cursor', {
    p_email_connection_id: input.emailConnectionId,
    p_user_id: input.userId,
    p_expected_cursor: input.expectedCursor?.value ?? null,
    p_next_cursor: input.nextCursor.value,
    p_cursor_observed_at: input.nextCursor.observedAt,
    p_last_synced_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Failed to commit Gmail sync cursor: ${error.message ?? 'unknown database error'}`);
  }
  return data === true;
}

export async function markGmailSyncResetRequired(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  errorCode?: string;
}): Promise<void> {
  const { error } = await input.db
    .from('email_sync_states')
    .update({
      sync_status: 'reset_required',
      last_error_code: input.errorCode ?? 'gmail_history_cursor_expired',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('email_connection_id', input.emailConnectionId)
    .eq('provider', 'gmail');
  if (error) {
    throw new Error(`Failed to mark Gmail sync reset: ${error.message ?? 'unknown database error'}`);
  }
}

export async function saveGmailWatchRegistration(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  registration: EmailWatchRegistration;
}): Promise<void> {
  const { error } = await input.db
    .from('email_sync_states')
    .update({
      watch_expires_at: input.registration.expiresAt,
      watch_resource_id: input.registration.resourceId ?? null,
      watch_payload: input.registration.providerPayload ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('email_connection_id', input.emailConnectionId)
    .eq('provider', 'gmail');
  if (error) {
    throw new Error(`Failed to save Gmail watch registration: ${error.message ?? 'unknown database error'}`);
  }
}
