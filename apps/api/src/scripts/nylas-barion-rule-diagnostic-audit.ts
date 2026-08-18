import { env, requireNylasSmokeGrantId } from '../config.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { protocolDetectionInputFromEmail } from '../protocols/email-input.js';

const PAGE_SIZE = 20;
const MAX_MESSAGES = 10_000;
const MAX_RETRIES = 6;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const BARION_ADDRESSES = new Set(['barion@barion.com', 'noreply@barion.com']);

type ErrorLike = { statusCode?: unknown; headers?: unknown };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusCodeOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as ErrorLike).statusCode;
  return typeof value === 'number' ? value : null;
}

function retryAfterMsOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const headers = (error as ErrorLike).headers;
  if (!headers || typeof headers !== 'object') return null;
  const raw = (headers as Record<string, unknown>)['retry-after'];
  const seconds = typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

async function withRetry<T>(operation: () => Promise<T>, onRetry: () => void): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const status = statusCodeOf(error);
      if (status === null || !RETRYABLE_STATUS_CODES.has(status) || attempt >= MAX_RETRIES) throw error;
      const retryAfter = retryAfterMsOf(error) ?? 0;
      const backoff = Math.min(60_000, 5_000 * (2 ** attempt));
      onRetry();
      attempt += 1;
      await sleep(Math.max(retryAfter, backoff) + Math.floor(Math.random() * 750));
    }
  }
}

function isBarionSender(message: NormalizedEmail): boolean {
  return message.from.some((sender) => BARION_ADDRESSES.has(sender.email.trim().toLowerCase()));
}

function hasExactSenderAddress(input: ReturnType<typeof protocolDetectionInputFromEmail>): boolean {
  return (input.senderAddresses ?? []).some((address) => BARION_ADDRESSES.has(address.trim().toLowerCase()));
}

function hasBarionSenderDomain(input: ReturnType<typeof protocolDetectionInputFromEmail>): boolean {
  return input.senderDomains.some((domain) => domain === 'barion.com' || domain.endsWith('.barion.com'));
}

function hasBarionDkim(input: ReturnType<typeof protocolDetectionInputFromEmail>): boolean {
  return (input.dkimDomains ?? []).some((domain) => domain === 'barion.com' || domain.endsWith('.barion.com'));
}

function hasSuccessSubject(input: ReturnType<typeof protocolDetectionInputFromEmail>): boolean {
  return /^Sikeres fizet[eé]s$/i.test(input.subject ?? '');
}

function hasSuccessBody(input: ReturnType<typeof protocolDetectionInputFromEmail>): boolean {
  return /Sikeresen\s+fizett[eé]l\s+[0-9][0-9 .\u00a0]*\s*Ft-ot\s+bankk[aá]rty[aá]val/i.test(input.bodyText ?? '');
}

function hasPaymentId(input: ReturnType<typeof protocolDetectionInputFromEmail>): boolean {
  return /Fizet[eé]s Barion azonos[ií]t[oó]ja\s*:\s*[0-9a-f]{32}/i.test(input.bodyText ?? '');
}

function hasBodyText(input: ReturnType<typeof protocolDetectionInputFromEmail>): boolean {
  return Boolean((input.bodyText ?? '').trim());
}

async function main(): Promise<void> {
  const grantId = requireNylasSmokeGrantId();
  const provider = createEmailProvider({ provider: 'nylas', providerAccountId: grantId });
  const seen = new Set<string>();

  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let rateLimitRetries = 0;
  let barionSenderCandidates = 0;
  let fullMessageFetches = 0;
  let fullMessageFetchFailures = 0;
  let senderAddressPass = 0;
  let senderDomainPass = 0;
  let dkimPass = 0;
  let subjectPass = 0;
  let bodyTextPresent = 0;
  let successBodyPass = 0;
  let paymentIdPass = 0;
  let semanticTriplePass = 0;
  let allFourRequiredPass = 0;
  let semanticTripleWithoutDkim = 0;
  let semanticTripleWithNoDkimDomainsAtAll = 0;
  let semanticTripleWithSomeOtherDkimDomain = 0;

  do {
    const page = await withRetry(
      () => provider.searchMessages({
        query: env.EMAIL_DISCOVERY_QUERY,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
      () => { rateLimitRetries += 1; },
    );
    pages += 1;

    for (const listed of page.messages) {
      if (seen.has(listed.providerMessageId)) continue;
      if (seen.size >= MAX_MESSAGES) {
        truncated = true;
        break;
      }
      seen.add(listed.providerMessageId);
      if (!isBarionSender(listed)) continue;

      barionSenderCandidates += 1;
      fullMessageFetches += 1;
      let full: NormalizedEmail;
      try {
        full = await withRetry(
          () => provider.getMessage(listed.providerMessageId),
          () => { rateLimitRetries += 1; },
        );
      } catch {
        fullMessageFetchFailures += 1;
        continue;
      }

      const input = protocolDetectionInputFromEmail(full);
      const senderAddress = hasExactSenderAddress(input);
      const senderDomain = hasBarionSenderDomain(input);
      const dkim = hasBarionDkim(input);
      const subject = hasSuccessSubject(input);
      const bodyPresent = hasBodyText(input);
      const bodySuccess = hasSuccessBody(input);
      const paymentId = hasPaymentId(input);
      const semanticTriple = subject && bodySuccess && paymentId;

      if (senderAddress) senderAddressPass += 1;
      if (senderDomain) senderDomainPass += 1;
      if (dkim) dkimPass += 1;
      if (subject) subjectPass += 1;
      if (bodyPresent) bodyTextPresent += 1;
      if (bodySuccess) successBodyPass += 1;
      if (paymentId) paymentIdPass += 1;
      if (semanticTriple) semanticTriplePass += 1;
      if (semanticTriple && dkim) allFourRequiredPass += 1;
      if (semanticTriple && !dkim) {
        semanticTripleWithoutDkim += 1;
        if ((input.dkimDomains ?? []).length === 0) semanticTripleWithNoDkimDomainsAtAll += 1;
        else semanticTripleWithSomeOtherDkimDomain += 1;
      }
    }

    if (truncated) break;
    cursor = page.nextCursor;
  } while (cursor);

  console.log(JSON.stringify({
    mode: 'read_only_barion_rule_diagnostic_audit_v2',
    safety: {
      databaseWrites: false,
      mailboxWrites: false,
      rawBodyOutput: false,
      rawSubjectOutput: false,
      messageIdOutput: false,
      senderOutput: false,
      dkimDomainOutput: false,
      paymentReferenceOutput: false,
      amountOutput: false,
    },
    scope: {
      totalMessages: seen.size,
      pages,
      truncated,
      rateLimitRetries,
      barionSenderCandidates,
      fullMessageFetches,
      fullMessageFetchFailures,
    },
    ruleCoverage: {
      senderAddressPass,
      senderDomainPass,
      dkimPass,
      subjectPass,
      bodyTextPresent,
      successBodyPass,
      paymentIdPass,
      semanticTriplePass,
      allFourRequiredPass,
      semanticTripleWithoutDkim,
      semanticTripleWithNoDkimDomainsAtAll,
      semanticTripleWithSomeOtherDkimDomain,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    mode: 'read_only_barion_rule_diagnostic_audit_v2',
    status: 'failed',
    errorKind: error instanceof Error ? error.name : 'UnknownError',
    statusCode: statusCodeOf(error),
    rawErrorOutput: false,
  }));
  process.exit(1);
});
