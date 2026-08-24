# Purchase Identity Graph v2

## Goal
Replace merchant/subject patching with a provider-independent lifecycle correlation architecture. Parsers extract facts; a separate identity-resolution layer decides which purchase, shipment, payment, invoice, refund, or return an event belongs to.

The v1/v1.1 correlation audits remain frozen regression baselines. v2 is built beside them in shadow mode and must not write production data until blind validation passes.

## Design principles

1. **Events are facts, not purchases.** Every recognized commerce message becomes an immutable `CanonicalEvent`.
2. **Identity resolution is separate from parsing.** Parser adapters must not decide which purchase owns an event.
3. **One purchase may contain multiple identities.** Parent orders, child orders, multiple shipments, invoices, payments, refunds, and returns are separate entities linked to one purchase graph.
4. **Hard evidence beats heuristics.** Exact identifiers may auto-link; soft evidence can rank or REVIEW but cannot auto-merge by itself.
5. **Conflicts block linking.** Conflicting exact identifiers must never be resolved by time proximity or subject similarity.
6. **Every automatic link is explainable.** Store machine-readable evidence edges and reasons.
7. **Precision before recall.** REVIEW is preferable to a wrong merge.

## CanonicalEvent

```ts
export type CanonicalEventType =
  | 'order_created'
  | 'order_updated'
  | 'payment_completed'
  | 'shipment_created'
  | 'out_for_delivery'
  | 'delivered'
  | 'invoice_created'
  | 'refund_created'
  | 'refund_completed'
  | 'return_created'
  | 'cancelled'
  | 'other';

export interface CanonicalEvent {
  eventId: string;
  userId: string;
  eventType: CanonicalEventType;
  sourceProvider: 'mailgun' | 'nylas' | 'manual' | string;
  sourceMessageId: string;
  senderDomain: string | null;
  receivedAt: string;
  occurredAt: string | null;

  merchantRaw: string | null;
  merchantId: string | null;

  orderIdRaw: string | null;
  orderIdNormalized: string | null;
  trackingIdRaw: string | null;
  trackingIdNormalized: string | null;
  invoiceIdRaw: string | null;
  invoiceIdNormalized: string | null;
  paymentReference: string | null;

  amount: number | null;
  currency: string | null;
  orderUrl: string | null;
  trackingUrl: string | null;
  productFingerprints: string[];

  provenance: Array<{
    field: string;
    source: 'subject' | 'body' | 'header' | 'attachment' | 'provider_adapter';
    parserVersion: string | null;
  }>;
}
```

## Identity entities

### Purchase
The user-facing aggregate.

```ts
interface PurchaseIdentity {
  purchaseId: string;
  userId: string;
  canonicalMerchantId: string | null;
  primaryOrderIdentityId: string | null;
  state: 'open' | 'fulfilled' | 'cancelled' | 'returned' | 'refunded' | 'unknown';
}
```

### OrderIdentity
A purchase can have more than one order identity.

```ts
interface OrderIdentity {
  orderIdentityId: string;
  purchaseId: string;
  merchantId: string | null;
  orderId: string;
  relation: 'primary' | 'child' | 'split_child' | 'replacement';
  parentOrderIdentityId: string | null;
}
```

### Shipment

```ts
interface ShipmentIdentity {
  shipmentId: string;
  purchaseId: string;
  carrierId: string | null;
  trackingId: string | null;
  status: string | null;
}
```

### Payment

```ts
interface PaymentIdentity {
  paymentId: string;
  purchaseId: string;
  providerId: string | null;
  paymentReference: string | null;
  amount: number | null;
  currency: string | null;
}
```

### Invoice

```ts
interface InvoiceIdentity {
  invoiceIdentityId: string;
  purchaseId: string;
  issuerId: string | null;
  invoiceId: string | null;
  orderId: string | null;
}
```

Refund and return records follow the same model: their own identity plus a `purchaseId` and explicit references when present.

## Merchant identity registry

Do not keep merchant aliases hidden inside correlation logic.

```ts
interface MerchantIdentityDefinition {
  merchantId: string;
  canonicalName: string;
  domains: string[];
  senderDomains: string[];
  storefrontAliases: string[];
  invoiceIssuers: string[];
  paymentDescriptors: string[];
}
```

Adapters may emit raw merchant hints. `MerchantIdentityResolver` converts those hints into a canonical `merchantId` before candidate generation.

## Evidence graph

Every candidate link is represented explicitly.

```ts
type EvidenceType =
  | 'ORDER_ID_EXACT'
  | 'TRACKING_ID_EXACT'
  | 'PAYMENT_REFERENCE_EXACT'
  | 'INVOICE_ORDER_ID_EXACT'
  | 'ORDER_URL_EXACT'
  | 'MERCHANT_ID_MATCH'
  | 'AMOUNT_CURRENCY_MATCH'
  | 'TIME_PROXIMITY'
  | 'PRODUCT_OVERLAP'
  | 'PARENT_CHILD_ORDER';

interface EvidenceEdge {
  sourceEventId: string;
  candidatePurchaseId: string;
  evidenceType: EvidenceType;
  strength: 'hard' | 'soft';
  score: number;
  explanation: string;
}
```

## Matching rules

### Hard evidence
An event may auto-link only if the evidence identifies one compatible candidate.

1. exact normalized order ID + compatible merchant identity;
2. exact tracking ID already bound to one shipment/purchase;
3. exact payment reference already bound to one payment/purchase;
4. invoice containing an exact order ID;
5. explicit parent-child order relation;
6. exact order URL where the URL contains a stable merchant/order identity.

### Soft evidence
These never auto-merge alone:

- canonical merchant match;
- amount + currency;
- timestamp proximity;
- product overlap;
- sender domain;
- subject wording.

Soft evidence can rank candidates only after a strong relation exists, or return REVIEW.

## Conflict guards

- conflicting exact order IDs: never merge;
- same order ID at incompatible merchants: REVIEW unless the merchant registry explicitly declares equivalence;
- tracking ID bound to multiple purchases: REVIEW;
- payment reference bound to multiple purchases: REVIEW;
- lifecycle-only event without a safe anchor: REVIEW, never `NEW_PURCHASE`;
- do not perform transitive merges through only soft edges;
- a child order can join a parent purchase only through explicit parent/child evidence.

## Candidate generation

Candidate generation should use indexed identifiers, not scan every purchase.

```text
order:{userId}:{merchantId}:{orderId} -> purchase candidates
tracking:{userId}:{trackingId}         -> shipment/purchase candidates
payment:{userId}:{paymentReference}    -> payment/purchase candidates
invoice:{userId}:{invoiceId}           -> invoice/purchase candidates
```

If a merchant is unknown, exact global order ID may be considered only when unique for that user and no conflicting merchant evidence exists.

## Decision engine

```ts
type CorrelationDecision =
  | { kind: 'NEW_PURCHASE'; reasons: EvidenceEdge[] }
  | { kind: 'LINKED'; purchaseId: string; reasons: EvidenceEdge[] }
  | { kind: 'REVIEW'; candidatePurchaseIds: string[]; reasons: EvidenceEdge[] }
  | { kind: 'UNLINKED'; reasons: EvidenceEdge[] };
```

`NEW_PURCHASE` is allowed only for a safe order anchor, normally an `order_created` event with a valid order identity.

## Projection model

The identity graph is the source for correlation. The existing BuyFlow purchase row becomes a projection/read model:

```text
CanonicalEvent stream
       ↓
Evidence + identity graph
       ↓
Purchase projection
  ├─ current state
  ├─ timeline
  ├─ products
  ├─ payments
  ├─ invoices
  ├─ shipments
  ├─ returns
  └─ refunds
```

This lets BuyFlow rebuild the user-facing timeline without losing raw lifecycle facts.

## Suggested TypeScript modules

```text
apps/api/src/purchase-identity-v2/
  canonical-event.ts
  identifier-normalizer.ts
  merchant-identity-registry.ts
  candidate-index.ts
  evidence.ts
  decision-engine.ts
  graph.ts
  projection.ts
  types.ts
  tests/
```

Do not modify the current `lifecycle-correlation-shadow.ts` v1 during the first implementation. v1 remains a frozen regression comparator.

## Shadow rollout

### Phase A — types and pure engine
- canonical event types;
- merchant identity resolver interface;
- candidate indexes;
- evidence edges;
- deterministic decision result;
- unit tests only;
- 0 DB writes and 0 AI.

### Phase B — adapters into v2
Convert the current normalized parser result into `CanonicalEvent`. No new merchant subject patches are allowed as part of this phase.

### Phase C — identity graph
Add in-memory/shadow graph support for orders, shipments, payments, invoices and explicit parent-child order relations.

### Phase D — audit
- keep lifecycle v1.1 frozen;
- run v2 against v1.1 only as regression diagnostics;
- create a new fresh blind lifecycle holdout after the v2 rules are frozen;
- do not tune v2 against that fresh set after the first run except through a new subsequent holdout.

## Acceptance gates

Before any production write path:

- automatic-link precision target: 100% on fresh blind holdout;
- merge errors: 0;
- correlation-induced noise false positives: 0;
- all unsafe cases become REVIEW;
- every auto-link exposes `reasons[]`;
- no AI calls;
- no production writes;
- exact conflicting identifiers always block merge;
- one purchase can safely own multiple shipments and child orders.

Recall is deliberately secondary. A REVIEW is preferable to a wrong purchase merge.

## What we stop doing

- no per-shop correlation regex patches;
- no merchant-specific subject rules inside the correlation engine;
- no time-window-only auto linking;
- no fuzzy merchant-only auto linking;
- no chasing 100% on the existing v1.1 mailbox set;
- no production integration until a fresh blind set proves the architecture.

## Reference patterns

This design follows established patterns rather than inventing another merchant patch layer:

- entity resolution: multiple records are linked under a common identity using ordered matching rules;
- package tracking: stable tracking/order identifiers are primary signals;
- purchase views: order, shipping and delivery messages are projected into one user-facing timeline;
- event-driven modeling: immutable lifecycle events are projected into current state.
