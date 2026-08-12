import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmailProvider } from '../email/provider.js';
import type { NormalizedEmail } from '../email/types.js';
import type {
  SaveSourceEmailInput,
  SourceEmailRepository,
} from '../source-emails/repository.js';
import { discoverPurchaseCandidates } from './discover-purchases.js';

function email(id: string): NormalizedEmail {
  return {
    provider: 'nylas',
    providerMessageId: id,
    from: [{ email: 'shop@example.com' }],
    to: [{ email: 'buyer@example.com' }],
    cc: [],
    bcc: [],
    receivedAt: '2026-08-12T10:00:00.000Z',
    folders: [],
    attachments: [],
  };
}

test('paginates discovery and counts duplicates without creating them again', async () => {
  const requestedCursors: Array<string | undefined> = [];

  const provider: EmailProvider = {
    name: 'nylas',
    async getMessage() {
      throw new Error('not used');
    },
    async searchMessages(input) {
      requestedCursors.push(input.cursor);

      if (!input.cursor) {
        return {
          messages: [email('m1'), email('m2')],
          nextCursor: 'page-2',
        };
      }

      return {
        messages: [email('m3')],
      };
    },
  };

  const seen = new Set<string>(['m2']);
  const saved: SaveSourceEmailInput[] = [];

  const repository: SourceEmailRepository = {
    async insertIfNew(input) {
      saved.push(input);
      const id = input.email.providerMessageId;

      if (seen.has(id)) {
        return { created: false };
      }

      seen.add(id);
      return { created: true, id: `row-${id}` };
    },
  };

  const result = await discoverPurchaseCandidates({
    provider,
    sourceEmails: repository,
    userId: '00000000-0000-4000-8000-000000000001',
    emailConnectionId: '00000000-0000-4000-8000-000000000002',
    query: 'category:purchases newer_than:30d',
    pageSize: 2,
  });

  assert.deepEqual(requestedCursors, [undefined, 'page-2']);
  assert.equal(saved.length, 3);
  assert.deepEqual(result, {
    checked: 3,
    created: 2,
    duplicates: 1,
    pages: 2,
    hasMore: false,
  });
});

test('stops after the requested number of new messages while skipping duplicates', async () => {
  const provider: EmailProvider = {
    name: 'nylas',
    async getMessage() {
      throw new Error('not used');
    },
    async searchMessages() {
      return {
        messages: [email('old-1'), email('old-2'), email('new-1'), email('new-2'), email('new-3')],
        nextCursor: 'page-2',
      };
    },
  };

  const seen = new Set<string>(['old-1', 'old-2']);
  const repository: SourceEmailRepository = {
    async insertIfNew(input) {
      const id = input.email.providerMessageId;
      if (seen.has(id)) return { created: false };
      seen.add(id);
      return { created: true, id: `row-${id}` };
    },
  };

  const result = await discoverPurchaseCandidates({
    provider,
    sourceEmails: repository,
    userId: '00000000-0000-4000-8000-000000000001',
    emailConnectionId: '00000000-0000-4000-8000-000000000002',
    query: 'category:purchases newer_than:30d',
    pageSize: 5,
    maxCreated: 2,
  });

  assert.deepEqual(result, {
    checked: 4,
    created: 2,
    duplicates: 2,
    pages: 1,
    hasMore: true,
  });
  assert.equal(seen.has('new-3'), false);
});
