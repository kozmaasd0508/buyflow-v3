import { env, requireNylasSmokeGrantId } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { discoverPurchaseCandidates } from '../ingestion/discover-purchases.js';
import { SupabaseSourceEmailRepository } from '../source-emails/supabase-repository.js';

function requireDevEmail() {
  const email = process.env.BUYFLOW_DEV_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error('Set BUYFLOW_DEV_EMAIL for the controlled development import.');
  }
  return email;
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

  return data.id as string;
}

async function main() {
  const email = requireDevEmail();
  const grantId = requireNylasSmokeGrantId();
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
