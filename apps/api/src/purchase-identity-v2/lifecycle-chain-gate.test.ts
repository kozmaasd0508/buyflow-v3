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
}, {
  field: 'sender_authority',
  source: 'provider_adapter',
  parserVersion: 'lifecycle-chain-gate-v1',
  extractorId: 'frozen-chain-fixture',
  extractorVersion: '1',
  confidence: 1,
  qualifiers: ['trusted_sender_authority', 'synthetic', 'holdout', 'not-training-data'],
}];

type Alias = string;
type Action = 'CREATE_PURCHASE' | 'LINK_EVENT' | null;
type DecisionKind = CorrelationDecision['kind'];

interface Expectation {
  decision: DecisionKind | DecisionKind[];
  action: Action;
  createAlias?: Alias;
  linkAlias?: Alias;
  commit?: boolean;
  idempotent?: boolean;
}
interface Step { name: string; event: CanonicalEvent; expect: Expectation }
interface Scenario { id: string; steps: Step[] }

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function ev(input: {
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
    merchantRaw: input.merchantId ?? null,
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

function merchant(key: string) {
  return { merchantId: `merchant:${key}`, merchantNamespace: `${key}.chain-gate.example` };
}

function root(chain: string, merchantKey: string, orderId: string, alias = 'root'): Step {
  return {
    name: `order-root-${alias}`,
    event: ev({ id: `${chain}:root:${alias}`, type: 'order_created', sourceRole: 'merchant', ...merchant(merchantKey), purchaseCreationAuthority: 'authorized', orderId, amount: 49.9, currency: 'EUR' }),
    expect: { decision: 'NEW_PURCHASE', action: 'CREATE_PURCHASE', createAlias: alias, commit: true },
  };
}

function rootReplay(chain: string, merchantKey: string, orderId: string, alias = 'root'): Step {
  return {
    name: `order-root-replay-${alias}`,
    event: ev({ id: `${chain}:root-replay:${alias}`, type: 'order_created', sourceRole: 'merchant', ...merchant(merchantKey), purchaseCreationAuthority: 'authorized', orderId, amount: 49.9, currency: 'EUR' }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true, idempotent: true },
  };
}

function update(chain: string, merchantKey: string, orderId: string, suffix: string, alias = 'root'): Step {
  return {
    name: suffix,
    event: ev({ id: `${chain}:${suffix}:${alias}`, type: 'order_updated', sourceRole: 'merchant', ...merchant(merchantKey), orderId }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function shipment(chain: string, merchantKey: string, orderId: string, trackingId: string, carrierId = 'dpd', alias = 'root'): Step {
  return {
    name: `shipment-${alias}-${trackingId}`,
    event: ev({ id: `${chain}:shipment:${alias}:${trackingId}`, type: 'shipment_created', sourceRole: 'merchant', ...merchant(merchantKey), orderId, trackingId, carrierId }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function carrier(chain: string, type: 'shipment_created' | 'out_for_delivery' | 'delivered', trackingId: string, carrierId = 'dpd', alias = 'root', suffix: string = type): Step {
  return {
    name: `${carrierId}-${suffix}-${alias}`,
    event: ev({ id: `${chain}:carrier:${suffix}:${alias}:${trackingId}`, type, sourceRole: 'carrier', trackingId, carrierId }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function payment(chain: string, merchantKey: string, orderId: string, reference: string, provider = 'barion', alias = 'root'): Step {
  return {
    name: `payment-${alias}-${reference}`,
    event: ev({ id: `${chain}:payment:${alias}:${reference}`, type: 'payment_completed', sourceRole: 'merchant', ...merchant(merchantKey), orderId, paymentReference: reference, paymentProviderId: provider, amount: 49.9, currency: 'EUR' }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function paymentProvider(chain: string, reference: string, provider = 'barion', alias = 'root'): Step {
  return {
    name: `payment-provider-${alias}-${reference}`,
    event: ev({ id: `${chain}:payment-provider:${alias}:${reference}`, type: 'payment_completed', sourceRole: 'payment_provider', paymentReference: reference, paymentProviderId: provider, amount: 49.9, currency: 'EUR' }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function invoice(chain: string, merchantKey: string, orderId: string, invoiceId: string, issuer = 'billingo', alias = 'root'): Step {
  return {
    name: `invoice-${alias}-${invoiceId}`,
    event: ev({ id: `${chain}:invoice:${alias}:${invoiceId}`, type: 'invoice_created', sourceRole: 'invoice_issuer', ...merchant(merchantKey), orderId, invoiceId, invoiceIssuerId: issuer, amount: 49.9, currency: 'EUR' }),
    expect: { decision: 'LINKED', action: 'LINK_EVENT', linkAlias: alias, commit: true },
  };
}

function blocked(name: string, event: CanonicalEvent, decision: Expectation['decision'] = ['REVIEW', 'PENDING', 'UNLINKED']): Step {
  return { name, event, expect: { decision, action: null, commit: false } };
}

function happy(index: number): Scenario {
  const c = `happy-${String(index).padStart(2, '0')}`;
  const m = `happy-shop-${index}`;
  const o = `HAPPY-${1000 + index}`;
  const t = `DPD-HAPPY-${100000 + index}`;
  const p = `PAY-HAPPY-${200000 + index}`;
  const i = `INV-HAPPY-${300000 + index}`;
  const steps: Step[] = [root(c, m, o), rootReplay(c, m, o), update(c, m, o, 'processing'), update(c, m, o, 'packing')];
  if (index % 2 === 0 || index % 3 === 0) steps.push(payment(c, m, o, p));
  if (index % 3 === 0) steps.push(paymentProvider(c, p));
  steps.push(invoice(c, m, o, i), shipment(c, m, o, t), carrier(c, 'shipment_created', t), carrier(c, 'out_for_delivery', t), carrier(c, 'delivered', t));
  const replay = carrier(c, 'delivered', t, 'dpd', 'root', 'delivered-replay');
  replay.expect.idempotent = true;
  steps.push(replay);
  return { id: c, steps };
}

function adversarial(): Scenario[] {
  const s: Scenario[] = [];

  { const c='late-order-anchor',m='late-shop',o='LATE-1101',t='DPD-LATE-1101'; s.push({id:c,steps:[
    blocked('shipment-before-root',ev({id:`${c}:pre`,type:'shipment_created',sourceRole:'merchant',...merchant(m),orderId:o,trackingId:t,carrierId:'dpd'}),'UNLINKED'),
    root(c,m,o),shipment(c,m,o,t),carrier(c,'delivered',t),
  ]}); }

  { const c='invoice-before-order',m='invoice-shop',o='INVORD-1201',i='INV-1201'; s.push({id:c,steps:[
    blocked('invoice-before-root',ev({id:`${c}:pre`,type:'invoice_created',sourceRole:'invoice_issuer',...merchant(m),orderId:o,invoiceId:i,invoiceIssuerId:'billingo'}),'UNLINKED'),
    root(c,m,o),invoice(c,m,o,i),
  ]}); }

  { const c='payment-before-order',m='payment-shop',o='PAYORD-1301',p='PAY-1301'; s.push({id:c,steps:[
    blocked('payment-before-root',ev({id:`${c}:pre`,type:'payment_completed',sourceRole:'payment_provider',paymentReference:p,paymentProviderId:'barion'}),'UNLINKED'),
    root(c,m,o),payment(c,m,o,p),paymentProvider(c,p),
  ]}); }

  { const c='same-merchant-concurrent',m='parallel-shop'; s.push({id:c,steps:[
    root(c,m,'PAR-1401','a'),root(`${c}-b`,m,'PAR-1402','b'),
    shipment(c,m,'PAR-1401','DPD-PAR-1401','dpd','a'),shipment(c,m,'PAR-1402','DPD-PAR-1402','dpd','b'),
    carrier(c,'delivered','DPD-PAR-1401','dpd','a','a-delivered'),carrier(c,'delivered','DPD-PAR-1402','dpd','b','b-delivered'),
  ]}); }

  { const c='near-order-ids',m='near-shop'; s.push({id:c,steps:[
    root(c,m,'NEAR-15001','a'),root(`${c}-b`,m,'NEAR-15002','b'),
    shipment(c,m,'NEAR-15001','GLS-15001','gls','a'),shipment(c,m,'NEAR-15002','GLS-15002','gls','b'),
  ]}); }

  { const c='cross-merchant-same-order',o='SAME-1601'; s.push({id:c,steps:[
    root(c,'merchant-a',o,'a'),root(`${c}-b`,'merchant-b',o,'b'),
    shipment(c,'merchant-a',o,'DPD-A-1601','dpd','a'),shipment(c,'merchant-b',o,'DHL-B-1601','dhl','b'),
  ]}); }

  { const c='tracking-hard-conflict',m='tracking-shop'; s.push({id:c,steps:[
    root(c,m,'TRK-1701','a'),root(`${c}-b`,m,'TRK-1702','b'),
    shipment(c,m,'TRK-1701','DPD-COLLISION-17','dpd','a'),
    blocked('tracking-collision',ev({id:`${c}:collision`,type:'shipment_created',sourceRole:'merchant',...merchant(m),orderId:'TRK-1702',trackingId:'DPD-COLLISION-17',carrierId:'dpd'}),'REVIEW'),
    shipment(c,m,'TRK-1702','DPD-OK-1702','dpd','b'),
  ]}); }

  { const c='tracking-carrier-namespace',m='carrier-namespace-shop'; s.push({id:c,steps:[
    root(c,m,'CAR-1801','a'),root(`${c}-b`,m,'CAR-1802','b'),
    shipment(c,m,'CAR-1801','SAME-TRACK-18','dpd','a'),shipment(c,m,'CAR-1802','SAME-TRACK-18','dhl','b'),
    carrier(c,'delivered','SAME-TRACK-18','dpd','a','dpd-delivered'),carrier(c,'delivered','SAME-TRACK-18','dhl','b','dhl-delivered'),
  ]}); }

  { const c='tracking-without-carrier',m='scope-shop',o='SCOPE-1901',t='SCOPE-TRACK-1901'; s.push({id:c,steps:[
    root(c,m,o),shipment(c,m,o,t),
    blocked('providerless-tracking',ev({id:`${c}:providerless`,type:'delivered',sourceRole:'carrier',trackingId:t}),'REVIEW'),
    carrier(c,'delivered',t),
  ]}); }

  { const c='payment-reference-conflict',m='pay-conflict-shop'; s.push({id:c,steps:[
    root(c,m,'PAYC-2001','a'),root(`${c}-b`,m,'PAYC-2002','b'),payment(c,m,'PAYC-2001','BARION-COLLIDE-20','barion','a'),
    blocked('payment-collision',ev({id:`${c}:collision`,type:'payment_completed',sourceRole:'merchant',...merchant(m),orderId:'PAYC-2002',paymentReference:'BARION-COLLIDE-20',paymentProviderId:'barion'}),'REVIEW'),
    payment(c,m,'PAYC-2002','BARION-OK-2002','barion','b'),
  ]}); }

  { const c='invoice-reference-conflict',m='invoice-conflict-shop'; s.push({id:c,steps:[
    root(c,m,'INVC-2101','a'),root(`${c}-b`,m,'INVC-2102','b'),invoice(c,m,'INVC-2101','BILL-COLLIDE-21','billingo','a'),
    blocked('invoice-collision',ev({id:`${c}:collision`,type:'invoice_created',sourceRole:'invoice_issuer',...merchant(m),orderId:'INVC-2102',invoiceId:'BILL-COLLIDE-21',invoiceIssuerId:'billingo'}),'REVIEW'),
    invoice(c,m,'INVC-2102','BILL-OK-2102','billingo','b'),
  ]}); }

  { const c='decorated-order-review',m='decorated-shop',o='9160675123'; s.push({id:c,steps:[
    root(c,m,o),blocked('decorated-alias',ev({id:`${c}:alias`,type:'order_updated',sourceRole:'merchant',...merchant(m),orderId:`KB${o}`}),'REVIEW'),update(c,m,o,'exact-retry'),
  ]}); }

  { const c='explicit-split-child',m='split-shop',parent='SPLIT-2301',child='SPLIT-2301-B'; s.push({id:c,steps:[
    root(c,m,parent),
    {name:'explicit-child',event:ev({id:`${c}:child`,type:'order_updated',sourceRole:'merchant',...merchant(m),orderId:child,orderRelation:{relation:'split_child',parentOrderIdRaw:parent,parentOrderIdNormalized:parent,childOrderIdRaw:child,childOrderIdNormalized:child,provenance:PROVENANCE}}),expect:{decision:'LINKED',action:'LINK_EVENT',linkAlias:'root',commit:true}},
    shipment(c,m,child,'DPD-SPLIT-2301-B'),carrier(c,'delivered','DPD-SPLIT-2301-B'),
  ]}); }

  { const c='unproven-child-relation',m='unproven-split-shop',parent='SPLIT-2401',child='SPLIT-2401-X'; s.push({id:c,steps:[
    root(c,m,parent),
    blocked('unproven-child',ev({id:`${c}:child`,type:'order_updated',sourceRole:'merchant',...merchant(m),orderId:child,orderRelation:{relation:'child',parentOrderIdRaw:parent,parentOrderIdNormalized:parent,childOrderIdRaw:child,childOrderIdNormalized:child,provenance:[]}}),'REVIEW'),
    update(c,m,parent,'parent-still-exact'),
  ]}); }

  { const c='marketplace-seller-boundary',m='marketplace-seller',o='MKT-2501'; s.push({id:c,steps:[
    blocked('platform-root-not-authorized',ev({id:`${c}:platform-root`,type:'order_created',sourceRole:'marketplace',...merchant(m),purchaseCreationAuthority:'review',orderId:o,platformMerchantId:'platform:marketplace',sellerMerchantId:`merchant:${m}`}),['NEW_PURCHASE','REVIEW']),
    root(c,m,o),
    blocked('platform-lifecycle-not-merchant-scoped',ev({id:`${c}:platform-update`,type:'order_updated',sourceRole:'marketplace',...merchant(m),orderId:o,platformMerchantId:'platform:marketplace',sellerMerchantId:`merchant:${m}`}),'LINKED'),
    update(c,m,o,'seller-direct-update'),
  ]}); }

  return s;
}

const SCENARIOS: Scenario[] = [...Array.from({ length: 10 }, (_, i) => happy(i + 1)), ...adversarial()];

function matches(actual: DecisionKind, expected: Expectation['decision']) {
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}
function counts(s: PurchaseIdentitySnapshot) {
  return { purchases:s.purchases.length, orders:s.orders.length, shipments:s.shipments.length, payments:s.payments.length, invoices:s.invoices.length };
}

test('Lifecycle Chain Gate: 25 independent multi-email lifecycles preserve zero-trust identity safety', () => {
  assert.equal(SCENARIOS.length, 25);
  const unsafe: string[] = [];
  const observations: Array<Record<string, unknown>> = [];
  let totalSteps=0, eligibleCreates=0, eligibleLinks=0, blockedSteps=0;
  let falsePurchaseMerges=0, falseShipmentMerges=0, lifecycleOnlyCreates=0, linksWithoutHardEvidence=0, idempotentReplays=0;

  for (const scenario of SCENARIOS) {
    let committed = emptySnapshot();
    const aliases = new Map<Alias,string>();

    for (const step of scenario.steps) {
      totalSteps += 1;
      const before = counts(committed);
      const applied = new PurchaseIdentityGraph(committed).applyEvent(step.event);
      const readiness = evaluatePromotionReadiness({ event: step.event, decision: applied.decision });

      assert.equal(applied.productionWrites,0,`${scenario.id}/${step.name}: graph writes`);
      assert.equal(applied.aiCalls,0,`${scenario.id}/${step.name}: graph AI`);
      assert.equal(readiness.productionWrites,0,`${scenario.id}/${step.name}: promotion writes`);

      if (!matches(applied.decision.kind,step.expect.decision)) unsafe.push(`${scenario.id}/${step.name}: decision=${applied.decision.kind} expected=${JSON.stringify(step.expect.decision)}`);
      if (readiness.action !== step.expect.action) unsafe.push(`${scenario.id}/${step.name}: action=${readiness.action} expected=${step.expect.action}`);
      if (step.event.eventType !== 'order_created' && applied.decision.kind === 'NEW_PURCHASE') {
        lifecycleOnlyCreates += 1; unsafe.push(`${scenario.id}/${step.name}: lifecycle-only NEW_PURCHASE`);
      }

      if (readiness.action === 'CREATE_PURCHASE') {
        eligibleCreates += 1;
        const prior = new Set(committed.purchases.map(x=>x.purchaseId));
        const created = applied.snapshot.purchases.filter(x=>!prior.has(x.purchaseId));
        if (created.length !== 1) unsafe.push(`${scenario.id}/${step.name}: created ${created.length} Purchases`);
        else if (step.expect.createAlias) aliases.set(step.expect.createAlias,created[0]!.purchaseId);
      }

      if (readiness.action === 'LINK_EVENT') {
        eligibleLinks += 1;
        if (applied.decision.kind !== 'LINKED') unsafe.push(`${scenario.id}/${step.name}: LINK_EVENT without LINKED`);
        else {
          const linked = applied.decision;
          const hard = linked.reasons.filter(e=>e.strength==='hard');
          if (!hard.length) { linksWithoutHardEvidence += 1; unsafe.push(`${scenario.id}/${step.name}: no hard evidence`); }
          if (hard.some(e=>e.candidatePurchaseId!==linked.purchaseId)) unsafe.push(`${scenario.id}/${step.name}: hard evidence target mismatch`);
          if (step.expect.linkAlias) {
            const expected = aliases.get(step.expect.linkAlias);
            if (!expected || expected !== linked.purchaseId) { falsePurchaseMerges += 1; unsafe.push(`${scenario.id}/${step.name}: linked=${linked.purchaseId} expected=${expected ?? 'missing'}`); }
          }
        }
      } else if (step.expect.action === null) blockedSteps += 1;

      if ((step.expect.commit ?? readiness.eligible) && readiness.eligible) {
        const tracking = step.event.trackingIdNormalized ?? step.event.trackingIdRaw;
        if (tracking && applied.decision.kind==='LINKED' && step.expect.linkAlias) {
          const expected = aliases.get(step.expect.linkAlias);
          const scoped = applied.snapshot.shipments.filter(x=>x.trackingId===tracking && x.carrierId===(step.event.carrierId ?? null));
          if (scoped.some(x=>x.purchaseId!==expected)) { falseShipmentMerges += 1; unsafe.push(`${scenario.id}/${step.name}: shipment identity on wrong Purchase`); }
        }
        committed = applied.snapshot;
        if (step.expect.idempotent) {
          const after = counts(committed);
          if (JSON.stringify(after)!==JSON.stringify(before)) unsafe.push(`${scenario.id}/${step.name}: replay cardinality changed ${JSON.stringify({before,after})}`);
          else idempotentReplays += 1;
        }
      }

      observations.push({scenario:scenario.id,step:step.name,eventType:step.event.eventType,decision:applied.decision.kind,promotionEligible:readiness.eligible,promotionAction:readiness.action,reasons:readiness.reasons});
    }
  }

  const score = {
    scenarios:SCENARIOS.length,totalSteps,eligibleCreates,eligibleLinks,blockedSteps,
    falsePurchaseMerges,falseShipmentMerges,lifecycleOnlyCreates,linksWithoutHardEvidence,idempotentReplays,
    automaticLinkPrecisionPct:eligibleLinks>0 && falsePurchaseMerges===0 ? 100 : null,
    productionWrites:0,aiCalls:0,unsafe,
  };
  console.log('LIFECYCLE_CHAIN_GATE_SCORE',JSON.stringify(score));
  console.log('LIFECYCLE_CHAIN_GATE_OBSERVATIONS',JSON.stringify(observations));

  assert.equal(falsePurchaseMerges,0);
  assert.equal(falseShipmentMerges,0);
  assert.equal(lifecycleOnlyCreates,0);
  assert.equal(linksWithoutHardEvidence,0);
  assert.equal(score.automaticLinkPrecisionPct,100);
  assert.equal(idempotentReplays,20);
  assert.deepEqual(unsafe,[]);
});
