import type { DocumentResolutionCandidate } from './document-resolution.js';

export function selectControlledDocumentCandidate(
  candidates: DocumentResolutionCandidate[],
): DocumentResolutionCandidate {
  const linkable = candidates.filter((candidate) => candidate.decision === 'linkable');

  if (linkable.length !== 1) {
    throw new Error(`Expected exactly one linkable document candidate, got ${linkable.length}`);
  }

  const candidate = linkable[0]!;

  if (!candidate.purchaseId) {
    throw new Error('Controlled document candidate has no purchase');
  }
  if (candidate.documentType !== 'invoice') {
    throw new Error('First controlled document write requires an invoice');
  }
  if (candidate.confidence < 0.85) {
    throw new Error('Controlled document candidate confidence is too low');
  }

  return candidate;
}
