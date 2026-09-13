import { prepareDeterministicEvidence } from '../email/deterministic-evidence.js';
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
  canParseAutomatically: boolean;
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
  const evidence = prepareDeterministicEvidence(email, maxChars);

  return {
    senderDomains: senderDomains(email),
    ...evidence,
  };
}

export function parseNormalizedDeterministicEmail(
  email: NormalizedEmail,
): DeterministicCommerceParseResult | null {
  const input = normalizedEmailToDeterministicInput(email);
  return input.canParseAutomatically ? parseDeterministicCommerceEmail(input) : null;
}
