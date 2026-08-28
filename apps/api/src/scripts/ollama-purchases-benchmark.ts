import { env, requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import { extractEmailWithOllamaResult } from '../ai/ollama-email-extractor.js';

const model = process.env.OLLAMA_MODEL ?? 'qwen3:30b';
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const query =
  process.env.BUYFLOW_OLLAMA_GMAIL_QUERY ??
  'after:2023/01/01 -in:spam -in:trash -category:promotions category:purchases';
const requestedLimit = Number(process.env.BUYFLOW_OLLAMA_LIMIT ?? '20');
const limit = Number.isFinite(requestedLimit)
  ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
  : 20;

function domainFromEmail(value: string): string | null {
  const at = value.lastIndexOf('@');
  if (at < 0 || at === value.length - 1) return null;
  const domain = value.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const selected = [];
  let cursor: string | undefined;
  while (selected.length < limit) {
    const page = await provider.searchMessages({
      query,
      limit: Math.min(20, limit - selected.length),
      ...(cursor ? { cursor } : {}),
    });
    selected.push(...page.messages);
    if (!page.nextCursor || page.messages.length === 0) break;
    cursor = page.nextCursor;
  }

  const eventCounts: Record<string, number> = {};
  const confidenceBuckets = { high: 0, medium: 0, low: 0 };
  const durations: number[] = [];
  const promptTokens: number[] = [];
  const outputTokens: number[] = [];
  let errors = 0;
  let emptyBodies = 0;

  console.log(
    `BUYFLOW_OLLAMA_PURCHASES_START model=${model} selected=${selected.length} query=category:purchases`,
  );

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index]!;
    try {
      const message = await provider.getMessage(candidate.providerMessageId);
      const bodySource = message.bodyHtml ?? message.snippet ?? '';
      const bodyText = htmlToCompactText(bodySource, 12_000);
      if (!bodyText) {
        emptyBodies += 1;
        continue;
      }

      const fromDomains = message.from
        .map((item) => domainFromEmail(item.email))
        .filter((item): item is string => Boolean(item));

      const result = await extractEmailWithOllamaResult({
        model,
        baseUrl,
        subject: message.subject,
        fromDomains,
        bodyText,
      });

      const eventType = result.extraction.event_type;
      eventCounts[eventType] = (eventCounts[eventType] ?? 0) + 1;
      if (result.extraction.confidence >= 0.9) confidenceBuckets.high += 1;
      else if (result.extraction.confidence >= 0.7) confidenceBuckets.medium += 1;
      else confidenceBuckets.low += 1;

      if (result.totalDurationMs !== null) durations.push(result.totalDurationMs);
      if (result.promptTokens !== null) promptTokens.push(result.promptTokens);
      if (result.outputTokens !== null) outputTokens.push(result.outputTokens);

      console.log(
        JSON.stringify({
          index: index + 1,
          ok: true,
          eventType,
          confidence: result.extraction.confidence,
          hasOrderNumber: Boolean(result.extraction.order_number),
          hasTrackingNumber: Boolean(result.extraction.tracking_number),
          productCount: result.extraction.products.length,
          promptTokens: result.promptTokens,
          outputTokens: result.outputTokens,
          totalDurationMs: result.totalDurationMs,
        }),
      );
    } catch (error) {
      errors += 1;
      console.error(
        JSON.stringify({
          index: index + 1,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 240) : 'unknown_error',
        }),
      );
    }
  }

  const processed = selected.length - errors - emptyBodies;
  console.log(
    'BUYFLOW_OLLAMA_PURCHASES_RESULT ' +
      JSON.stringify({
        model,
        selected: selected.length,
        processed,
        errors,
        emptyBodies,
        eventCounts,
        confidenceBuckets,
        averagePromptTokens: average(promptTokens),
        averageOutputTokens: average(outputTokens),
        averageDurationMs: average(durations),
        productionWrites: 0,
      }),
  );
}

main().catch((error) => {
  console.error(
    'BUYFLOW_OLLAMA_PURCHASES_FATAL ' +
      (error instanceof Error ? error.message.slice(0, 300) : String(error)),
  );
  process.exit(1);
});
