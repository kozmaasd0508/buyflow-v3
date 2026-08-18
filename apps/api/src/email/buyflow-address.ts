import { randomBytes } from 'node:crypto';

export const DEFAULT_BUYFLOW_EMAIL_DOMAIN = 'buyflow.hu';
const MIN_LOCAL_PART_LENGTH = 3;
const MAX_LOCAL_PART_LENGTH = 40;
const RESERVED_LOCAL_PARTS = new Set([
  'abuse',
  'admin',
  'administrator',
  'billing',
  'contact',
  'hello',
  'help',
  'info',
  'mail',
  'noreply',
  'no-reply',
  'postmaster',
  'security',
  'support',
]);

export class InvalidBuyFlowEmailLocalPartError extends Error {
  constructor() {
    super('Invalid BuyFlow email local part');
    this.name = 'InvalidBuyFlowEmailLocalPartError';
  }
}

export class BuyFlowEmailAddressUnavailableError extends Error {
  constructor() {
    super('BuyFlow email address is unavailable');
    this.name = 'BuyFlowEmailAddressUnavailableError';
  }
}

export class BuyFlowEmailAlreadyAssignedError extends Error {
  constructor() {
    super('BuyFlow email address is already assigned for this user');
    this.name = 'BuyFlowEmailAlreadyAssignedError';
  }
}

export interface BuyFlowEmailConnection {
  id: string;
  userId: string;
  emailAddress: string;
  status: 'active' | 'disconnected' | 'error';
}

export interface ResolvedBuyFlowRecipient {
  userId: string;
  emailConnectionId: string;
  emailAddress: string;
}

function normalizedDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, '');
}

function normalizeLocalPartValue(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidBuyFlowLocalPart(value: string): boolean {
  const localPart = normalizeLocalPartValue(value);
  if (localPart.length < MIN_LOCAL_PART_LENGTH || localPart.length > MAX_LOCAL_PART_LENGTH) {
    return false;
  }
  if (!/^[a-z0-9._-]+$/.test(localPart)) return false;
  if (!/^[a-z0-9]/.test(localPart) || !/[a-z0-9]$/.test(localPart)) return false;
  if (/[._-]{2}/.test(localPart)) return false;
  if (RESERVED_LOCAL_PARTS.has(localPart)) return false;
  return true;
}

export function buildBuyFlowEmailAddress(
  localPart: string,
  domain = DEFAULT_BUYFLOW_EMAIL_DOMAIN,
): string {
  const normalizedLocalPart = normalizeLocalPartValue(localPart);
  if (!isValidBuyFlowLocalPart(normalizedLocalPart)) {
    throw new InvalidBuyFlowEmailLocalPartError();
  }
  return `${normalizedLocalPart}@${normalizedDomain(domain)}`;
}

export function generateBuyFlowEmailAddress(
  domain = DEFAULT_BUYFLOW_EMAIL_DOMAIN,
  randomBytesFn: (size: number) => Buffer = randomBytes,
): string {
  const token = randomBytesFn(8).toString('hex');
  return buildBuyFlowEmailAddress(`bf-${token}`, domain);
}

export function suggestBuyFlowLocalPart(userEmail?: string | null): string | null {
  const normalizedEmail = userEmail?.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const at = normalizedEmail.lastIndexOf('@');
  if (at <= 0) return null;

  let localPart = normalizedEmail.slice(0, at).split('+')[0] ?? '';
  localPart = localPart
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[._-]{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');

  if (!localPart) return null;
  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    localPart = localPart
      .slice(0, MAX_LOCAL_PART_LENGTH)
      .replace(/[._-]+$/g, '');
  }
  if (localPart.length < MIN_LOCAL_PART_LENGTH) {
    localPart = `${localPart}-shop`;
  }
  if (RESERVED_LOCAL_PARTS.has(localPart)) {
    localPart = `${localPart}-shop`;
  }
  if (localPart.length > MAX_LOCAL_PART_LENGTH) {
    localPart = localPart
      .slice(0, MAX_LOCAL_PART_LENGTH)
      .replace(/[._-]+$/g, '');
  }

  return isValidBuyFlowLocalPart(localPart) ? localPart : null;
}

export function suggestBuyFlowEmailAddress(
  userEmail?: string | null,
  domain = DEFAULT_BUYFLOW_EMAIL_DOMAIN,
): string | null {
  const localPart = suggestBuyFlowLocalPart(userEmail);
  return localPart ? buildBuyFlowEmailAddress(localPart, domain) : null;
}

export function normalizeBuyFlowEmailAddress(
  value: string,
  domain = DEFAULT_BUYFLOW_EMAIL_DOMAIN,
): string | null {
  const normalized = value.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return null;
  const localPart = normalized.slice(0, at);
  const addressDomain = normalized.slice(at + 1);
  if (addressDomain !== normalizedDomain(domain)) return null;
  if (!isValidBuyFlowLocalPart(localPart)) return null;
  return `${localPart}@${addressDomain}`;
}

function localPartWithSuffix(base: string, suffix: string): string {
  const maxBaseLength = MAX_LOCAL_PART_LENGTH - suffix.length;
  const trimmedBase = base
    .slice(0, maxBaseLength)
    .replace(/[._-]+$/g, '');
  return `${trimmedBase}${suffix}`;
}

function connectionFromRow(data: any): BuyFlowEmailConnection {
  return {
    id: data.id as string,
    userId: data.user_id as string,
    emailAddress: data.email_address as string,
    status: data.status as BuyFlowEmailConnection['status'],
  };
}

async function ensureUserRow(input: {
  db: any;
  userId: string;
  userEmail?: string | null;
}): Promise<void> {
  const userRow: Record<string, unknown> = { id: input.userId };
  if (input.userEmail?.trim()) userRow.email = input.userEmail.trim().toLowerCase();

  const { error } = await input.db
    .from('users')
    .upsert(userRow, { onConflict: 'id' });
  if (error) {
    throw new Error(`Failed to ensure BuyFlow user: ${error.message}`);
  }
}

async function reactivateBuyFlowEmailConnection(input: {
  db: any;
  connection: BuyFlowEmailConnection;
}): Promise<BuyFlowEmailConnection> {
  if (input.connection.status === 'active') return input.connection;

  const { data, error } = await input.db
    .from('email_connections')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', input.connection.id)
    .eq('user_id', input.connection.userId)
    .eq('provider', 'ses')
    .select('id,user_id,email_address,status')
    .single();
  if (error || !data) {
    throw new Error(`Failed to reactivate BuyFlow email connection: ${error?.message ?? 'missing row'}`);
  }
  return connectionFromRow(data);
}

export async function getBuyFlowEmailConnection(
  db: any,
  userId: string,
): Promise<BuyFlowEmailConnection | null> {
  const { data, error } = await db
    .from('email_connections')
    .select('id,user_id,email_address,status')
    .eq('user_id', userId)
    .eq('provider', 'ses')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load BuyFlow email connection: ${error.message}`);
  }
  return data ? connectionFromRow(data) : null;
}

export async function isBuyFlowLocalPartAvailable(input: {
  db: any;
  localPart: string;
  userId?: string;
  domain?: string;
}): Promise<boolean> {
  const emailAddress = buildBuyFlowEmailAddress(
    input.localPart,
    input.domain ?? DEFAULT_BUYFLOW_EMAIL_DOMAIN,
  );
  const { data, error } = await input.db
    .from('email_connections')
    .select('user_id')
    .eq('provider', 'ses')
    .eq('email_address', emailAddress)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to check BuyFlow email availability: ${error.message}`);
  }
  if (!data) return true;
  return Boolean(input.userId && data.user_id === input.userId);
}

export async function findAvailableBuyFlowLocalPart(input: {
  db: any;
  userEmail?: string | null;
  userId?: string;
  domain?: string;
}): Promise<string> {
  const domain = input.domain ?? DEFAULT_BUYFLOW_EMAIL_DOMAIN;
  const base = suggestBuyFlowLocalPart(input.userEmail) ?? 'shopping';
  const candidates = [base];
  for (let index = 2; index <= 25; index += 1) {
    candidates.push(localPartWithSuffix(base, `-${index}`));
  }

  for (const localPart of candidates) {
    if (await isBuyFlowLocalPartAvailable({
      db: input.db,
      localPart,
      userId: input.userId,
      domain,
    })) {
      return localPart;
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const emailAddress = generateBuyFlowEmailAddress(domain);
    const localPart = emailAddress.slice(0, emailAddress.lastIndexOf('@'));
    if (await isBuyFlowLocalPartAvailable({ db: input.db, localPart, userId: input.userId, domain })) {
      return localPart;
    }
  }

  throw new Error('Failed to suggest an available BuyFlow email address');
}

export async function claimBuyFlowEmailConnection(input: {
  db: any;
  userId: string;
  localPart: string;
  userEmail?: string | null;
  domain?: string;
}): Promise<BuyFlowEmailConnection> {
  const domain = input.domain ?? DEFAULT_BUYFLOW_EMAIL_DOMAIN;
  const emailAddress = buildBuyFlowEmailAddress(input.localPart, domain);
  await ensureUserRow(input);

  const existing = await getBuyFlowEmailConnection(input.db, input.userId);
  if (existing) {
    if (existing.emailAddress.toLowerCase() !== emailAddress) {
      throw new BuyFlowEmailAlreadyAssignedError();
    }
    return reactivateBuyFlowEmailConnection({ db: input.db, connection: existing });
  }

  const { data, error } = await input.db
    .from('email_connections')
    .insert({
      user_id: input.userId,
      provider: 'ses',
      provider_account_id: emailAddress,
      email_address: emailAddress,
      status: 'active',
    })
    .select('id,user_id,email_address,status')
    .single();

  if (!error && data) return connectionFromRow(data);

  if (error?.code === '23505') {
    const concurrent = await getBuyFlowEmailConnection(input.db, input.userId);
    if (concurrent?.emailAddress.toLowerCase() === emailAddress) {
      return reactivateBuyFlowEmailConnection({ db: input.db, connection: concurrent });
    }
    throw new BuyFlowEmailAddressUnavailableError();
  }

  throw new Error(`Failed to create BuyFlow email connection: ${error?.message ?? 'missing row'}`);
}

export async function ensureBuyFlowEmailConnection(input: {
  db: any;
  userId: string;
  userEmail?: string | null;
  domain?: string;
}): Promise<BuyFlowEmailConnection> {
  const existing = await getBuyFlowEmailConnection(input.db, input.userId);
  if (existing) {
    await ensureUserRow(input);
    return reactivateBuyFlowEmailConnection({ db: input.db, connection: existing });
  }

  const localPart = await findAvailableBuyFlowLocalPart({
    db: input.db,
    userEmail: input.userEmail,
    userId: input.userId,
    domain: input.domain,
  });
  return claimBuyFlowEmailConnection({
    ...input,
    localPart,
  });
}

export async function resolveBuyFlowEmailRecipient(input: {
  db: any;
  emailAddress: string;
  domain?: string;
}): Promise<ResolvedBuyFlowRecipient | null> {
  const normalized = normalizeBuyFlowEmailAddress(
    input.emailAddress,
    input.domain ?? DEFAULT_BUYFLOW_EMAIL_DOMAIN,
  );
  if (!normalized) return null;

  const { data, error } = await input.db
    .from('email_connections')
    .select('id,user_id,email_address')
    .eq('provider', 'ses')
    .eq('status', 'active')
    .eq('email_address', normalized)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to resolve BuyFlow email recipient: ${error.message}`);
  }
  if (!data) return null;

  return {
    userId: data.user_id as string,
    emailConnectionId: data.id as string,
    emailAddress: data.email_address as string,
  };
}
