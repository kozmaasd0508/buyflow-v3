export type ReviewPurchaseEventType =
  | 'order_created'
  | 'order_updated'
  | 'payment_completed'
  | 'shipment'
  | 'delivery'
  | 'invoice_or_receipt'
  | 'refund'
  | 'return'
  | 'subscription'
  | 'other';

export interface ReviewPurchaseEvidence {
  sourceEmailId: string;
  userId: string;
  senderDomain: string;
  subject: string | null;
  processingStatus: string;
  validationStatus: string | null;
  eventType: ReviewPurchaseEventType | null;
  merchant: string | null;
  merchantLegalName: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  paymentStatus: string | null;
  confidence: number;
  receivedAt: string;
}

export interface ReviewPurchaseSourceLink {
  sourceEmailId: string;
  relationType: string;
  confidence: number;
}

export type ReviewPurchaseDecision = 'create' | 'review';

export interface ReviewPurchaseCandidate {
  key: string;
  userId: string;
  senderDomain: string;
  merchant: string;
  merchantLegalName: string | null;
  orderNumber: string;
  expectedCarrier: string | null;
  orderedAt: string;
  confidence: number;
  decision: ReviewPurchaseDecision;
  anchorSourceEmailId: string;
  sourceLinks: ReviewPurchaseSourceLink[];
  reasons: string[];
}

const TRUSTED_VALIDATION = new Set(['validated', 'guardrailed']);
const TRUSTED_LIFECYCLE = new Set<ReviewPurchaseEventType>([
  'order_updated',
  'shipment',
  'delivery',
  'invoice_or_receipt',
]);

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function textLooksSame(a: string | null, b: string | null): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  return left === right || (
    left.length >= 5 &&
    right.length >= 5 &&
    (left.includes(right) || right.includes(left))
  );
}

function isTrusted(row: ReviewPurchaseEvidence): boolean {
  return Boolean(row.validationStatus && TRUSTED_VALIDATION.has(row.validationStatus));
}

function isPackingLifecycleSubject(subject: string | null): boolean {
  const text = normalizeText(subject);
  if (!text) return false;
  return [
    'osszekeszitettuk',
    'osszekeszites',
    'csomagoljuk',
    'csomagoljak',
    'csomagolasa folyamatban',
    'becsomagoltuk',
    'keszen all a szallitasra',
    'ready for shipment',
    'ready to ship',
    'packing',
    'packed',
  ].some((token) => text.includes(token));
}

function groupKey(row: ReviewPurchaseEvidence): string | null {
  const domain = normalizeDomain(row.senderDomain);
  const order = normalizeIdentifier(row.orderNumber);
  if (!row.userId || !domain || !order) return null;
  return `${row.userId}::${domain}::${order}`;
}

function trustedLifecycleSupport(row: ReviewPurchaseEvidence): boolean {
  if (!isTrusted(row) || !row.eventType) return false;
  if (TRUSTED_LIFECYCLE.has(row.eventType)) return row.confidence >= 0.7;
  if (row.eventType === 'payment_completed') {
    return row.paymentStatus === 'paid' && row.confidence >= 0.75;
  }
  return false;
}

function reviewIdentitySupport(row: ReviewPurchaseEvidence): boolean {
  return (
    row.validationStatus === 'review' &&
    row.eventType === 'payment_completed' &&
    row.paymentStatus === 'failed' &&
    row.confidence >= 0.75
  );
}

function derivedPackingSupport(row: ReviewPurchaseEvidence): boolean {
  return (
    isTrusted(row) &&
    row.eventType === 'order_created' &&
    row.confidence >= 0.75 &&
    isPackingLifecycleSubject(row.subject)
  );
}

function bestByConfidence(rows: ReviewPurchaseEvidence[]): ReviewPurchaseEvidence | null {
  return rows.reduce<ReviewPurchaseEvidence | null>(
    (best, row) => !best || row.confidence > best.confidence ? row : best,
    null,
  );
}

function uniqueLinks(rows: ReviewPurchaseSourceLink[]): ReviewPurchaseSourceLink[] {
  const byId = new Map<string, ReviewPurchaseSourceLink>();
  for (const row of rows) {
    const current = byId.get(row.sourceEmailId);
    if (!current || row.confidence > current.confidence) byId.set(row.sourceEmailId, row);
  }
  return [...byId.values()];
}

export function resolveReviewPurchaseCandidates(
  evidenceRows: ReviewPurchaseEvidence[],
): ReviewPurchaseCandidate[] {
  const groups = new Map<string, ReviewPurchaseEvidence[]>();
  for (const row of evidenceRows) {
    const key = groupKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const candidates: ReviewPurchaseCandidate[] = [];

  for (const [key, rows] of groups) {
    const anchors = rows.filter((row) =>
      row.processingStatus === 'review' &&
      row.eventType === 'order_created' &&
      !isPackingLifecycleSubject(row.subject) &&
      Boolean(row.merchant) &&
      Boolean(row.orderNumber) &&
      row.confidence >= 0.7,
    );
    const anchor = bestByConfidence(anchors);
    if (!anchor?.merchant || !anchor.orderNumber) continue;

    const supportPool = rows.filter((row) => row.sourceEmailId !== anchor.sourceEmailId);
    const trustedSupports = supportPool.filter(trustedLifecycleSupport);
    const identitySupports = supportPool.filter(reviewIdentitySupport);
    const packingSupports = supportPool.filter(derivedPackingSupport);

    const strongestTrusted = bestByConfidence(trustedSupports);
    const strongestPacking = bestByConfidence(packingSupports);
    const strongShipment = trustedSupports.find((row) =>
      row.eventType === 'shipment' &&
      row.confidence >= 0.75 &&
      (
        normalizeIdentifier(row.trackingNumber).length >= 10 ||
        textLooksSame(anchor.merchantLegalName, row.merchantLegalName)
      ),
    );

    const corroborationCount = trustedSupports.length + identitySupports.length + packingSupports.length;
    const reasons: string[] = [];
    let decision: ReviewPurchaseDecision = 'review';
    let confidence = anchor.confidence;

    if (
      anchor.confidence >= 0.85 &&
      (
        (strongestTrusted?.confidence ?? 0) >= 0.74 ||
        (strongestPacking?.confidence ?? 0) >= 0.8
      )
    ) {
      decision = 'create';
      confidence = Math.min(0.97, anchor.confidence + 0.08);
      reasons.push('high_review_order_corroborated_by_lifecycle');
    } else if (
      anchor.confidence >= 0.8 &&
      (strongestTrusted?.confidence ?? 0) >= 0.72 &&
      corroborationCount >= 2
    ) {
      decision = 'create';
      confidence = Math.min(0.95, anchor.confidence + 0.08);
      reasons.push('review_order_corroborated_by_multiple_identity_events');
    } else if (
      anchor.confidence >= 0.7 &&
      strongShipment
    ) {
      decision = 'create';
      confidence = Math.min(0.92, anchor.confidence + 0.12);
      reasons.push(
        normalizeIdentifier(strongShipment.trackingNumber).length >= 10
          ? 'low_review_order_corroborated_by_exact_tracking_shipment'
          : 'low_review_order_corroborated_by_legal_identity_shipment',
      );
    } else {
      reasons.push('review_evidence_below_safe_creation_threshold');
    }

    if (packingSupports.length > 0) reasons.push('packing_subject_used_as_lifecycle_not_second_order');
    if (identitySupports.length > 0) reasons.push('failed_payment_used_for_identity_only');

    const sourceLinks: ReviewPurchaseSourceLink[] = uniqueLinks([
      {
        sourceEmailId: anchor.sourceEmailId,
        relationType: 'order_created',
        confidence: anchor.confidence,
      },
      ...trustedSupports.map((row) => ({
        sourceEmailId: row.sourceEmailId,
        relationType: row.eventType ?? 'evidence',
        confidence: row.confidence,
      })),
      ...packingSupports.map((row) => ({
        sourceEmailId: row.sourceEmailId,
        relationType: 'order_updated',
        confidence: row.confidence,
      })),
    ]);

    const preferredCarrier = trustedSupports.find((row) => row.carrier)?.carrier ?? anchor.carrier;

    candidates.push({
      key,
      userId: anchor.userId,
      senderDomain: normalizeDomain(anchor.senderDomain),
      merchant: anchor.merchant,
      merchantLegalName: anchor.merchantLegalName,
      orderNumber: anchor.orderNumber,
      expectedCarrier: preferredCarrier,
      orderedAt: anchor.receivedAt,
      confidence,
      decision,
      anchorSourceEmailId: anchor.sourceEmailId,
      sourceLinks,
      reasons,
    });
  }

  return candidates.sort((a, b) => a.key.localeCompare(b.key));
}
