import assert from 'node:assert/strict';
import test from 'node:test';
import { PurchaseIdentityGraph } from './graph.js';
import { evaluatePromotionReadiness } from './promotion-readiness.js';
import type {
  CanonicalEvent,
  CanonicalEventType,
  CorrelationDecision,
  EvidenceProvenance,
  PurchaseIdentitySnapshot,
  SourceRole,
} from './types.js';

const USER_ID = 'lifecycle-chain-gate-user';
const TS = '2026-08-29T10:00:00.000Z';

const PROVENANCE: EvidenceProvenance[] = [{
  field: 'synthetic_gate',
  source: 'body',
  parserVersion: 'lifecycle-chain-gate-v1',
  extractorId: 'frozen-chain-fixture',
  extractorVersion: '1',
  confidence: 1,
  qualifiers: ['synthetic', 'holdout', 'not-training-data'],
}];

type Alias = string;
type PromotionAction = 'CREATE_PURCHASE' | 'LINK_EVENT' | null;

interface StepExpectation {
  decision: CorrelationDecision['kind'] | Array<CorrelationDecision['kind']>;
  action: PromotionAction;
  createAlias?: Alias;
  linkAlias?: Alias;
  commit?: boolean;
  assertIdempotent?: boolean;
}

interface ChainStep {
  name: string;
  event: CanonicalEvent;
  expect: StepExpectation;
}

interface ChainScenario {
  id: string;
  steps: ChainStep[];
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function canonicalEvent(input: {
  id: string;
  type: CanonicalEventType;
  sourceRole: SourceRole;
  merchantId?: string | null;
  merchantNamespace?: string | null;
  purchaseCreationAuthority?: 'authorized' | 'review' | 'none';
  orderId?: string | null;
  trackingId?: string | null;
  carrierId?: string | null;
  paymentReference?: string | null;
  paymentProviderId?: string | null;
  invoiceId?: string | null;
  invoiceIssuerId?: string | null;
  amount?: number | null;
  currency?: string | null;
  platformMerchantId?: string | null;
  sellerMerchantId?: string | null;
  orderRelation?: CanonicalEvent['orderRelation'];
  conflicts?: CanonicalEvent['conflicts'];
}): CanonicalEvent {
  return {
    eventId: `chain-gate:${input.id}`,
    userId: USER_ID,
    eventType: input.type,
    sourceProvider: 'synthetic-chain-gate',
    sourceMessageId: `msg:${input.id}`,
    senderDomain: input.merchantNamespace ?? null,
    receivedAt: TS,
    occurredAt: null,
    merchantRaw: input.merchantId,
    merchantId: input.merchantId ?? null,
    merchantNamespace: input.merchantNamespace ?? null,
    purchaseCreationAuthority: input.purchaseCreationAuthority ?? 'none',
    purchaseCreationReasons: input.purchaseCreationAuthority === 'authorized' ? ['synthetic-authorized-order-root'] : [],
    orderRelation: input.orderRelation ?? null,
    orderIdRaw: input.orderId ?? null,
    orderIdNormalized: input.orderId ?? null,
    trackingIdRaw: input.trackingId ?? null,
    trackingIdNormalized: input.trackingId ?? null,
    invoiceIdRaw: input.invoiceId ?? null,
    invoiceIdNormalized: input.invoiceId ?? null,
    paymentReference: input.paymentReference ?? null,
    amount: input.amount ?? null,
    currency: input.currency ?? null,
    orderUrl: null,
    trackingUrl: null,
    productFingerprints: [],
    provenance: PROVENANCE,
    sourceRole: input.sourceRole,
    carrierId: input.carrierId ?? null,
    paymentProviderId: input.paymentProviderId ?? null,
    invoiceIssuerId: input.invoiceIssuerId ?? null,
    platformMerchantId: input.platformMerchantId ?? null,
    sellerMerchantId: input.sellerMerchantId ?? null,
    conflicts: input.conflicts ?? [],
  };
}

function merchant(id: string) {
  return {
    merchantId: `merchant:${id}`,
    merchantNamespace: `${id}.chain-gate.example`,
  };
}

function orderRoot(chain: string, merchantKey: string, orderId: string): ChainStep {
  return {
    name: 'order-root',
    event: canonicalEvent({
      id: `${chain}:order-root`,
      type: 'order_created',
      sourceRole: 'merchant',
      ...merchant(merchantKey),
      purchaseCreationAuthority: 'authorized',
      orderId,
      amount: 49.9,
      currency: 'EUR',
    }),
    expect: { decision: 'NEW_PURCHASE', action: 'CREATE_PURCHASE', createAlias: 'root', commit: true },
  };
}

function merchantUpdate(chain: string, merchantKey: string, orderId: string, suffix: string): ChainStep {
  return {
    name: suffix,
    event: canonicalEvent({
      id: `${chain}:${suffix}`,
      type: 'order_updated',
      sourceRole: 'merchant',
      ...merchant(merchantKey),
      orderId,
    }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: 'root', commit: true },
  };
}

function merchantShipment(
  chain: string,
  merchantKey: string,
  orderId: string,
  trackingId: string,
  carrierId = 'dpd',
  alias = 'root',
): ChainStep {
  return {
    name: `merchant-shipment-${trackingId}`,
    event: canonicalEvent({
      id: `${chain}:merchant-shipment:${trackingId}`,
      type: 'shipment_created',
      sourceRole: 'merchant',
      ...merchant(merchantKey),
      orderId,
      trackingId,
      carrierId,
    }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function carrierStep(
  chain: string,
  type: 'shipment_created' | 'out_for_delivery' | 'delivered',
  trackingId: string,
  carrierId = 'dpd',
  alias = 'root',
  suffix = type,
): ChainStep {
  return {
    name: `${carrierId}-${suffix}`,
    event: canonicalEvent({
      id: `${chain}:${carrierId}:${suffix}:${trackingId}`,
      type,
      sourceRole: 'carrier',
      trackingId,
      carrierId,
    }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function merchantPayment(
  chain: string,
  merchantKey: string,
  orderId: string,
  reference: string,
  provider = 'barion',
  alias = 'root',
): ChainStep {
  return {
    name: `merchant-payment-${reference}`,
    event: canonicalEvent({
      id: `${chain}:merchant-payment:${reference}`,
      type: 'payment_completed',
      sourceRole: 'merchant',
      ...merchant(merchantKey),
      orderId,
      paymentReference: reference,
      paymentProviderId: provider,
      amount: 49.9,
      currency: 'EUR',
    }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function paymentProviderStep(
  chain: string,
  reference: string,
  provider = 'barion',
  alias = 'root',
): ChainStep {
  return {
    name: `payment-provider-${reference}`,
    event: canonicalEvent({
      id: `${chain}:payment-provider:${reference}`,
      type: 'payment_completed',
      sourceRole: 'payment_provider',
      paymentReference: reference,
      paymentProviderId: provider,
      amount: 49.9,
      currency: 'EUR',
    }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function invoiceIssuerStep(
  chain: string,
  merchantKey: string,
  orderId: string,
  invoiceId: string,
  issuer = 'billingo',
  alias = 'root',
): ChainStep {
  return {
    name: `invoice-${invoiceId}`,
    event: canonicalEvent({
      id: `${chain}:invoice:${invoiceId}`,
      type: 'invoice_created',
      sourceRole: 'invoice_issuer',
      ...merchant(merchantKey),
      orderId,
      invoiceId,
      invoiceIssuerId: issuer,
      amount: 49.9,
      currency: 'EUR',
    }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function blockedStep(
  name: string,
  event: CanonicalEvent,
  decision: StepExpectation['decision'] = ['REVIEW', 'PENDING', 'UNLINKED'],
): ChainStep {
  return { name, event, expect: { decision, action: null, commit: false } };
}

function happyChain(index: number): ChainScenario {
  const chain = `happy-${String(index).padStart(2, '0')}`;
  const merchantKey = `happy-shop-${index}`;
  const orderId = `HAPPY-${1000 + index}`;
  const tracking = `DPD-HAPPY-${100000 + index}`;
  const payment = `PAY-HAPPY-${200000 + index}`;
  const invoice = `INV-HAPPY-${300000 + index}`;

  const steps: ChainStep[] = [
    orderRoot(chain, merchantKey, orderId),
    merchantUpdate(chain, merchantKey, orderId, 'processing'),
    merchantUpdate(chain, merchantKey, orderId, 'packing'),
  ];

  if (index % 2 === 0) steps.push(merchantPayment(chain, merchantKey, orderId, payment));
  if (index % 3 === 0) steps.push(paymentProviderStep(chain, payment));
  steps.push(invoiceIssuerStep(chain, merchantKey, orderId, invoice));
  steps.push(merchantShipment(chain, merchantKey, orderId, tracking));
  steps.push(carrierStep(chain, 'shipment_created', tracking));
  steps.push(carrierStep(chain, 'out_for_delivery', tracking));
  steps.push(carrierStep(chain, 'delivered', tracking));

  // Exact replay must remain on the same identity and must not create a second
  // Purchase/Shipment identity.
  const replay = carrierStep(chain, 'delivered', tracking, 'dpd', 'root', 'delivered-replay');
  replay.expect.assertIdempotent = true;
  steps.push(replay);
  return { id: chain, steps };
}

function adversarialScenarios(): ChainScenario[] {
  const out: ChainScenario[] = [];

  // 11. Shipment before root: no Purchase creation. After the root exists, the
  // same merchant-scoped event may link safely and the carrier can finish it.
  {
    const c = 'late-order-anchor'; const m = 'late-shop'; const o = 'LATE-1101'; const t = 'DPD-LATE-1101';
    out.push({ id: c, steps: [
      blockedStep('shipment-before-root', canonicalEvent({ id: `${c}:pre`, type: 'shipment_created', sourceRole: 'merchant', ...merchant(m), orderId: o, trackingId: t, carrierId: 'dpd' }), 'UNLINKED'),
      orderRoot(c, m, o),
      merchantShipment(c, m, o, t),
      carrierStep(c, 'delivered', t),
    ] });
  }

  // 12. Invoice before root is safe-miss; replay after root links by scoped
  // invoice/order evidence.
  {
    const c = 'invoice-before-order'; const m = 'invoice-shop'; const o = 'INVORD-1201'; const inv = 'INV-1201';
    out.push({ id: c, steps: [
      blockedStep('invoice-before-root', canonicalEvent({ id: `${c}:pre`, type: 'invoice_created', sourceRole: 'invoice_issuer', ...merchant(m), orderId: o, invoiceId: inv, invoiceIssuerId: 'billingo' }), 'UNLINKED'),
      orderRoot(c, m, o),
      invoiceIssuerStep(c, m, o, inv),
    ] });
  }

  // 13. Payment-provider-only reference cannot invent a Purchase. The merchant
  // later scopes the reference to an existing order, after which provider replay
  // may hard-link on provider+reference.
  {
    const c = 'payment-before-order'; const m = 'payment-shop'; const o = 'PAYORD-1301'; const p = 'PAY-1301';
    out.push({ id: c, steps: [
      blockedStep('payment-before-root', canonicalEvent({ id: `${c}:pre`, type: 'payment_completed', sourceRole: 'payment_provider', paymentReference: p, paymentProviderId: 'barion' }), 'UNLINKED'),
      orderRoot(c, m, o),
      merchantPayment(c, m, o, p),
      paymentProviderStep(c, p),
    ] });
  }

  // 14. Two simultaneous same-merchant orders with identical amount/currency
  // remain distinct because soft amount evidence has no merge authority.
  {
    const c = 'same-merchant-concurrent'; const m = 'parallel-shop';
    const a = orderRoot(c, m, 'PAR-1401'); a.expect.createAlias = 'a';
    const b = orderRoot(`${c}-b`, m, 'PAR-1402'); b.expect.createAlias = 'b';
    const sa = merchantShipment(c, m, 'PAR-1401', 'DPD-PAR-1401', 'dpd', 'a');
    const sb = merchantShipment(c, m, 'PAR-1402', 'DPD-PAR-1402', 'dpd', 'b');
    out.push({ id: c, steps: [a, b, sa, sb, carrierStep(c, 'delivered', 'DPD-PAR-1401', 'dpd', 'a', 'a-delivered'), carrierStep(c, 'delivered', 'DPD-PAR-1402', 'dpd', 'b', 'b-delivered')] });
  }

  // 15. Near-identical order ids must remain distinct.
  {
    const c = 'near-order-ids'; const m = 'near-shop';
    const a = orderRoot(c, m, 'NEAR-15001'); a.expect.createAlias = 'a';
    const b = orderRoot(`${c}-b`, m, 'NEAR-15002'); b.expect.createAlias = 'b';
    out.push({ id: c, steps: [a, b, merchantShipment(c, m, 'NEAR-15001', 'GLS-15001', 'gls', 'a'), merchantShipment(c, m, 'NEAR-15002', 'GLS-15002', 'gls', 'b')] });
  }

  // 16. Same order id across incompatible merchants can create two distinct
  // purchases; unscoped discovery of the same number is review-only/soft.
  {
    const c = 'cross-merchant-same-order'; const o = 'SAME-1601';
    const a = orderRoot(c, 'merchant-a', o); a.expect.createAlias = 'a';
    const b = orderRoot(`${c}-b`, 'merchant-b', o); b.expect.createAlias = 'b';
    out.push({ id: c, steps: [a, b, merchantShipment(c, 'merchant-a', o, 'DPD-A-1601', 'dpd', 'a'), merchantShipment(c, 'merchant-b', o, 'DHL-B-1601', 'dhl', 'b')] });
  }

  // 17. Same carrier+tracking cannot be attached to B when exact order evidence
  // points to B but exact tracking evidence already points to A.
  {
    const c = 'tracking-hard-conflict'; const m = 'tracking-shop';
    const a = orderRoot(c, m, 'TRK-1701'); a.expect.createAlias = 'a';
    const b = orderRoot(`${c}-b`, m, 'TRK-1702'); b.expect.createAlias = 'b';
    const seed = merchantShipment(c, m, 'TRK-1701', 'DPD-COLLISION-17', 'dpd', 'a');
    const conflict = blockedStep('tracking-collision', canonicalEvent({ id: `${c}:collision`, type: 'shipment_created', sourceRole: 'merchant', ...merchant(m), orderId: 'TRK-1702', trackingId: 'DPD-COLLISION-17', carrierId: 'dpd' }), 'REVIEW');
    out.push({ id: c, steps: [a, b, seed, conflict, merchantShipment(c, m, 'TRK-1702', 'DPD-OK-1702', 'dpd', 'b')] });
  }

  // 18. Same tracking text at different carriers is namespaced. Discovery can
  // see both, but only the matching carrier supplies hard tracking evidence.
  {
    const c = 'tracking-carrier-namespace'; const m = 'carrier-namespace-shop';
    const a = orderRoot(c, m, 'CAR-1801'); a.expect.createAlias = 'a';
    const b = orderRoot(`${c}-b`, m, 'CAR-1802'); b.expect.createAlias = 'b';
    out.push({ id: c, steps: [
      a, b,
      merchantShipment(c, m, 'CAR-1801', 'SAME-TRACK-18', 'dpd', 'a'),
      merchantShipment(c, m, 'CAR-1802', 'SAME-TRACK-18', 'dhl', 'b'),
      carrierStep(c, 'delivered', 'SAME-TRACK-18', 'dpd', 'a', 'dpd-delivered'),
      carrierStep(c, 'delivered', 'SAME-TRACK-18', 'dhl', 'b', 'dhl-delivered'),
    ] });
  }

  // 19. Tracking without carrier namespace is only soft evidence and must not
  // become an eligible automatic link.
  {
    const c = 'tracking-without-carrier'; const m = 'scope-shop'; const o = 'SCOPE-1901'; const t = 'SCOPE-TRACK-1901';
    out.push({ id: c, steps: [
      orderRoot(c, m, o),
      merchantShipment(c, m, o, t),
      blockedStep('providerless-tracking', canonicalEvent({ id: `${c}:providerless`, type: 'delivered', sourceRole: 'carrier', trackingId: t }), 'REVIEW'),
      carrierStep(c, 'delivered', t),
    ] });
  }

  // 20. Payment reference collision: exact order and exact provider reference
  // point at different Purchases => REVIEW, never first-match-wins.
  {
    const c = 'payment-reference-conflict'; const m = 'pay-conflict-shop';
    const a = orderRoot(c, m, 'PAYC-2001'); a.expect.createAlias = 'a';
    const b = orderRoot(`${c}-b`, m, 'PAYC-2002'); b.expect.createAlias = 'b';
    const pa = merchantPayment(c, m, 'PAYC-2001', 'BARION-COLLIDE-20', 'barion', 'a');
    const conflict = blockedStep('payment-collision', canonicalEvent({ id: `${c}:collision`, type: 'payment_completed', sourceRole: 'merchant', ...merchant(m), orderId: 'PAYC-2002', paymentReference: 'BARION-COLLIDE-20', paymentProviderId: 'barion' }), 'REVIEW');
    out.push({ id: c, steps: [a, b, pa, conflict, merchantPayment(c, m, 'PAYC-2002', 'BARION-OK-2002', 'barion', 'b')] });
  }

  // 21. Invoice id collision behaves the same way.
  {
    const c = 'invoice-reference-conflict'; const m = 'invoice-conflict-shop';
    const a = orderRoot(c, m, 'INVC-2101'); a.expect.createAlias = 'a';
    const b = orderRoot(`${c}-b`, m, 'INVC-2102'); b.expect.createAlias = 'b';
    const ia = invoiceIssuerStep(c, m, 'INVC-2101', 'BILL-COLLIDE-21', 'billingo', 'a');
    const conflict = blockedStep('invoice-collision', canonicalEvent({ id: `${c}:collision`, type: 'invoice_created', sourceRole: 'invoice_issuer', ...merchant(m), orderId: 'INVC-2102', invoiceId: 'BILL-COLLIDE-21', invoiceIssuerId: 'billingo' }), 'REVIEW');
    out.push({ id: c, steps: [a, b, ia, conflict, invoiceIssuerStep(c, m, 'INVC-2102', 'BILL-OK-2102', 'billingo', 'b')] });
  }

  // 22. Decorated ids are discovery aliases only. Exact merchant namespace is
  // still insufficient to turn KB916... ~ 916... into a hard merge.
  {
    const c = 'decorated-order-review'; const m = 'decorated-shop'; const o = '9160675123';
    out.push({ id: c, steps: [
      orderRoot(c, m, o),
      blockedStep('decorated-alias', canonicalEvent({ id: `${c}:alias`, type: 'order_updated', sourceRole: 'merchant', ...merchant(m), orderId: `KB${o}` }), 'REVIEW'),
      merchantUpdate(c, m, o, 'exact-retry'),
    ] });
  }

  // 23. Explicit split-child relation with provenance links to the parent and
  // persists the child identity. Subsequent child-order lifecycle can hard-link.
  {
    const c = 'explicit-split-child'; const m = 'split-shop'; const parent = 'SPLIT-2301'; const child = 'SPLIT-2301-B';
    const relation = {
      relation: 'split_child' as const,
      parentOrderIdRaw: parent,
      parentOrderIdNormalized: parent,
      childOrderIdRaw: child,
      childOrderIdNormalized: child,
      provenance: PROVENANCE,
    };
    out.push({ id: c, steps: [
      orderRoot(c, m, parent),
      {
        name: 'explicit-child',
        event: canonicalEvent({ id: `${c}:child`, type: 'order_updated', sourceRole: 'merchant', ...merchant(m), orderId: child, orderRelation: relation }),
        expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: 'root', commit: true },
      },
      merchantShipment(c, m, child, 'DPD-SPLIT-2301-B'),
      carrierStep(c, 'delivered', 'DPD-SPLIT-2301-B'),
    ] });
  }

  // 24. Relation without provenance is soft only and cannot mutate the graph.
  {
    const c = 'unproven-child-relation'; const m = 'unproven-split-shop'; const parent = 'SPLIT-2401'; const child = 'SPLIT-2401-X';
    out.push({ id: c, steps: [
      orderRoot(c, m, parent),
      blockedStep('unproven-child', canonicalEvent({
        id: `${c}:child`, type: 'order_updated', sourceRole: 'merchant', ...merchant(m), orderId: child,
        orderRelation: {
          relation: 'child',
          parentOrderIdRaw: parent,
          parentOrderIdNormalized: parent,
          childOrderIdRaw: child,
          childOrderIdNormalized: child,
          provenance: [],
        },
      }), 'REVIEW'),
      merchantUpdate(c, m, parent, 'parent-still-exact'),
    ] });
  }

  // 25. Marketplace/platform sender never gets production eligibility to create
  // a Purchase merely because a seller id/order id is present. A later direct,
  // authorized merchant root may create it. Platform lifecycle remains blocked
  // until the evidence is merchant/carrier/provider scoped.
  {
    const c = 'marketplace-seller-boundary'; const m = 'marketplace-seller'; const o = 'MKT-2501';
    const marketplaceRoot = canonicalEvent({
      id: `${c}:platform-root`,
      type: 'order_created',
      sourceRole: 'marketplace',
      ...merchant(m),
      purchaseCreationAuthority: 'review',
      orderId: o,
      platformMerchantId: 'platform:marketplace',
      sellerMerchantId: `merchant:${m}`,
    });
    out.push({ id: c, steps: [
      blockedStep('platform-root-not-authorized', marketplaceRoot, ['NEW_PURCHASE', 'REVIEW']),
      orderRoot(c, m, o),
      blockedStep('platform-lifecycle-not-merchant-scoped', canonicalEvent({
        id: `${c}:platform-update`, type: 'order_updated', sourceRole: 'marketplace', ...merchant(m), orderId: o,
        platformMerchantId: 'platform:marketplace', sellerMerchantId: `merchant:${m}`,
      }), 'LINKED'),
      merchantUpdate(c, m, o, 'seller-direct-update'),
    ] });
  }

  return out;
}

const SCENARIOS: ChainScenario[] = [
  ...Array.from({ length: 10 }, (_, index) => happyChain(index + 1)),
  ...adversarialScenarios(),
];

function expectedDecisionMatches(actual: CorrelationDecision['kind'], expected: StepExpectation['decision']) {
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}

function countEntities(snapshot: PurchaseIdentitySnapshot) {
  return {
    purchases: snapshot.purchases.length,
    orders: snapshot.orders.length,
    shipments: snapshot.shipments.length,
    payments: snapshot.payments.length,
    invoices: snapshot.invoices.length,
  };
}

test('Lifecycle Chain Gate: 25 independent multi-email lifecycles preserve zero-trust identity safety', () => {
  assert.equal(SCENARIOS.length, 25, 'gate must contain exactly 25 frozen scenarios');

  const unsafe: string[] = [];
  const observations: Array<Record<string, unknown>> = [];
  let totalSteps = 0;
  let eligibleCreates = 0;
  let eligibleLinks = 0;
  let blockedSteps = 0;
  let falsePurchaseMerges = 0;
  let falseShipmentMerges = 0;
  let lifecycleOnlyCreates = 0;
  let linksWithoutHardEvidence = 0;
  let idempotentReplays = 0;

  for (const scenario of SCENARIOS) {
    let committed = emptySnapshot();
    const aliases = new Map<Alias, string>();

    for (const step of scenario.steps) {
      totalSteps += 1;
      const before = countEntities(committed);
      const graph = new PurchaseIdentityGraph(committed);
      const applied = graph.applyEvent(step.event);
      const readiness = evaluatePromotionReadiness({ event: step.event, decision: applied.decision });

      assert.equal(applied.productionWrites, 0, `${scenario.id}/${step.name}: graph write invariant`);
      assert.equal(applied.aiCalls, 0, `${scenario.id}/${step.name}: graph AI invariant`);
      assert.equal(readiness.productionWrites, 0, `${scenario.id}/${step.name}: promotion write invariant`);

      if (!expectedDecisionMatches(applied.decision.kind, step.expect.decision)) {
        unsafe.push(`${scenario.id}/${step.name}: decision ${applied.decision.kind}, expected ${JSON.stringify(step.expect.decision)}`);
      }
      if (readiness.action !== step.expect.action) {
        unsafe.push(`${scenario.id}/${step.name}: promotion action ${readiness.action}, expected ${step.expect.action}`);
      }

      if (step.event.eventType !== 'order_created' && applied.decision.kind === 'NEW_PURCHASE') {
        lifecycleOnlyCreates += 1;
        unsafe.push(`${scenario.id}/${step.name}: lifecycle-only event produced NEW_PURCHASE`);
      }

      if (readiness.action === 'CREATE_PURCHASE') {
        eligibleCreates += 1;
        const priorIds = new Set(committed.purchases.map((item) => item.purchaseId));
        const created = applied.snapshot.purchases.filter((item) => !priorIds.has(item.purchaseId));
        if (created.length !== 1) {
          unsafe.push(`${scenario.id}/${step.name}: eligible create produced ${created.length} new Purchases`);
        } else if (step.expect.createAlias) {
          aliases.set(step.expect.createAlias, created[0]!.purchaseId);
        }
      }

      if (readiness.action === 'LINK_EVENT') {
        eligibleLinks += 1;
        if (applied.decision.kind !== 'LINKED') {
          unsafe.push(`${scenario.id}/${step.name}: LINK_EVENT readiness without LINKED decision`);
        } else {
          const hard = applied.decision.reasons.filter((edge) => edge.strength === 'hard');
          if (hard.length === 0) {
            linksWithoutHardEvidence += 1;
            unsafe.push(`${scenario.id}/${step.name}: eligible link has no hard evidence`);
          }
          if (hard.some((edge) => edge.candidatePurchaseId !== applied.decision.purchaseId)) {
            unsafe.push(`${scenario.id}/${step.name}: hard evidence target mismatch`);
          }
          if (step.expect.linkAlias) {
            const expectedPurchaseId = aliases.get(step.expect.linkAlias);
            if (!expectedPurchaseId || expectedPurchaseId !== applied.decision.purchaseId) {
              falsePurchaseMerges += 1;
              unsafe.push(`${scenario.id}/${step.name}: linked ${applied.decision.purchaseId}, expected alias ${step.expect.linkAlias}=${expectedPurchaseId ?? 'missing'}`);
            }
          }
        }
      } else if (step.expect.action === null) {
        blockedSteps += 1;
      }

      const shouldCommit = step.expect.commit ?? readiness.eligible;
      if (shouldCommit && readiness.eligible) {
        const tracking = step.event.trackingIdNormalized ?? step.event.trackingIdRaw;
        if (tracking && applied.decision.kind === 'LINKED' && step.expect.linkAlias) {
          const expectedPurchaseId = aliases.get(step.expect.linkAlias);
          const matching = applied.snapshot.shipments.filter((shipment) =>
            shipment.trackingId === tracking && shipment.carrierId === (step.event.carrierId ?? null)
          );
          if (matching.some((shipment) => shipment.purchaseId !== expectedPurchaseId)) {
            falseShipmentMerges += 1;
            unsafe.push(`${scenario.id}/${step.name}: tracking/carrier identity attached to wrong Purchase`);
          }
        }

        committed = applied.snapshot;

        if (step.expect.assertIdempotent) {
          const after = countEntities(committed);
          if (after.purchases !== before.purchases || after.orders !== before.orders || after.shipments !== before.shipments || after.payments !== before.payments || after.invoices !== before.invoices) {
            unsafe.push(`${scenario.id}/${step.name}: replay changed identity cardinality ${JSON.stringify({ before, after })}`);
          } else {
            idempotentReplays += 1;
          }
        }
      }

      observations.push({
        scenario: scenario.id,
        step: step.name,
        eventType: step.event.eventType,
        decision: applied.decision.kind,
        promotionEligible: readiness.eligible,
        promotionAction: readiness.action,
        reasons: readiness.reasons,
      });
    }
  }

  const score = {
    scenarios: SCENARIOS.length,
    totalSteps,
    eligibleCreates,
    eligibleLinks,
    blockedSteps,
    falsePurchaseMerges,
    falseShipmentMerges,
    lifecycleOnlyCreates,
    linksWithoutHardEvidence,
    idempotentReplays,
    automaticLinkPrecisionPct: eligibleLinks > 0 && falsePurchaseMerges === 0 ? 100 : null,
    productionWrites: 0,
    aiCalls: 0,
    unsafe,
  };

  console.log('LIFECYCLE_CHAIN_GATE_SCORE', JSON.stringify(score));
  console.log('LIFECYCLE_CHAIN_GATE_OBSERVATIONS', JSON.stringify(observations));

  assert.equal(falsePurchaseMerges, 0);
  assert.equal(falseShipmentMerges, 0);
  assert.equal(lifecycleOnlyCreates, 0);
  assert.equal(linksWithoutHardEvidence, 0);
  assert.equal(score.automaticLinkPrecisionPct, 100);
  assert.equal(idempotentReplays, 10);
  assert.deepEqual(unsafe, []);
});
