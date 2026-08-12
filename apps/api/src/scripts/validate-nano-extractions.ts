import { requireNylasSmokeGrantId } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { EmailExtraction } from '../ai/openai-email-extractor.js';
import {
  validateEmailExtraction,
  type ValidatedEmailExtraction,
} from '../validation/email-extraction-validator.js';

const requestedMaxEmails = Number.parseInt(process.env.PIPELINE_MAX_EMAILS ?? '10', 10);
const MAX_EMAILS = Number.isFinite(requestedMaxEmails)
  ? Math.min(Math.max(requestedMaxEmails, 1), 100)
  : 10;

function senderDomains(addresses: Array<{ email: string }>): string[] {
  return [...new Set(
    addresses
      .map((address) => address.email.trim().toLowerCase())
      .map((email) => email.slice(email.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
}

function isEmailExtraction(value: unknown): value is EmailExtraction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.event_type === 'string' &&
    typeof record.confidence === 'number'
  );
}

function toJson(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function main() {
  const supabase = getSupabaseAdmin();
  const db = supabase as any;
  const grantId = requireNylasSmokeGrantId();

  const { data: connection, error: connectionError } = await supabase
    .from('email_connections')
    .select('id,user_id,provider_account_id')
    .eq('provider', 'nylas')
    .eq('provider_account_id', grantId)
    .eq('status', 'active')
    .single();

  if (connectionError || !connection) {
    throw new Error(
      `Active Nylas connection for the configured grant was not found: ${connectionError?.message ?? 'unknown error'}`,
    );
  }

  const { data: rows, error: rowsError } = await db
    .from('source_emails')
    .select('id,provider_message_id,structured_result,validation_status')
    .eq('email_connection_id', connection.id)
    .eq('processing_status', 'review')
    .is('validated_result', null)
    .order('received_at', { ascending: false })
    .limit(MAX_EMAILS);

  if (rowsError) {
    throw new Error(`Failed to load review emails: ${rowsError.message}`);
  }

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: grantId,
  });

  const statusCounts: Record<string, number> = {};
  const eventChanges: Record<string, number> = {};
  const blockedFieldCounts: Record<string, number> = {};
  const selected = rows?.length ?? 0;
  let processed = 0;
  let eligibleForPurchaseCreation = 0;
  let errors = 0;

  for (const row of rows ?? []) {
    try {
      if (!isEmailExtraction(row.structured_result)) {
        throw new Error('InvalidStructuredResult');
      }

      const email = await provider.getMessage(row.provider_message_id);
      const bodyText = email.bodyHtml ?? email.snippet ?? '';
      const validated: ValidatedEmailExtraction = validateEmailExtraction({
        extraction: row.structured_result,
        senderDomains: senderDomains(email.from),
        subject: email.subject,
        bodyText,
      });

      const { error: updateError } = await db
        .from('source_emails')
        .update({
          validated_result: toJson(validated),
          validation_status: validated.validation_status,
          validated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .is('validated_result', null);

      if (updateError) {
        throw new Error(`Failed to save validation: ${updateError.message}`);
      }

      processed += 1;
      statusCounts[validated.validation_status] =
        (statusCounts[validated.validation_status] ?? 0) + 1;

      const eventChange = `${validated.original_event_type}->${validated.event_type}`;
      eventChanges[eventChange] = (eventChanges[eventChange] ?? 0) + 1;

      for (const field of validated.blocked_fields) {
        blockedFieldCounts[field] = (blockedFieldCounts[field] ?? 0) + 1;
      }

      if (validated.eligible_for_purchase_creation) {
        eligibleForPurchaseCreation += 1;
      }
    } catch {
      errors += 1;
      await db
        .from('source_emails')
        .update({
          validation_status: 'review',
          validated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: errors === 0,
        mode: 'deterministic_validation_guardrails',
        safety: {
          openAiCalls: false,
          purchaseWrites: false,
          shipmentWrites: false,
          documentWrites: false,
          resolutionEnabled: false,
          publicLogContainsEmailBody: false,
          publicLogContainsIdentifiers: false,
        },
        maxEmails: MAX_EMAILS,
        selected,
        processed,
        errors,
        statusCounts,
        eventChanges,
        blockedFieldCounts,
        eligibleForPurchaseCreation,
      },
      null,
      2,
    ),
  );

  if (errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    'Validation guardrail run failed:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exit(1);
});
