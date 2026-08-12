import { requireNylasSmokeGrantId, requireOpenAIConfig } from '../config.js';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import type { Json } from '../db/database.types.js';
import { createEmailProvider } from '../email/factory.js';
import {
  extractEmailWithOpenAIResult,
  htmlToCompactText,
  type EmailExtraction,
} from '../ai/openai-email-extractor.js';

const requestedMaxEmails = Number.parseInt(process.env.PIPELINE_MAX_EMAILS ?? '10', 10);
const MAX_EMAILS = Number.isFinite(requestedMaxEmails)
  ? Math.min(Math.max(requestedMaxEmails, 1), 100)
  : 10;
const PROMPT_VERSION = 'nano-email-extraction-v1';

function senderDomains(addresses: Array<{ email: string }>): string[] {
  return [...new Set(
    addresses
      .map((address) => address.email.trim().toLowerCase())
      .map((email) => email.slice(email.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
}

function extractionFieldPresence(extraction: EmailExtraction): string[] {
  const fields: string[] = [];
  if (extraction.merchant) fields.push('merchant');
  if (extraction.order_number) fields.push('order_number');
  if (extraction.tracking_number) fields.push('tracking_number');
  if (extraction.carrier) fields.push('carrier');
  if (extraction.invoice_number) fields.push('invoice_number');
  if (extraction.total !== null) fields.push('total');
  if (extraction.currency) fields.push('currency');
  return fields;
}

function extractionToJson(extraction: EmailExtraction): Json {
  return {
    event_type: extraction.event_type,
    merchant: extraction.merchant,
    order_number: extraction.order_number,
    tracking_number: extraction.tracking_number,
    carrier: extraction.carrier,
    invoice_number: extraction.invoice_number,
    total: extraction.total,
    currency: extraction.currency,
    confidence: extraction.confidence,
  };
}

async function main() {
  const supabase = getSupabaseAdmin();
  const grantId = requireNylasSmokeGrantId();
  const openai = requireOpenAIConfig();

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

  const { data: pending, error: pendingError } = await supabase
    .from('source_emails')
    .select('id,user_id,provider_message_id,processing_status')
    .eq('email_connection_id', connection.id)
    .eq('processing_status', 'pending')
    .order('received_at', { ascending: false })
    .limit(MAX_EMAILS);

  if (pendingError) {
    throw new Error(`Failed to load pending source emails: ${pendingError.message}`);
  }

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: grantId,
  });

  const eventCounts: Record<string, number> = {};
  const fieldPresence: Record<string, number> = {};
  let claimed = 0;
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const source of pending ?? []) {
    const { data: claim, error: claimError } = await supabase
      .from('source_emails')
      .update({ processing_status: 'processing' })
      .eq('id', source.id)
      .eq('processing_status', 'pending')
      .select('id')
      .maybeSingle();

    if (claimError) {
      errors += 1;
      continue;
    }

    if (!claim) {
      skipped += 1;
      continue;
    }

    claimed += 1;

    try {
      const email = await provider.getMessage(source.provider_message_id);
      const compactBody = email.bodyHtml
        ? htmlToCompactText(email.bodyHtml)
        : (email.snippet ?? '').trim().slice(0, 12_000);

      const result = await extractEmailWithOpenAIResult({
        apiKey: openai.apiKey,
        model: openai.model,
        subject: email.subject,
        fromDomains: senderDomains(email.from),
        bodyText: compactBody,
      });

      const extraction = result.extraction;
      const extractionJson = extractionToJson(extraction);
      const now = new Date().toISOString();

      const aiRunResult: Json = {
        extraction: extractionJson,
        openai_response_id: result.responseId,
        total_tokens: result.totalTokens,
        cached_input_tokens: result.cachedInputTokens,
      };

      const { error: runError } = await supabase.from('ai_processing_runs').insert({
        user_id: source.user_id,
        source_email_id: source.id,
        purchase_id: null,
        purpose: 'email_extraction',
        provider: 'openai',
        model: openai.model,
        prompt_version: PROMPT_VERSION,
        status: 'completed',
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        estimated_cost: null,
        confidence: extraction.confidence,
        result: aiRunResult,
      });

      if (runError) {
        throw new Error(`Failed to save AI processing run: ${runError.message}`);
      }

      const { error: sourceError } = await supabase
        .from('source_emails')
        .update({
          classification: extraction.event_type,
          structured_result: extractionJson,
          processing_status: 'review',
          processed_at: now,
        })
        .eq('id', source.id);

      if (sourceError) {
        throw new Error(`Failed to save source email extraction: ${sourceError.message}`);
      }

      processed += 1;
      eventCounts[extraction.event_type] =
        (eventCounts[extraction.event_type] ?? 0) + 1;

      for (const field of extractionFieldPresence(extraction)) {
        fieldPresence[field] = (fieldPresence[field] ?? 0) + 1;
      }

      inputTokens += result.inputTokens ?? 0;
      outputTokens += result.outputTokens ?? 0;
    } catch (error) {
      errors += 1;

      const failedResult: Json = {
        error_type: error instanceof Error ? error.name : 'UnknownError',
      };

      await supabase.from('ai_processing_runs').insert({
        user_id: source.user_id,
        source_email_id: source.id,
        purchase_id: null,
        purpose: 'email_extraction',
        provider: 'openai',
        model: openai.model,
        prompt_version: PROMPT_VERSION,
        status: 'failed',
        result: failedResult,
      });

      await supabase
        .from('source_emails')
        .update({ processing_status: 'error' })
        .eq('id', source.id);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: errors === 0,
        mode: 'controlled_nano_extraction',
        safety: {
          purchaseWrites: false,
          shipmentWrites: false,
          documentWrites: false,
          resolutionEnabled: false,
          publicLogContainsEmailBody: false,
          publicLogContainsIdentifiers: false,
        },
        model: openai.model,
        maxEmails: MAX_EMAILS,
        selected: pending?.length ?? 0,
        claimed,
        processed,
        skipped,
        errors,
        resultingStatus: 'review',
        eventCounts,
        fieldPresence,
        tokenUsage: {
          inputTokens,
          outputTokens,
        },
      },
      null,
      2,
    ),
  );

  if (errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    'Controlled Nano extraction failed:',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exit(1);
});
