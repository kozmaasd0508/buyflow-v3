import type { EmailProvider } from '../email/provider.js';

export const GMAIL_PURCHASES_QUERY = 'category:purchases newer_than:7d -in:spam -in:trash';
export const GMAIL_PURCHASES_GATE_MAX_ATTEMPTS = 2;
const GMAIL_PURCHASES_GATE_PAGE_LIMIT = 200;
const GMAIL_PURCHASES_GATE_MAX_PAGES = 5;

export type GmailPurchasesGateDecision = 'pass' | 'retry' | 'reject';

export function decideGmailPurchasesGate(
  foundInPurchases: boolean,
  attempts: number,
): GmailPurchasesGateDecision {
  if (foundInPurchases) return 'pass';
  return attempts < GMAIL_PURCHASES_GATE_MAX_ATTEMPTS ? 'retry' : 'reject';
}

export async function isMessageInGmailPurchases(
  provider: EmailProvider,
  providerMessageId: string,
): Promise<boolean> {
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < GMAIL_PURCHASES_GATE_MAX_PAGES; pageNumber += 1) {
    const page = await provider.searchMessages({
      query: GMAIL_PURCHASES_QUERY,
      limit: GMAIL_PURCHASES_GATE_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });

    if (page.messages.some((message) => message.providerMessageId === providerMessageId)) {
      return true;
    }

    if (!page.nextCursor) return false;
    cursor = page.nextCursor;
  }

  return false;
}
