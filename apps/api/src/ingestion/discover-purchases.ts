import type { EmailProvider } from '../email/provider.js';
import type { SourceEmailRepository } from '../source-emails/repository.js';

export interface DiscoverPurchaseCandidatesInput {
  provider: EmailProvider;
  sourceEmails: SourceEmailRepository;
  userId: string;
  emailConnectionId: string;
  query: string;
  pageSize?: number;
  maxPages?: number;
  maxCreated?: number;
}

export interface DiscoverPurchaseCandidatesResult {
  checked: number;
  created: number;
  duplicates: number;
  pages: number;
  hasMore: boolean;
}

export async function discoverPurchaseCandidates(
  input: DiscoverPurchaseCandidatesInput,
): Promise<DiscoverPurchaseCandidatesResult> {
  const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 200);
  const maxPages = Math.min(Math.max(input.maxPages ?? 50, 1), 500);
  const maxCreated = input.maxCreated === undefined
    ? Number.POSITIVE_INFINITY
    : Math.min(Math.max(input.maxCreated, 1), 10_000);

  let cursor: string | undefined;
  let checked = 0;
  let created = 0;
  let duplicates = 0;
  let pages = 0;
  let stoppedInsidePage = false;

  do {
    const page = await input.provider.searchMessages({
      query: input.query,
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
    });

    pages += 1;

    for (let index = 0; index < page.messages.length; index += 1) {
      const email = page.messages[index];
      if (!email) continue;

      checked += 1;

      const saved = await input.sourceEmails.insertIfNew({
        userId: input.userId,
        emailConnectionId: input.emailConnectionId,
        sourceQuery: input.query,
        email,
      });

      if (saved.created) {
        created += 1;
      } else {
        duplicates += 1;
      }

      if (created >= maxCreated) {
        stoppedInsidePage = index < page.messages.length - 1;
        cursor = page.nextCursor;
        break;
      }
    }

    if (created >= maxCreated) {
      break;
    }

    cursor = page.nextCursor;
  } while (cursor && pages < maxPages);

  return {
    checked,
    created,
    duplicates,
    pages,
    hasMore: stoppedInsidePage || Boolean(cursor),
  };
}
