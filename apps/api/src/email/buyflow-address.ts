import { randomBytes } from 'node:crypto';

export const DEFAULT_BUYFLOW_EMAIL_DOMAIN = 'buyflow.hu';
const BUYFLOW_LOCAL_PART_PATTERN = /^bf-[a-f0-9]{16}$/;

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

export function buildBuyFlowEmailAddress(
  localPart: string,
  domain = DEFAULT_BUYFLOW_EMAIL_DOMAIN,
): string {
  const normalizedLocalPart = localPart.trim().toLowerCase();
  if (!BUYFLOW_LOCAL_PART_PATTERN.test(normalizedLocalPart)) {
    throw new Error('Invalid BuyFlow email local part');
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
  if (!BUYFLOW_LOCAL_PART_PATTERN.test(localPart)) return null;
  return `${localPart}@${addressDomain}`;
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
  if (!data) return null;

  return {
    id: data.id as string,
    userId: data.user_id as string,
    emailAddress: data.email_address as string,
    status: data.status as BuyFlowEmailConnection['status'],
  };
}

export async function ensureBuyFlowEmailConnection(input: {
  db: any;
  userId: string;
  userEmail?: string | null;
  domain?: string;
}): Promise<BuyFlowEmailConnection> {
  const domain = input.domain ?? DEFAULT_BUYFLOW_EMAIL_DOMAIN;
  const userRow: Record<string, unknown> = { id: input.userId };
  if (input.userEmail?.trim()) userRow.email = input.userEmail.trim().toLowerCase();

  const { error: userError } = await input.db
    .from('users')
    .upsert(userRow, { onConflict: 'id' });
  if (userError) {
    throw new Error(`Failed to ensure BuyFlow user: ${userError.message}`);
  }

  const existing = await getBuyFlowEmailConnection(input.db, input.userId);
  if (existing) {
    if (existing.status === 'active') return existing;

    const { data: reactivated, error: reactivateError } = await input.db
      .from('email_connections')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('user_id', input.userId)
      .eq('provider', 'ses')
      .select('id,user_id,email_address,status')
      .single();
    if (reactivateError || !reactivated) {
      throw new Error(`Failed to reactivate BuyFlow email connection: ${reactivateError?.message ?? 'missing row'}`);
    }

    return {
      id: reactivated.id as string,
      userId: reactivated.user_id as string,
      emailAddress: reactivated.email_address as string,
      status: reactivated.status as BuyFlowEmailConnection['status'],
    };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const emailAddress = generateBuyFlowEmailAddress(domain);
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

    if (!error && data) {
      return {
        id: data.id as string,
        userId: data.user_id as string,
        emailAddress: data.email_address as string,
        status: data.status as BuyFlowEmailConnection['status'],
      };
    }

    // A generated-address collision is safe to retry. Any other database error
    // must fail instead of silently creating a second or inconsistent identity.
    if (error?.code !== '23505') {
      throw new Error(`Failed to create BuyFlow email connection: ${error?.message ?? 'missing row'}`);
    }

    const concurrent = await getBuyFlowEmailConnection(input.db, input.userId);
    if (concurrent) return concurrent;
  }

  throw new Error('Failed to allocate a unique BuyFlow email address');
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
