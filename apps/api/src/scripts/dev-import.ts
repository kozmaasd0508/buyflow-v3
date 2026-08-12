import { env, requireNylasApiConfig } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { discoverPurchaseCandidates } from '../ingestion/discover-purchases.js';
import { SupabaseSourceEmailRepository } from '../source-emails/supabase-repository.js';

type NylasGrant = {
  id: string;
  email: string;
  provider: string;
  grant_status?: string;
  grantStatus?: string;
};

type NylasGrantListResponse = {
  data?: NylasGrant[];
};

async function resolveDevelopmentGrant() {
  const { apiKey, apiUri } = requireNylasApiConfig();
  const url = new URL('/v3/grants', apiUri);
  url.searchParams.set('limit', '10');
  url.searchParams.set('provider', 'google');
  url.searchParams.set('grant_status', 'valid');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to list Nylas grants: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as NylasGrantListResponse;
  const grants = (payload.data ?? []).filter(
    (grant) =>
      typeof grant.id === 'string' &&
      typeof grant.email === 'string' &&
      grant.provider === 'google',
  );

  const requestedGrantId = process.env.NYLAS_SMOKE_GRANT_ID?.trim();
  if (requestedGrantId) {
    const selected = grants.find((grant) => grant.id === requestedGrantId);
    if (!selected) {
      throw new Error(
        'NYLAS_SMOKE_GRANT_ID does not match an active Google grant in this Nylas application.',
      );
    }
    return selected;
  }

  if (grants.length !== 1) {
    throw new Error(
      `Expected exactly one active Google Nylas grant for automatic development bootstrap, found ${grants.length}. Set NYLAS_SMOKE_GRANT_ID only if multiple grants are intentionally connected.`,
    );
  }

  return grants[0];
}

async function findOrCreateDevUser(email: string) {
  const supabase = getSupabaseAdmin();
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    throw new Error(`Failed to list Supabase auth users: ${listError.message}`);
  }

  let user = listed.users.find(
    (candidate) => candidate.email?.toLowerCase() === email,
  );

  if (!user) {
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { buyflow_dev_bootstrap: true },
      });

    if (createError || !created.user) {
      throw new Error(
        `Failed to create development auth user: ${createError?.message ?? 'unknown error'}`,
      );
    }

    user = created.user;
  }

  const { error: profileError } = await supabase.from('users').upsert(
    {
      id: user.id,
      email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );

  if (profileError) {
    throw new Error(`Failed to upsert BuyFlow user: ${profileError.message}`);
  }

  return user;
}

async function ensureNylasConnection(userId: string, email: string, grantId: string) {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('email_connections')
    .upsert(
      {
        user_id: userId,
        provider: 'nylas',
        provider_account_id: grantId,
        email_address: email,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider,email_address' },
    )
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create Nylas email connection: ${error?.message ?? 'unknown error'}`,
    );
  }

  return data.id;
}

async function main() {
  const grant = await resolveDevelopmentGrant();
  const email = grant.email.trim().toLowerCase();
  const grantId = grant.id;
  const supabase = getSupabaseAdmin();
  const user = await findOrCreateDevUser(email);
  const emailConnectionId = await ensureNylasConnection(user.id, email, grantId);

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: grantId,
  });
  const repository = new SupabaseSourceEmailRepository(supabase);

  // Deliberately small first real import. Once verified, the normal discovery
  // job can paginate the full configured time window.
  const result = await discoverPurchaseCandidates({
    provider,
    sourceEmails: repository,
    userId: user.id,
    emailConnectionId,
    query: env.EMAIL_DISCOVERY_QUERY,
    pageSize: 10,
    maxPages: 1,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'controlled_dev_import',
        provider: provider.name,
        email,
        userId: user.id,
        emailConnectionId,
        query: env.EMAIL_DISCOVERY_QUERY,
        ...result,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('Controlled BuyFlow development import failed:', error);
  process.exit(1);
});
