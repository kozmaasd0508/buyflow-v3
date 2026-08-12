import { env, requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';

const PAGE_SIZE = 100;
const MAX_MESSAGES = 10_000;

const courierDomainTokens = [
  'expressone',
  'gls',
  'dpd',
  'dhl',
  'ups',
  'fedex',
  'foxpost',
  'packeta',
  'sameday',
  'posta',
  'mpl',
];

const knownSenderBuckets: Array<[string, string[]]> = [
  ['expressone', ['expressone']],
  ['gls', ['gls']],
  ['dpd', ['dpd']],
  ['dhl', ['dhl']],
  ['foxpost', ['foxpost']],
  ['packeta', ['packeta']],
  ['stripe', ['stripe']],
  ['paypal', ['paypal']],
];

function domainOf(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  return at >= 0 ? normalized.slice(at + 1) : '';
}

function extensionOf(filename: string): string {
  const clean = filename.trim().toLowerCase().split(/[?#]/, 1)[0] ?? '';
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return 'none';
  const ext = clean.slice(dot + 1).replace(/[^a-z0-9]/g, '').slice(0, 12);
  return ext || 'other';
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function sortedObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function classifyMessage(message: NormalizedEmail): string {
  const subject = (message.subject ?? '').toLowerCase();
  const domains = message.from.map((item) => domainOf(item.email)).filter(Boolean);
  const courierSender = domains.some((domain) =>
    courierDomainTokens.some((token) => domain.includes(token)),
  );

  if (
    /refund|refunded|return|returned|credit note|visszat[eé]r[ií]t|visszak[uü]ld|el[aá]ll[aá]s|storno|sztorn[oó]/i.test(
      subject,
    )
  ) {
    return 'return_or_refund';
  }

  if (
    courierSender ||
    /tracking|shipment|shipped|delivery|delivered|courier|parcel|csomag|k[eé]zbes[ií]t|fut[aá]r|sz[aá]ll[ií]t/i.test(
      subject,
    )
  ) {
    return 'shipping_or_delivery';
  }

  if (
    /invoice|receipt|rechnung|quittung|faktura|facture|sz[aá]mla|nyugta|bizonylat/i.test(
      subject,
    )
  ) {
    return 'invoice_or_receipt';
  }

  if (
    /subscription|renewal|renewed|monthly|annual|yearly|el[oő]fizet[eé]s|meg[uú]j[ií]t/i.test(
      subject,
    )
  ) {
    return 'subscription_or_recurring';
  }

  if (
    /order|purchase|bestellung|bestellbest[aä]tigung|rendel[eé]s|megrendel[eé]s|v[aá]s[aá]rl[aá]s/i.test(
      subject,
    )
  ) {
    return 'order_or_purchase';
  }

  return 'other_purchase_category';
}

function senderBucket(message: NormalizedEmail): string | null {
  const domains = message.from.map((item) => domainOf(item.email)).filter(Boolean);
  for (const [bucket, tokens] of knownSenderBuckets) {
    if (domains.some((domain) => tokens.some((token) => domain.includes(token)))) {
      return bucket;
    }
  }
  return null;
}

async function main() {
  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: requireNylasSmokeGrantId(),
  });

  const seenMessageIds = new Set<string>();
  const senderDomains = new Set<string>();
  const threadCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const senderBucketCounts = new Map<string, number>();
  const attachmentExtensionCounts = new Map<string, number>();
  const attachmentMimeCounts = new Map<string, number>();

  let cursor: string | undefined;
  let pages = 0;
  let messagesWithAttachments = 0;
  let totalAttachments = 0;
  let inlineAttachments = 0;
  let missingThreadId = 0;
  let oldestReceivedAt: string | null = null;
  let newestReceivedAt: string | null = null;
  let truncated = false;

  do {
    const page = await provider.searchMessages({
      query: env.EMAIL_DISCOVERY_QUERY,
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    pages += 1;

    for (const message of page.messages) {
      if (seenMessageIds.has(message.providerMessageId)) continue;
      if (seenMessageIds.size >= MAX_MESSAGES) {
        truncated = true;
        break;
      }

      seenMessageIds.add(message.providerMessageId);

      for (const sender of message.from) {
        const domain = domainOf(sender.email);
        if (domain) senderDomains.add(domain);
      }

      const threadId = message.providerThreadId?.trim();
      if (threadId) bump(threadCounts, threadId);
      else missingThreadId += 1;

      bump(categoryCounts, classifyMessage(message));
      const bucket = senderBucket(message);
      if (bucket) bump(senderBucketCounts, bucket);

      if (message.attachments.length > 0) messagesWithAttachments += 1;
      totalAttachments += message.attachments.length;
      for (const attachment of message.attachments) {
        if (attachment.isInline) inlineAttachments += 1;
        bump(attachmentExtensionCounts, extensionOf(attachment.filename));
        bump(
          attachmentMimeCounts,
          (attachment.contentType || 'unknown').toLowerCase().slice(0, 80),
        );
      }

      const receivedAt = message.receivedAt;
      if (!oldestReceivedAt || receivedAt < oldestReceivedAt) oldestReceivedAt = receivedAt;
      if (!newestReceivedAt || receivedAt > newestReceivedAt) newestReceivedAt = receivedAt;
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  const threadSizes = [...threadCounts.values()];
  const multiMessageThreads = threadSizes.filter((count) => count > 1).length;
  const singletonThreads = threadSizes.filter((count) => count === 1).length;
  const maxMessagesPerThread = threadSizes.length > 0 ? Math.max(...threadSizes) : 0;

  const result = {
    mode: 'read_only_aggregate_metadata_audit',
    provider: provider.name,
    query: env.EMAIL_DISCOVERY_QUERY,
    safety: {
      databaseWrites: false,
      bodyOutput: false,
      subjectOutput: false,
      messageIdOutput: false,
      senderAddressOutput: false,
      rawMerchantDomainOutput: false,
    },
    pagination: {
      pageSize: PAGE_SIZE,
      pages,
      maxMessagesSafetyCap: MAX_MESSAGES,
      truncated,
    },
    messages: {
      total: seenMessageIds.size,
      uniqueSenderDomains: senderDomains.size,
      oldestReceivedAt,
      newestReceivedAt,
    },
    threads: {
      uniqueWithThreadId: threadCounts.size,
      missingThreadId,
      singletonThreads,
      multiMessageThreads,
      maxMessagesPerThread,
    },
    classifications: sortedObject(categoryCounts),
    knownInfrastructureSenders: sortedObject(senderBucketCounts),
    attachments: {
      messagesWithAttachments,
      totalAttachments,
      inlineAttachments,
      byExtension: sortedObject(attachmentExtensionCounts),
      byMimeType: sortedObject(attachmentMimeCounts),
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Nylas 30-day read-only audit failed:', error);
  process.exit(1);
});
