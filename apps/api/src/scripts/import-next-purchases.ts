import { env, requireNylasSmokeGrantId } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { discoverPurchaseCandidates } from '../ingestion/discover-purchases.js';
import { SupabaseSourceEmailRepository } from '../source-emails/supabase-repository.js';

const TARGET_NEW_EMAILS = 20;

async function main() {
  const supabase = getSupabaseAdmin();
  const grantId = requireNylasSmokeGrantId();

  const { data: connection, error: connectionError } = await supabase
    .from('email_connections')
    .select('id,user_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', grantId)
    .eq('status', 'active')
    .single();

  if (connectionError || !connection) {
    throw new Error(
      `Active Nylas connection for the configured grant was not found: ${connectionError?.message ?? 'unknown error'}`,
    );
  }

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: grantId,
  });
  const repository = new SupabaseSourceEmailRepository(supabase);

  const result = await discoverPurchaseCandidates({
    provider,
    sourceEmails: repository,
    userId: connection.user_id,
    emailConnectionId: connection.id,
    query: env.EMAIL_DISCOVERY_QUERY,
    pageSize: 50,
    maxPages: 10,
    maxCreated: TARGET_NEW_EMAILS,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.created === TARGET_NEW_EMAILS,
        mode: 'controlled_import_next_new_emails',
        targetNewEmails: TARGET_NEW_EMAILS,
        safety: {
          purchaseWrites: false,
          shipmentWrites: false,
          documentWrites: false,
          aiCalls: false,
        },
        provider: provider.name,
        query: env.EMAIL_DISCOVERY_QUERY,
        ...result,
      },
      null,
      2,
    ),
  );

  if (result.created !== TARGET_NEW_EMAILS) {
    throw new Error(
      `Expected to import exactly ${TARGET_NEW_EMAILS} new emails, imported ${result.created}.`,
    );
  }
}

main().catch((error) => {
  console.error(
    'Controlled next-email import failed:',
    error instanceof Error ? error.message : 'UnknownError',
  );
  process.exit(1);
});
