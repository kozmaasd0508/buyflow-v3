import { env, requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import { auditStructuredMarkup } from '../email/structured-markup.js';

const PAGE_SIZE = 100;
const MAX_MESSAGES = 500;
const FETCH_CONCURRENCY = 4;
const MAX_BODY_CHARS = 5_000_000;

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

async function main() {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const messageIds: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  let listBodiesPresent = 0;
  let truncated = false;

  do {
    const page = await provider.searchMessages({
      query: env.EMAIL_DISCOVERY_QUERY,
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    pages += 1;

    for (const message of page.messages) {
      if (seen.has(message.providerMessageId)) continue;
      if (seen.size >= MAX_MESSAGES) {
        truncated = true;
        break;
      }
      seen.add(message.providerMessageId);
      messageIds.push(message.providerMessageId);
      if ((message.bodyHtml ?? '').trim()) listBodiesPresent += 1;
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  let fetched = 0;
  let fetchErrors = 0;
  let bodiesPresent = 0;
  let bodiesMissing = 0;
  let bodiesSkippedOversize = 0;
  let messagesWithJsonLd = 0;
  let jsonLdBlocks = 0;
  let jsonLdParseErrors = 0;
  let messagesWithMicrodata = 0;
  let messagesWithSchemaOrgReference = 0;
  let messagesWithAnyStructuredMarkup = 0;
  let messagesWithCommerceMarkup = 0;

  const commerceTypeCounts = new Map<string, number>();

  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= messageIds.length) return;
      const messageId = messageIds[index];
      if (!messageId) continue;

      try {
        const message = await provider.getMessage(messageId);
        fetched += 1;
        const body = message.bodyHtml ?? '';
        if (!body.trim()) {
          bodiesMissing += 1;
          continue;
        }
        bodiesPresent += 1;

        if (body.length > MAX_BODY_CHARS) {
          bodiesSkippedOversize += 1;
          continue;
        }

        const audit = auditStructuredMarkup(body);
        if (audit.hasJsonLd) messagesWithJsonLd += 1;
        jsonLdBlocks += audit.jsonLdBlocks;
        jsonLdParseErrors += audit.jsonLdParseErrors;
        if (audit.hasMicrodata) messagesWithMicrodata += 1;
        if (audit.hasSchemaOrgReference) messagesWithSchemaOrgReference += 1;
        if (audit.hasJsonLd || audit.hasMicrodata) messagesWithAnyStructuredMarkup += 1;
        if (audit.commerceTypes.length > 0) messagesWithCommerceMarkup += 1;

        for (const type of audit.commerceTypes) bump(commerceTypeCounts, type);
      } catch {
        fetchErrors += 1;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, messageIds.length || 1) }, () => worker()),
  );

  const result = {
    mode: 'read_only_structured_markup_audit',
    provider: provider.name,
    query: env.EMAIL_DISCOVERY_QUERY,
    safety: {
      databaseWrites: false,
      bodyOutput: false,
      subjectOutput: false,
      messageIdOutput: false,
      senderAddressOutput: false,
      rawMarkupOutput: false,
      arbitrarySchemaTypeOutput: false,
      maxMessages: MAX_MESSAGES,
      maxBodyCharsPerMessage: MAX_BODY_CHARS,
      fetchConcurrency: FETCH_CONCURRENCY,
    },
    listing: {
      pageSize: PAGE_SIZE,
      pages,
      messagesListed: messageIds.length,
      listBodiesPresent,
      truncated,
    },
    fullMessageFetch: {
      fetched,
      fetchErrors,
      bodiesPresent,
      bodiesMissing,
      bodiesSkippedOversize,
    },
    structuredMarkup: {
      messagesWithAnyStructuredMarkup,
      messagesWithSchemaOrgReference,
      messagesWithJsonLd,
      jsonLdBlocks,
      jsonLdParseErrors,
      messagesWithMicrodata,
      messagesWithCommerceMarkup,
      commerceTypes: sortedObject(commerceTypeCounts),
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Nylas structured markup read-only audit failed:', error);
  process.exit(1);
});
