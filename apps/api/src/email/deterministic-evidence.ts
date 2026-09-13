import type { NormalizedEmail } from './types.js';
import { normalizeMailLensText } from './mail-lens-text.js';

/** Shared boundary for automatic parsers; raw email remains available for storage. */
export function prepareDeterministicEvidence(email: NormalizedEmail, maxChars = 80_000) {
  const text = normalizeMailLensText(email, maxChars);
  const inheritedSubject = /^\s*(?:(?:re|fw|fwd|aw|wg|sv|válasz|valasz|továbbítás|tovabbitas)\s*(?:\[\d+\])?\s*:)/i.test(email.subject ?? '');
  const normalization = { ...text.normalization, inheritedSubjectIgnored: inheritedSubject };
  return {
    subject: inheritedSubject ? null : email.subject ?? null,
    bodyText: text.semanticText,
    normalization,
    // A truncated or empty current body cannot establish automatic write authority.
    canParseAutomatically: Boolean(text.semanticText && !text.normalization.semanticTextTruncated),
  };
}
