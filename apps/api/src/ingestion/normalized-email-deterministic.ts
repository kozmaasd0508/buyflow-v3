import { htmlToCompactText } from '../ai/openai-email-extractor.js';
import type { NormalizedEmail } from '../email/types.js';
import {
  parseDeterministicCommerceEmail,
  type DeterministicCommerceParseResult,
} from './deterministic-commerce-parser.js';

const DEFAULT_BODY_MAX_CHARS = 80_000;

export interface DeterministicNormalizedEmailInput {
  senderDomains: string[];
  subject?: string | null;
  bodyText: string;
}

function senderDomains(email: NormalizedEmail): string[] {
  return [...new Set(
    email.from
      .map((address) => address.email.trim().toLowerCase())
      .map((address) => address.slice(address.lastIndexOf('@') + 1))
      .filter((domain) => Boolean(domain) && !domain.includes('@')),
  )];
}

export function normalizedEmailToDeterministicInput(
  email: NormalizedEmail,
  maxChars = DEFAULT_BODY_MAX_CHARS,
): DeterministicNormalizedEmailInput {
  const bodyText = email.bodyHtml
    ? htmlToCompactText(email.bodyHtml, maxChars)
    : (email.snippet ?? '').trim().slice(0, maxChars);

  return {
    senderDomains: senderDomains(email),
    subject: email.subject ?? null,
    bodyText,
  };
}

export function parseNormalizedDeterministicEmail(
  email: NormalizedEmail,
): DeterministicCommerceParseResult | null {
  return parseDeterministicCommerceEmail(
    normalizedEmailToDeterministicInput(email),
  );
}
