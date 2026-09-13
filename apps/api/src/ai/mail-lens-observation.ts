import type { NormalizedEmail } from '../email/types.js';
import { normalizeMailLensText } from '../email/mail-lens-text.js';
import { extractEmailWithOpenAIResult } from './openai-email-extractor.js';

/** Extraction and validation must consume exactly the same authored evidence. */
export async function extractMailLensObservation(input: {
  email: NormalizedEmail;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}) {
  const normalized = normalizeMailLensText(input.email);
  const evidence = {
    subject: input.email.subject,
    fromDomains: [...new Set(input.email.from.map(address => address.email.trim().toLowerCase())
      .filter(address => address.includes('@')).map(address => address.slice(address.lastIndexOf('@') + 1)).filter(Boolean))],
    bodyText: normalized.semanticText,
    normalization: normalized.normalization,
  };
  const result = await extractEmailWithOpenAIResult({
    ...evidence, apiKey: input.apiKey, model: input.model, fetchImpl: input.fetchImpl,
  });
  return { result, evidence };
}
