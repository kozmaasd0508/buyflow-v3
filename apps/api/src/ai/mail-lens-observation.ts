import type { NormalizedEmail } from '../email/types.js';
import { prepareDeterministicEvidence } from '../email/deterministic-evidence.js';
import { extractEmailWithOpenAIResult } from './openai-email-extractor.js';

function formatSender(address: NormalizedEmail['from'][number]): string {
  const email = address.email.trim();
  const name = address.name?.trim();
  if (!email) return name ?? '';
  return name ? `${name} <${email}>` : email;
}

/** Extraction and validation must consume exactly the same authored evidence. */
export async function extractMailLensObservation(input: {
  email: NormalizedEmail;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}) {
  const normalized = prepareDeterministicEvidence(input.email, 20_000);
  const evidence = {
    subject: normalized.subject ?? undefined,
    from: input.email.from.map(formatSender).filter(Boolean),
    receivedAt: input.email.receivedAt,
    fromDomains: [...new Set(input.email.from.map(address => address.email.trim().toLowerCase())
      .filter(address => address.includes('@')).map(address => address.slice(address.lastIndexOf('@') + 1)).filter(Boolean))],
    bodyText: normalized.bodyText,
    normalization: normalized.normalization,
  };
  const result = await extractEmailWithOpenAIResult({
    ...evidence,
    diagnostics: {
      truncated: normalized.normalization.semanticTextTruncated,
      snippetOnly: normalized.normalization.bodyTextSource === 'snippet',
      emptyBody: !normalized.bodyText.trim(),
    },
    apiKey: input.apiKey, model: input.model, fetchImpl: input.fetchImpl,
  });
  return { result, evidence };
}
