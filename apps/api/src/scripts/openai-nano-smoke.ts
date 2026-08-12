import { env, requireNylasSmokeGrantId, requireOpenAIConfig } from '../config.js';
import { extractEmailWithOpenAI, htmlToCompactText } from '../ai/openai-email-extractor.js';
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

  for (const [index, listed] of page.messages.entries()) {
    try {
      const message = (listed.bodyHtml ?? '').trim()
        ? listed
        : await provider.getMessage(listed.providerMessageId);
      const bodyText = htmlToCompactText(message.bodyHtml ?? '');
      if (!bodyText) continue;

      const extraction = await extractEmailWithOpenAI({
        apiKey: openai.apiKey,
        model: openai.model,
        subject: message.subject,
        fromDomains: senderDomains(message),
        bodyText,
      });

      processed += 1;
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
    } catch {
      errors += 1;
    }
  }

  console.log(JSON.stringify({
    mode: 'read_only_gpt_5_4_nano_smoke',
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
    eventCounts: Object.fromEntries([...eventCounts.entries()].sort()),
    fieldPresence,
    samples,
  }, null, 2));
}

main().catch((error) => {
  console.error('GPT-5.4 nano read-only smoke failed:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
