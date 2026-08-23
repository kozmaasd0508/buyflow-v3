import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectCarrierTechnicalEvidenceV16 } from './technical-evidence-carrier-v16.js';
import {
  collectTechnicalEvidenceV15,
  type TechnicalEvidencePdfAttachmentV15,
  type TechnicalEvidenceV15,
  type TechnicalEvidenceV15Source,
} from './technical-evidence-v1-5.js';

export const TECHNICAL_EVIDENCE_V16_VERSION = '1.6.0' as const;

export interface TechnicalEvidenceV16Input {
  document: EmailDocumentV1;
  pdfAttachments?: TechnicalEvidencePdfAttachmentV15[];
}

export interface TechnicalEvidenceShadowV16Result {
  schemaVersion: 1;
  collectorVersion: typeof TECHNICAL_EVIDENCE_V16_VERSION;
  mode: 'shadow';
  productionWrites: 0;
  aiCalls: 0;
  evidence: TechnicalEvidenceV15[];
  ranExtractors: Array<{ id: string; version: string; evidenceCount: number }>;
}

function dedupe(rows: TechnicalEvidenceV15[]): TechnicalEvidenceV15[] {
  const seen = new Set<string>();
  const output: TechnicalEvidenceV15[] = [];
  for (const row of rows) {
    const key = [
      row.kind,
      row.normalizedValue ?? row.rawValue,
      row.namespace ?? '',
      row.source,
      row.sourcePath,
      row.extractorId,
    ].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

/**
 * Retro-development collector built on top of the frozen, CI-green v1.5 entry
 * point. v1.5 remains unchanged for Blind Holdout v2. v1.6 only adds provider-
 * authenticated Packeta and Express One carrier semantics learned from the
 * historical retro-generalization set.
 */
export function collectTechnicalEvidenceV16(input: TechnicalEvidenceV16Input): TechnicalEvidenceShadowV16Result {
  const base = collectTechnicalEvidenceV15(input);
  const carrierV16 = collectCarrierTechnicalEvidenceV16(input.document);
  if (base.productionWrites !== 0 || base.aiCalls !== 0 || carrierV16.productionWrites !== 0 || carrierV16.aiCalls !== 0) {
    throw new Error('technical_evidence_v16_requires_zero_write_zero_ai');
  }

  const added = carrierV16.evidence.map((row): TechnicalEvidenceV15 => ({
    kind: row.kind,
    rawValue: row.rawValue,
    normalizedValue: row.normalizedValue,
    ...(row.namespace ? { namespace: row.namespace } : {}),
    source: row.source as TechnicalEvidenceV15Source,
    sourcePath: row.sourcePath,
    extractorId: row.extractorId,
    extractorVersion: row.extractorVersion,
    confidence: row.confidence,
    qualifiers: [...row.qualifiers],
  }));

  return {
    schemaVersion: 1,
    collectorVersion: TECHNICAL_EVIDENCE_V16_VERSION,
    mode: 'shadow',
    productionWrites: 0,
    aiCalls: 0,
    evidence: dedupe([...base.evidence, ...added]),
    ranExtractors: [
      ...base.ranExtractors,
      {
        id: 'carrier-semantic-evidence-v1.6',
        version: '1.6.0',
        evidenceCount: carrierV16.evidence.length,
      },
    ],
  };
}
