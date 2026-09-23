import { env, requireNylasSmokeGrantId, requireOpenAIConfig } from '../config.js';
import { extractEmailWithOpenAIResult, htmlToCompactText } from '../ai/openai-email-extractor.js';
import { createEmailProvider } from '../email/factory.js';

const SAMPLE_SIZE = 10;

function senderDomains(message: { from: Array<{ email: string }> }): string[] {
  return [...new Set(message.from.map((item) => item.email.toLowerCase().split('@').pop() ?? '').filter(Boolean))];
}

async function main() {
  const openai = requireOpenAIConfig();
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const page = await provider.searchMessages({
    query: env.EMAIL_DISCOVERY_QUERY,
    limit: SAMPLE_SIZE,
  });

  const eventCounts = new Map<string, number>();
  const fieldPresence = {
    merchant: 0,
    orderNumber: 0,
    trackingNumber: 0,
    carrier: 0,
    invoiceNumber: 0,
    total: 0,
    currency: 0,
  };
  const samples: Array<{
    sample: number;
    eventType: string;
    confidence: number;
    fieldsPresent: string[];
  }> = [];

  let processed = 0;
  let errors = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCachedInputTokens = 0;
  const errorTypes = new Map<string, number>();
  let firstError: string | null = null;

  for (const [index, listed] of page.messages.entries()) {
    try {
      const message = (listed.bodyHtml ?? '').trim()
        ? listed
        : await provider.getMessage(listed.providerMessageId);
      const bodyText = htmlToCompactText(message.bodyHtml ?? '');
      if (!bodyText) continue;

      const result = await extractEmailWithOpenAIResult({
        apiKey: openai.apiKey,
        model: openai.model,
        subject: message.subject,
        fromDomains: senderDomains(message),
        bodyText,
      });
      const extraction = result.extraction;

      processed += 1;
      totalInputTokens += result.inputTokens ?? 0;
      totalOutputTokens += result.outputTokens ?? 0;
      totalTokens += result.totalTokens ?? 0;
      totalCachedInputTokens += result.cachedInputTokens ?? 0;
      eventCounts.set(extraction.event_type, (eventCounts.get(extraction.event_type) ?? 0) + 1);

      const present: string[] = [];
      if (extraction.merchant) { fieldPresence.merchant += 1; present.push('merchant'); }
      if (extraction.order_number) { fieldPresence.orderNumber += 1; present.push('order_number'); }
      if (extraction.tracking_number) { fieldPresence.trackingNumber += 1; present.push('tracking_number'); }
      if (extraction.carrier) { fieldPresence.carrier += 1; present.push('carrier'); }
      if (extraction.invoice_number) { fieldPresence.invoiceNumber += 1; present.push('invoice_number'); }
      if (extraction.total !== null) { fieldPresence.total += 1; present.push('total'); }
      if (extraction.currency) { fieldPresence.currency += 1; present.push('currency'); }

      samples.push({
        sample: index + 1,
        eventType: extraction.event_type,
        confidence: Number(extraction.confidence.toFixed(3)),
        fieldsPresent: present,
      });
    } catch (error) {
      errors += 1;
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      errorTypes.set(errorName, (errorTypes.get(errorName) ?? 0) + 1);
      if (!firstError && error instanceof Error) {
        const apiFailure = error.message.match(/^OpenAI Responses API failed \((\d+)\): (.*)$/s);
        firstError = apiFailure
          ? `OpenAI Responses API failed (${apiFailure[1]}): ${(apiFailure[2] ?? '').slice(0, 350)}`
          : errorName;
      }
    }
  }

  console.log(JSON.stringify({
    mode: 'read_only_openai_smoke',
    safety: {
      databaseWrites: false,
      bodyOutput: false,
      subjectOutput: false,
      senderOutput: false,
      merchantValueOutput: false,
      identifierValueOutput: false,
      storeOpenAIResponse: false,
    },
    model: openai.model,
    query: env.EMAIL_DISCOVERY_QUERY,
    listed: page.messages.length,
    processed,
    errors,
    errorTypes: Object.fromEntries([...errorTypes.entries()].sort()),
    firstError,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      cachedInputTokens: totalCachedInputTokens,
      averageInputTokensPerProcessed: processed > 0 ? Math.round(totalInputTokens / processed) : 0,
      averageOutputTokensPerProcessed: processed > 0 ? Math.round(totalOutputTokens / processed) : 0,
    },
    eventCounts: Object.fromEntries([...eventCounts.entries()].sort()),
    fieldPresence,
    samples,
  }, null, 2));

  if (errors > 0 || processed === 0) {
    throw new Error(`READ_ONLY_SMOKE_INCOMPLETE processed=${processed} errors=${errors}`);
  }
}

main().catch((error) => {
  console.error('OpenAI read-only smoke failed:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
