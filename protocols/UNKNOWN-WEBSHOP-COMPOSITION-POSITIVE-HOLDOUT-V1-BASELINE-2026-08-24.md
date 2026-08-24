# Unknown Webshop Semantic Composition Positive Holdout v1 — first baseline

Date: 2026-08-24

## Frozen code
Scored snapshot: `3712d949d26110984a67cba2a5c7551ce0c23428`

The 30 candidate messages were selected and hashed before content review. No grammar, semantic or composition rule changed before this baseline was recorded.

## Post-freeze ground truth
30 incoming attachment-enriched candidates:

- purchase-linked final invoice deliveries: **15**
- service / utility final invoice notifications: **2**
- service payment/reminder messages: **3**
- other real purchase/order/shipment messages selected because they carried document-like attachments or invoice words: **10**
- proforma/payment-request/correction documents: **0**

The purchase-linked invoice group contains multiple independent merchants and several different delivery shapes. Merchant-specific adapters are not counted for the universal score.

## Universal Composition v1 result on purchase-linked invoices
Automatic canonical INVOICE compositions: **3 / 15**

Held / missed as automatic INVOICE: **12 / 15**

Coverage on this blind purchase-invoice holdout: **20.0% (3/15)**.

This is the first positive blind score for Semantic Composition v1 and must not be described as global accuracy.

### What the 3 successful cases had in common
The frozen composition could combine:
- visible INVOICE meaning,
- a real PDF attachment,
- and currently supported sent/available semantics such as an explicit `we send` equivalent.

No merchant name was required by the composition rule.

### Generic shapes currently missed
The 12 misses reveal semantic-shape gaps rather than merchant-specific gaps:

1. **invoice arrived / new e-invoice arrived** wording without a direct PDF attachment;
2. **download/view portal** delivery, where the invoice is available through a link rather than attached;
3. **attachment-container wording** such as “in the attachment / as an attachment” variants not normalized to the current ATTACHED concept;
4. adjectival **issued invoice** forms not normalized to the ISSUE action;
5. a message containing **invoice + shipment progress together**, where the single-result composition model cannot yet emit both independent observations cleanly.

## Service / utility safety finding
Two messages are genuine service/utility invoices rather than purchase invoices.

- one remains held by the current composition rules;
- one satisfies the semantic `INVOICE + PDF + completed/available` composition and would be marked `actionable` at the composition layer.

Semantically this second case really is an invoice, so it is not a semantic hallucination. However, it proves that **semantic actionability must not equal Purchase authority**.

A separate commerce-ownership/context gate is required before any composed invoice/payment event is allowed to attach to or create purchase state.

Current production impact remains **0** because this entire lane is shadow-only and has no write authority.

## Other lifecycle observations
The candidate set also contains real order and shipment messages. Static replay of the frozen composition rules found no reason to promote invoice-looking marketing/service text into a purchase order event. Combined invoice + shipment messages expose the need for a multi-observation output rather than a single winner.

## Safety summary
- production writes: **0**
- AI calls: **0**
- merchant-specific rules used for the universal score: **0**
- raw Gmail identifiers/content committed: **0**
- purchase-invoice universal composition: **3/15**
- blind purchase-invoice misses/holds: **12/15**
- service/utility ownership risk exposed: **1 actionable semantic invoice that must not gain Purchase authority by itself**

## Next universal steps
Do not add merchant-specific invoice rules.

1. Expand the semantic interlingua with generic delivery concepts:
   - ARRIVED / RECEIVED invoice
   - ATTACHED / IN_ATTACHMENT variants
   - DOWNLOADABLE / VIEWABLE / PORTAL_AVAILABLE
   - ISSUED adjectival variants
2. Move Semantic Composition from single-winner output toward **multiple independent canonical observations** so one email may safely emit both INVOICE and SHIPPED evidence.
3. Add a separate **Commerce Ownership Gate**: an invoice/payment event may be semantically valid while still having no authority over a Purchase unless it has a hard purchase anchor or independently trusted commerce context.
4. Validate changes on a new unseen merchant-family/document holdout. These 30 messages are regression-only after this baseline.
