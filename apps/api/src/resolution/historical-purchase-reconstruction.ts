import { normalizeCarrierSlug } from './shipment-resolution.js';

export type HistoricalReconstructionEventType =
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

export interface HistoricalReconstructionEvidence {
  sourceEmailId: string;
  userId: string;
  emailConnectionId: string;
  senderDomain: string;
  isCarrierSender: boolean;
  processingStatus: string;
  validationStatus: string | null;
  eventType: HistoricalReconstructionEventType | null;
  merchant: string | null;
  merchantLegalName: string | null;
  orderNumber: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  paymentStatus: string | null;
  confidence: number;
  receivedAt: string;
  parcelSender?: string | null;
  codAmount?: number | null;
  codCurrency?: string | null;
  shipmentPhase?: string | null;
}

export interface HistoricalReconstructionExistingPurchase {
  userId: string;
  merchantDomain: string | null;
  orderNumber: string | null;
}

export interface HistoricalReconstructionSearchProof {
  key: string;
  status: 'processed';
  windowDays: 90;
  checked: number;
  purchaseWrites: number;
}

export interface HistoricalReconstructionSourceLink {
  sourceEmailId: string;
  relationType: string;
  confidence: number;
}

export interface HistoricalReconstructionCandidate {
  key: string;
  userId: string;
  emailConnectionId: string;
  senderDomain: string;
  merchant: string;
  merchantLegalName: string | null;
  orderNumber: string;
  expectedCarrier: string;
  orderedAt: string | null;
  confidence: number;
  trackingNumber: string;
  sourceLinks: HistoricalReconstructionSourceLink[];
  carrierProofSourceEmailIds: string[];
  reasons: string[];
}

const TRUSTED_VALIDATION = new Set(['validated', 'guardrailed']);
const MIN_INVOICE_CONFIDENCE = 0.65;
const MIN_SHIPMENT_CONFIDENCE = 0.75;
const MIN_AUXILIARY_CONFIDENCE = 0.7;
const MIN_CARRIER_CONFIDENCE = 0.85;
const MAX_MERCHANT_CHAIN_DAYS = 14;
const MAX_CARRIER_LAG_DAYS = 7;
const MIN_ORDER_LENGTH = 6;
const MIN_TRACKING_LENGTH = 10;
const MIN_CLUSTER_SOURCES = 2;

function normalizeDomain(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function normalizeCurrency(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function compactParty(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:kft|zrt|nyrt|bt|rt|gmbh|ltd|llc|inc|ag)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function partyLooksSame(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = compactParty(left);
  const b = compactParty(right);
  if (a.length < 6 || b.length < 6) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function instant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withinDays(a: string, b: string, days: number): boolean {
  const left = instant(a);
  const right = instant(b);
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= days * 86_400_000;
}

function isTrusted(row: HistoricalReconstructionEvidence): boolean {
  return Boolean(row.validationStatus && TRUSTED_VALIDATION.has(row.validationStatus));
}

function isUnresolved(row: HistoricalReconstructionEvidence): boolean {
  return row.processingStatus === 'review' || row.processingStatus === 'unlinked';
}

export function historicalReconstructionGroupKey(
  row: Pick<HistoricalReconstructionEvidence, 'userId' | 'senderDomain' | 'orderNumber' | 'isCarrierSender'>,
): string | null {
  if (row.isCarrierSender) return null;
  const domain = normalizeDomain(row.senderDomain);
  const order = normalizeIdentifier(row.orderNumber);
  if (!row.userId || !domain || order.length < MIN_ORDER_LENGTH || order.length > 120) return null;
  return `${row.userId}::${domain}::${order}`;
}

function existingKeys(rows: HistoricalReconstructionExistingPurchase[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const domain = normalizeDomain(row.merchantDomain);
    const order = normalizeIdentifier(row.orderNumber);
    if (row.userId && domain && order) keys.add(`${row.userId}::${domain}::${order}`);
  }
  return keys;
}

function uniqueLinks(rows: HistoricalReconstructionSourceLink[]): HistoricalReconstructionSourceLink[] {
  const bySource = new Map<string, HistoricalReconstructionSourceLink>();
  for (const row of rows) {
    const current = bySource.get(row.sourceEmailId);
    if (!current || row.confidence > current.confidence) bySource.set(row.sourceEmailId, row);
  }
  return [...bySource.values()];
}

function bestByConfidence(rows: HistoricalReconstructionEvidence[]): HistoricalReconstructionEvidence | null {
  return rows.reduce<HistoricalReconstructionEvidence | null>(
    (best, row) => !best || row.confidence > best.confidence ? row : best,
    null,
  );
}

interface CarrierCluster {
  trackingNumber: string;
  carrier: string;
  rows: HistoricalReconstructionEvidence[];
  codAmount: number;
  codCurrency: string;
}

function consistentCod(rows: HistoricalReconstructionEvidence[]): { amount: number; currency: string } | null {
  const codRows = rows.filter((row) =>
    typeof row.codAmount === 'number' && Number.isFinite(row.codAmount) && normalizeCurrency(row.codCurrency),
  );
  if (codRows.length === 0) return null;
  const amount = codRows[0]!.codAmount!;
  const currency = normalizeCurrency(codRows[0]!.codCurrency);
  if (!codRows.every((row) =>
    typeof row.codAmount === 'number' &&
    Math.abs(row.codAmount - amount) < 0.001 &&
    normalizeCurrency(row.codCurrency) === currency,
  )) return null;
  return { amount, currency };
}

function hasPhysicalProgress(rows: HistoricalReconstructionEvidence[]): boolean {
  return rows.some((row) =>
    row.eventType === 'delivery' ||
    (Boolean(row.shipmentPhase) && row.shipmentPhase !== 'shipment_created'),
  );
}

function carrierClustersForMerchantShipment(
  allEvidence: HistoricalReconstructionEvidence[],
  invoice: HistoricalReconstructionEvidence,
  merchantShipment: HistoricalReconstructionEvidence,
): CarrierCluster[] {
  const groups = new Map<string, HistoricalReconstructionEvidence[]>();

  for (const row of allEvidence) {
    if (
      row.userId !== invoice.userId ||
      !row.isCarrierSender ||
      !isUnresolved(row) ||
      !isTrusted(row) ||
      (row.eventType !== 'shipment' && row.eventType !== 'delivery') ||
      row.confidence < MIN_CARRIER_CONFIDENCE
    ) continue;

    const tracking = normalizeIdentifier(row.trackingNumber);
    const carrierSlug = normalizeCarrierSlug(row.carrier);
    if (tracking.length < MIN_TRACKING_LENGTH || !carrierSlug) continue;
    if (!withinDays(row.receivedAt, merchantShipment.receivedAt, MAX_CARRIER_LAG_DAYS)) continue;
    if (!withinDays(row.receivedAt, invoice.receivedAt, MAX_CARRIER_LAG_DAYS)) continue;

    const key = `${row.userId}::${carrierSlug}::${tracking}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const clusters: CarrierCluster[] = [];
  for (const rows of groups.values()) {
    if (new Set(rows.map((row) => row.sourceEmailId)).size < MIN_CLUSTER_SOURCES) continue;
    if (!hasPhysicalProgress(rows)) continue;
    const cod = consistentCod(rows);
    if (!cod) continue;
    if (!rows.some((row) =>
      partyLooksSame(row.parcelSender, invoice.merchant) ||
      partyLooksSame(row.parcelSender, invoice.merchantLegalName),
    )) continue;

    const first = rows[0]!;
    const trackingNumber = normalizeIdentifier(first.trackingNumber);
    const carrier = first.carrier?.trim() ?? '';
    if (!trackingNumber || !carrier) continue;
    clusters.push({ trackingNumber, carrier, rows, codAmount: cod.amount, codCurrency: cod.currency });
  }

  return clusters;
}

export function resolveHistoricalPurchaseReconstructions(
  evidenceRows: HistoricalReconstructionEvidence[],
  searchProofs: HistoricalReconstructionSearchProof[],
  purchases: HistoricalReconstructionExistingPurchase[] = [],
): HistoricalReconstructionCandidate[] {
  const existing = existingKeys(purchases);
  const proofByKey = new Map(searchProofs.map((proof) => [proof.key, proof]));
  const merchantGroups = new Map<string, HistoricalReconstructionEvidence[]>();

  for (const row of evidenceRows) {
    const key = historicalReconstructionGroupKey(row);
    if (!key) continue;
    const group = merchantGroups.get(key) ?? [];
    group.push(row);
    merchantGroups.set(key, group);
  }

  const candidates: HistoricalReconstructionCandidate[] = [];

  for (const [key, merchantRows] of merchantGroups) {
    if (existing.has(key)) continue;

    const proof = proofByKey.get(key);
    if (!proof || proof.status !== 'processed' || proof.windowDays !== 90 || proof.checked < 1 || proof.purchaseWrites !== 0) {
      continue;
    }

    if (merchantRows.some((row) => row.eventType === 'order_created')) continue;

    const invoices = merchantRows.filter((row) =>
      row.validationStatus === 'validated' &&
      row.eventType === 'invoice_or_receipt' &&
      Boolean(row.merchant?.trim()) &&
      row.confidence >= MIN_INVOICE_CONFIDENCE,
    );
    const invoice = bestByConfidence(invoices);
    if (!invoice?.merchant || !invoice.orderNumber) continue;

    const shipments = merchantRows.filter((row) =>
      isTrusted(row) &&
      row.eventType === 'shipment' &&
      row.confidence >= MIN_SHIPMENT_CONFIDENCE &&
      normalizeIdentifier(row.trackingNumber).length >= MIN_TRACKING_LENGTH &&
      Boolean(row.carrier?.trim()) &&
      withinDays(row.receivedAt, invoice.receivedAt, MAX_MERCHANT_CHAIN_DAYS),
    ).sort((a, b) => b.confidence - a.confidence);

    let shipment: HistoricalReconstructionEvidence | null = null;
    let carrierProofRows: HistoricalReconstructionEvidence[] = [];
    for (const candidateShipment of shipments) {
      const tracking = normalizeIdentifier(candidateShipment.trackingNumber);
      const matchingCarrierRows = evidenceRows.filter((row) =>
        row.userId === candidateShipment.userId &&
        row.isCarrierSender &&
        isUnresolved(row) &&
        isTrusted(row) &&
        (row.eventType === 'shipment' || row.eventType === 'delivery') &&
        row.confidence >= MIN_CARRIER_CONFIDENCE &&
        normalizeIdentifier(row.trackingNumber) === tracking &&
        withinDays(row.receivedAt, candidateShipment.receivedAt, MAX_CARRIER_LAG_DAYS),
      );
      if (matchingCarrierRows.length > 0) {
        shipment = candidateShipment;
        carrierProofRows = matchingCarrierRows;
        break;
      }
    }

    if (shipment?.trackingNumber && shipment.carrier) {
      const auxiliaryRows = merchantRows.filter((row) =>
        row.sourceEmailId !== invoice.sourceEmailId &&
        row.sourceEmailId !== shipment?.sourceEmailId &&
        isTrusted(row) &&
        (row.eventType === 'order_updated' || row.eventType === 'delivery') &&
        row.confidence >= MIN_AUXILIARY_CONFIDENCE &&
        withinDays(row.receivedAt, invoice.receivedAt, MAX_MERCHANT_CHAIN_DAYS),
      );
      if (auxiliaryRows.length > 0) {
        const chainRows = [invoice, shipment, ...auxiliaryRows];
        const timestamps = chainRows
          .map((row) => instant(row.receivedAt))
          .filter((value): value is number => value !== null);
        if (timestamps.length === chainRows.length) {
          const sourceLinks = uniqueLinks([
            {
              sourceEmailId: invoice.sourceEmailId,
              relationType: 'invoice_or_receipt',
              confidence: invoice.confidence,
            },
            {
              sourceEmailId: shipment.sourceEmailId,
              relationType: 'shipment',
              confidence: shipment.confidence,
            },
            ...auxiliaryRows.map((row) => ({
              sourceEmailId: row.sourceEmailId,
              relationType: row.eventType ?? 'evidence',
              confidence: row.confidence,
            })),
          ]);

          const reasons = [
            'ninety_day_exact_order_search_completed_without_purchase',
            'validated_invoice_matches_merchant_order_identity',
            'merchant_shipment_has_long_tracking_identity',
            'unresolved_carrier_sender_confirms_exact_tracking_identity',
            'additional_merchant_lifecycle_event_corroborates_chain',
            'no_order_created_source_exists',
          ];
          if (auxiliaryRows.some((row) => row.eventType === 'delivery')) {
            reasons.push('merchant_delivery_corroborates_reconstruction');
          }

          candidates.push({
            key,
            userId: invoice.userId,
            emailConnectionId: invoice.emailConnectionId,
            senderDomain: normalizeDomain(invoice.senderDomain),
            merchant: invoice.merchant,
            merchantLegalName: invoice.merchantLegalName ?? shipment.merchantLegalName,
            orderNumber: invoice.orderNumber,
            expectedCarrier: shipment.carrier,
            orderedAt: new Date(Math.min(...timestamps)).toISOString(),
            confidence: auxiliaryRows.some((row) => row.eventType === 'delivery') ? 0.9 : 0.88,
            trackingNumber: normalizeIdentifier(shipment.trackingNumber),
            sourceLinks,
            carrierProofSourceEmailIds: carrierProofRows.map((row) => row.sourceEmailId),
            reasons,
          });
          continue;
        }
      }
    }

    const untrackedMerchantShipments = merchantRows.filter((row) =>
      isTrusted(row) &&
      row.eventType === 'shipment' &&
      row.confidence >= MIN_SHIPMENT_CONFIDENCE &&
      normalizeIdentifier(row.trackingNumber).length < MIN_TRACKING_LENGTH &&
      withinDays(row.receivedAt, invoice.receivedAt, MAX_MERCHANT_CHAIN_DAYS),
    ).sort((a, b) => b.confidence - a.confidence);

    let fallback: { shipment: HistoricalReconstructionEvidence; cluster: CarrierCluster } | null = null;
    let ambiguous = false;
    for (const merchantShipment of untrackedMerchantShipments) {
      const clusters = carrierClustersForMerchantShipment(evidenceRows, invoice, merchantShipment);
      if (clusters.length > 1) {
        ambiguous = true;
        break;
      }
      if (clusters.length === 1) {
        if (fallback) {
          ambiguous = true;
          break;
        }
        fallback = { shipment: merchantShipment, cluster: clusters[0]! };
      }
    }
    if (ambiguous || !fallback) continue;

    candidates.push({
      key,
      userId: invoice.userId,
      emailConnectionId: invoice.emailConnectionId,
      senderDomain: normalizeDomain(invoice.senderDomain),
      merchant: invoice.merchant,
      merchantLegalName: invoice.merchantLegalName ?? fallback.shipment.merchantLegalName,
      orderNumber: invoice.orderNumber,
      expectedCarrier: fallback.cluster.carrier,
      orderedAt: null,
      confidence: 0.9,
      trackingNumber: fallback.cluster.trackingNumber,
      sourceLinks: uniqueLinks([
        {
          sourceEmailId: invoice.sourceEmailId,
          relationType: 'invoice_or_receipt',
          confidence: invoice.confidence,
        },
        {
          sourceEmailId: fallback.shipment.sourceEmailId,
          relationType: 'shipment',
          confidence: fallback.shipment.confidence,
        },
      ]),
      carrierProofSourceEmailIds: fallback.cluster.rows.map((row) => row.sourceEmailId),
      reasons: [
        'ninety_day_exact_order_search_completed_without_purchase',
        'validated_invoice_matches_merchant_order_identity',
        'merchant_shipment_matches_same_order_identity',
        'merchant_shipment_missing_tracking_replaced_by_unique_carrier_cluster',
        'carrier_cluster_has_multiple_trusted_events',
        'carrier_cluster_has_physical_progress',
        'carrier_parcel_sender_matches_merchant_identity',
        'carrier_cluster_has_consistent_explicit_cod',
        'no_order_created_source_exists',
      ],
    });
  }

  return candidates.sort((a, b) => a.key.localeCompare(b.key));
}
