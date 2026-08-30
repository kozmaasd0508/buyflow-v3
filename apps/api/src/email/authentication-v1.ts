import type {
  EmailAuthenticationResults,
  EmailAuthenticationVerdict,
} from './document-v1.js';
import type { EmailHeader } from './types.js';

const SUPPORTED = new Set<EmailAuthenticationVerdict>([
  'pass',
  'fail',
  'softfail',
  'neutral',
  'none',
  'temperror',
  'permerror',
]);

function normalizedVerdict(value: string | undefined): EmailAuthenticationVerdict {
  const normalized = value?.trim().toLowerCase() as EmailAuthenticationVerdict | undefined;
  return normalized && SUPPORTED.has(normalized) ? normalized : 'unknown';
}

function valuesFor(headers: EmailHeader[], name: string): string[] {
  return headers
    .filter((header) => header.name.trim().toLowerCase() === name)
    .map((header) => header.value);
}

function collectMethodVerdicts(values: string[], method: 'dkim' | 'spf' | 'dmarc') {
  const verdicts = new Set<EmailAuthenticationVerdict>();
  const matcher = new RegExp(`\\b${method}\\s*=\\s*([a-z_]+)`, 'gi');
  for (const value of values) {
    for (const match of value.matchAll(matcher)) {
      const verdict = normalizedVerdict(match[1]);
      if (verdict !== 'unknown') verdicts.add(verdict);
    }
  }
  return verdicts;
}

function collapse(verdicts: Set<EmailAuthenticationVerdict>): EmailAuthenticationVerdict {
  if (verdicts.size !== 1) return 'unknown';
  return [...verdicts][0] ?? 'unknown';
}

/**
 * Normalizes authentication evidence without upgrading conflicting or missing
 * provider headers into trust. Multiple contradictory verdicts become unknown.
 */
export function extractEmailAuthenticationResults(
  headers: EmailHeader[],
): EmailAuthenticationResults {
  const authResults = valuesFor(headers, 'authentication-results');
  const arcResults = authResults.length === 0
    ? valuesFor(headers, 'arc-authentication-results')
    : [];
  const source = authResults.length > 0 ? authResults : arcResults;

  const dkim = collapse(collectMethodVerdicts(source, 'dkim'));
  let spf = collapse(collectMethodVerdicts(source, 'spf'));
  const dmarc = collapse(collectMethodVerdicts(source, 'dmarc'));

  if (spf === 'unknown') {
    const receivedSpf = valuesFor(headers, 'received-spf');
    const receivedVerdicts = new Set<EmailAuthenticationVerdict>();
    for (const value of receivedSpf) {
      const token = value.trim().match(/^([a-z_]+)/i)?.[1];
      const verdict = normalizedVerdict(token);
      if (verdict !== 'unknown') receivedVerdicts.add(verdict);
    }
    spf = collapse(receivedVerdicts);
  }

  return { dkim, spf, dmarc };
}
