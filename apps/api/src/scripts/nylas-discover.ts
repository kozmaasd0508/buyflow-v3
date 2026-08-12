import { env, requireNylasSmokeGrantId, requireSmokeImportContext } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import { discoverPurchaseCandidates } from '../ingestion/discover-purchases.js';
import { SupabaseSourceEmailRepository } from '../source-emails/supabase-repository.js';

async function main() {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const context = requireSmokeImportContext();
  const repository = new SupabaseSourceEmailRepository(getSupabaseAdmin());

  const result = await discoverPurchaseCandidates({
    provider,
    sourceEmails: repository,
    userId: context.userId,
    emailConnectionId: context.emailConnectionId,
    query: env.EMAIL_DISCOVERY_QUERY,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: provider.name,
        query: env.EMAIL_DISCOVERY_QUERY,
        ...result,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('Nylas discovery import failed:', error);
  process.exit(1);
});
