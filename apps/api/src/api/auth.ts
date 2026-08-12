import { getSupabaseAdmin } from '../db/supabase-admin.js';

export interface AuthenticatedApiUser {
  id: string;
  email: string | null;
}

export function parseBearerToken(authorization: unknown): string | null {
  if (typeof authorization !== 'string') return null;
  const match = authorization.trim().match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1]?.trim() || null;
}

export async function resolveAuthenticatedApiUser(
  authorization: unknown,
): Promise<AuthenticatedApiUser | null> {
  const token = parseBearerToken(authorization);
  if (!token) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
  };
}
