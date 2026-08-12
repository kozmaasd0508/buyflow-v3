import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const supabaseSecretKey = requireEnv('SUPABASE_SECRET_KEY');
const apiBaseUrl = (process.env.API_BASE_URL ?? 'https://buyflow-v3-api-dev.onrender.com').replace(/\/$/, '');

const admin = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

async function expectJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON response, got HTTP ${response.status}`);
  }
}

async function main() {
  const email = `buyflow-auth-smoke-${Date.now()}-${randomBytes(4).toString('hex')}@example.com`;
  const password = `Bf!${randomBytes(24).toString('base64url')}`;
  let tempUserId: string | null = null;

  const { data: existingPurchase, error: purchaseLookupError } = await admin
    .from('purchases')
    .select('id,user_id')
    .limit(1)
    .maybeSingle();

  if (purchaseLookupError) {
    throw new Error(`Could not read existing purchase for isolation test: ${purchaseLookupError.message}`);
  }
  if (!existingPurchase) {
    throw new Error('No existing purchase is available for the cross-user isolation test');
  }

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { purpose: 'buyflow_auth_api_smoke' },
    });

    if (createError || !created.user) {
      throw new Error(`Temporary auth user creation failed: ${createError?.message ?? 'missing user'}`);
    }
    tempUserId = created.user.id;

    const signInClient = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data: signedIn, error: signInError } = await signInClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signedIn.session?.access_token || !signedIn.user) {
      throw new Error(`Temporary auth sign-in failed: ${signInError?.message ?? 'missing session'}`);
    }

    const token = signedIn.session.access_token;
    const headers = { Authorization: `Bearer ${token}` };

    const meResponse = await fetch(`${apiBaseUrl}/api/me`, { headers });
    const meBody = await expectJson(meResponse);
    const meOk = meResponse.status === 200 && meBody?.user?.id === tempUserId;
    if (!meOk) {
      throw new Error(`Authenticated /api/me check failed with HTTP ${meResponse.status}`);
    }

    const listResponse = await fetch(`${apiBaseUrl}/api/purchases`, { headers });
    const listBody = await expectJson(listResponse);
    const ownListEmpty =
      listResponse.status === 200 &&
      Array.isArray(listBody?.purchases) &&
      listBody.purchases.length === 0;
    if (!ownListEmpty) {
      throw new Error(`Temporary user unexpectedly saw purchases (HTTP ${listResponse.status})`);
    }

    const foreignResponse = await fetch(`${apiBaseUrl}/api/purchases/${existingPurchase.id}`, { headers });
    const foreignBody = await expectJson(foreignResponse);
    const foreignPurchaseHidden =
      foreignResponse.status === 404 && foreignBody?.error === 'purchase_not_found';
    if (!foreignPurchaseHidden) {
      throw new Error(`Cross-user purchase isolation failed with HTTP ${foreignResponse.status}`);
    }

    console.log(JSON.stringify({
      ok: true,
      mode: 'authenticated_api_smoke',
      temporaryUserCreated: true,
      authenticatedMePassed: meOk,
      ownPurchaseListEmpty: ownListEmpty,
      foreignPurchaseHidden,
      secretsPrinted: false,
    }, null, 2));
  } finally {
    if (tempUserId) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(tempUserId);
      if (deleteError) {
        throw new Error(`Temporary auth user cleanup failed: ${deleteError.message}`);
      }
    }
  }
}

await main();
