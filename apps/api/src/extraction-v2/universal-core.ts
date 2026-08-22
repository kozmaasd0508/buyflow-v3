import type { EmailDocumentV1 } from '../ingestion/email-document.js';
import { collectEvidence, type EvidenceCollectionResult, type EvidenceExtractor } from './collector.js';
import { universalInvoicePaymentReferenceExtractor } from './invoice-payment-reference-extractor.js';
import { universalMerchantExtractor } from './merchant-extractor.js';
import { universalMoneyExtractor } from './money-extractor.js';
import { universalOrderNumberExtractor } from './order-number-extractor.js';
import { universalPaymentStatusExtractor } from './payment-status-extractor.js';
import { universalProductExtractor } from './product-extractor.js';
import { universalTrackingNumberExtractor } from './tracking-number-extractor.js';

export const UNIVERSAL_CORE_EXTRACTORS: EvidenceExtractor[] = [
  universalOrderNumberExtractor,
  universalTrackingNumberExtractor,
  universalMoneyExtractor,
  universalMerchantExtractor,
  universalPaymentStatusExtractor,
  universalInvoicePaymentReferenceExtractor,
  universalProductExtractor,
];

export function collectUniversalCoreEvidence(document: EmailDocumentV1): EvidenceCollectionResult {
  return collectEvidence(document, UNIVERSAL_CORE_EXTRACTORS);
}
