import { env, requireGmailDirectRuntimeConfig } from '../config.js';
import { GoogleGmailOAuthClient } from './gmail-oauth.js';
import { GmailRuntimeProvider } from './gmail-runtime-provider.js';
import { ProviderCredentialCrypto } from './provider-credential-crypto.js';
import type { GmailRuntimeDb } from './gmail-runtime-state.js';
import {
  persistNormalizedEmailForResolvedRecipient,
  planNormalizedInboundEmail,
  type NormalizedInboundPersistResult,
} from '../pipeline/normalized-inbound-pipeline.js';

export interface GmailDirectSyncSummary {
  mode: 'initial' | 'incremental';
  observed: number;
  persisted: number;
  deduped: number;
  ignored: number;
  review: number;
  recognized: number;
  archived: number;
  deleted: number;
  resetRequired: boolean;
  cursorCommitted: boolean;
  purchaseWrites: 0;
  shipmentWrites: 0;
  documentWrites: 0;
  aiCalls: 0;
}

interface GmailConnectionRow {
  id: string;
  user_id: string;
  email_address: string;
}

function baseSummary(mode: GmailDirectSyncSummary['mode']): GmailDirectSyncSummary {
  return {
    mode,
    observed: 0,
    persisted: 0,
    deduped: 0,
    ignored: 0,
    review: 0,
    recognized: 0,
    archived: 0,
    deleted: 0,
    resetRequired: false,
    cursorCommitted: false,
    purchaseWrites: 0,
    shipmentWrites: 0,
    documentWrites: 0,
    aiCalls: 0,
  };
}

function addPersistResult(summary: GmailDirectSyncSummary, result: NormalizedInboundPersistResult) {
  if (result.status === 'non_commerce_ignored') summary.ignored += 1;
  if (result.status === 'review' || result.status === 'quarantined') summary.review += 1;
  if (result.status === 'recognized') summary.recognized += 1;
  if (result.deduped) summary.deduped += 1;
  else if (result.sourceEmailId) summary.persisted += 1;
  if (result.sourceArchived) summary.archived += 1;
}

async function requireActiveGmailConnection(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
}): Promise<GmailConnectionRow> {
  const { data, error } = await input.db
    .from('email_connections')
    .select('id,user_id,email_address')
    .eq('id', input.emailConnectionId)
    .eq('user_id', input.userId)
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load direct Gmail connection: ${error.message ?? 'unknown database error'}`);
  }
  if (!data) throw new Error('Active direct Gmail connection was not found');
  return data as GmailConnectionRow;
}

export async function createDirectGmailRuntime(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ connection: GmailConnectionRow; runtime: GmailRuntimeProvider }> {
  const runtimeConfig = requireGmailDirectRuntimeConfig();
  const connection = await requireActiveGmailConnection(input);
  const redirectUri = `${env.BUYFLOW_PUBLIC_BASE_URL.replace(/\/$/, '')}/auth/google/gmail/callback`;
  const oauthClient = new GoogleGmailOAuthClient({
    clientId: runtimeConfig.clientId,
    clientSecret: runtimeConfig.clientSecret,
    redirectUri,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  const credentialCrypto = new ProviderCredentialCrypto(
    runtimeConfig.credentialKeyBase64,
  );
  const runtime = new GmailRuntimeProvider({
    db: input.db,
    userId: input.userId,
    emailConnectionId: input.emailConnectionId,
    credentialCrypto,
    oauthClient,
    pubsubTopicName: runtimeConfig.pubsubTopicName,
    watchLabelIds: ['INBOX'],
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  return { connection, runtime };
}

async function persistObservedMessage(input: {
  db: GmailRuntimeDb;
  runtime: GmailRuntimeProvider;
  connection: GmailConnectionRow;
  email: Parameters<typeof planNormalizedInboundEmail>[0]['email'];
  sourceQuery: string;
}): Promise<NormalizedInboundPersistResult> {
  const preview = planNormalizedInboundEmail({ email: input.email });
  const shouldArchive = env.BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED
    && preview.status !== 'non_commerce_ignored';
  const raw = shouldArchive
    ? await input.runtime.getRawMessage(input.email.providerMessageId)
    : null;
  return persistNormalizedEmailForResolvedRecipient({
    db: input.db,
    email: input.email,
    recipient: {
      userId: input.connection.user_id,
      emailConnectionId: input.connection.id,
      emailAddress: input.connection.email_address,
    },
    sourceQuery: input.sourceQuery,
    sourceArchiveEnabled: shouldArchive,
    ...(raw ? {
      rawSource: {
        bytes: raw,
        contentType: 'message/rfc822',
      },
    } : {}),
  });
}

export async function runDirectGmailInitialSync(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  query?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<GmailDirectSyncSummary> {
  const { connection, runtime } = await createDirectGmailRuntime(input);
  const query = input.query?.trim() || env.EMAIL_DISCOVERY_QUERY;
  const read = await runtime.readInitialSync({
    query,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });
  const summary = baseSummary('initial');
  summary.observed = read.result.messages.length;

  for (const email of read.result.messages) {
    const result = await persistObservedMessage({
      db: input.db,
      runtime,
      connection,
      email,
      sourceQuery: `gmail-direct:initial:${query}`,
    });
    addPersistResult(summary, result);
  }

  // Cursor advances only after every observable message was safely processed.
  await runtime.commitCheckpoint(read.checkpoint);
  summary.cursorCommitted = true;
  return summary;
}

export async function runDirectGmailIncrementalSync(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<GmailDirectSyncSummary> {
  const { connection, runtime } = await createDirectGmailRuntime(input);
  const read = await runtime.readChanges(input.limit);
  const summary = baseSummary('incremental');
  summary.observed = read.page.changes.length;
  summary.resetRequired = read.page.resetRequired;
  if (read.page.resetRequired || !read.checkpoint) return summary;

  for (const change of read.page.changes) {
    if (change.kind === 'message_deleted' || !change.message) {
      // Gmail messages are immutable apart from labels. Keep previously stored
      // evidence immutable; deletion is acknowledged by cursor advancement only.
      summary.deleted += 1;
      continue;
    }
    const result = await persistObservedMessage({
      db: input.db,
      runtime,
      connection,
      email: change.message,
      sourceQuery: `gmail-direct:${change.kind}`,
    });
    addPersistResult(summary, result);
  }

  await runtime.commitCheckpoint(read.checkpoint);
  summary.cursorCommitted = true;
  return summary;
}

export async function renewDirectGmailWatch(input: {
  db: GmailRuntimeDb;
  userId: string;
  emailConnectionId: string;
  fetchImpl?: typeof fetch;
}) {
  const { runtime } = await createDirectGmailRuntime(input);
  return runtime.startOrRenewWatch();
}
