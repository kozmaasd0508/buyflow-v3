# TechnicalEvidence Shopify development preflight — 2026-08-23

**Mode:** development/regression observation only  
**Production writes:** 0  
**AI calls:** 0

## Question

Can Shopify receive lifecycle/order TechnicalEvidence authority without granting authority from a generic Shopify logo, CDN URL, CSS class or platform fingerprint alone?

## Real reviewed evidence

Two independent merchants in the reviewed Gmail corpus expose the same native Shopify order-confirmation family.

### Merchant family A

Observed machine layers:
- message received from `mailer.shopify.com`;
- Shopify-owned message metadata (`Message-ID @shopify.com`, `Feedback-Id ...:shopify`);
- standard Shopify notification DOM such as `order-list__product-image`;
- Shopify CDN assets;
- explicit current-message order label/number;
- explicit order-confirmation subject semantics.

### Merchant family B

Observed machine layers:
- sender/return-path under `t.shopifyemail.com` / `mailer.t.shopifyemail.com`;
- DKIM/DMARC passes for Shopify email infrastructure;
- message received from `mailer.shopify.com`;
- the same Shopify notification DOM family;
- explicit current-message order label/number;
- explicit order-confirmation subject semantics.

The second merchant also has native Shopify shipment and delivered notifications carrying the same order reference. The delivered message contains an explicitly labelled tracking/waybill value.

## Important counterexample

A later commerce email from the first merchant is sent through a merchant/Amazon SES pipeline while still containing Shopify-related assets. Therefore Shopify HTML/CDN evidence alone is not enough to prove native Shopify lifecycle semantics.

Likewise, Shopify account/security notifications may be authentically sent by Shopify infrastructure but are not commerce lifecycle messages.

## v1.5 shadow rule

`technical-evidence-shopify-v1.ts` requires all of:

1. native Shopify relay evidence (`mailer.shopify.com`);
2. at least one independent Shopify authentication/message corroborator;
3. standard Shopify transactional order-template DOM;
4. explicit current-message order identity.

Only then can it emit Shopify commerce TechnicalEvidence.

For order confirmation, two independent merchants have been reviewed, so the adapter can emit:
- platform = Shopify;
- merchant-scoped order number when storefront scope is recoverable;
- event = `order_created` when the current subject explicitly proves confirmation.

For native shipment/delivery, the adapter requires the same strong transport/template/order context plus explicit current-message lifecycle wording. These lifecycle paths remain marked as reviewed from only one independent merchant family in the current mailbox and are NOT a broad generalization claim.

An explicitly labelled tracking value may be captured, but it receives no carrier namespace. It must not become hard Shipment merge authority until a carrier namespace is independently resolved.

## Fail-closed cases

- Shopify CDN / DOM without native Shopify authenticated transport -> no Shopify lifecycle authority.
- Native Shopify infrastructure without transactional order DOM + explicit order id -> no commerce event.
- Shopify security/login email -> no commerce event.
- Future shipment wording inside order confirmation -> does not become shipment.
- Tracking-like value without a carrier namespace -> cannot directly hard-merge to a carrier Shipment identity.

## Development measurement effect

On the same original ten-family development slice used for v1.4, Shopify order confirmation was the only remaining unsupported commerce-specific family.

After the strict Shopify order-confirmation adapter:

| Metric | v1.4 | v1.5 development projection |
|---|---:|---:|
| auth/transport evidence | 10/10 | **10/10** |
| commerce-specific TechnicalEvidence | 9/10 | **10/10** |
| explicit event TechnicalEvidence | 6/10 | **7/10** |
| merchant-scoped / namespaced identifier TechnicalEvidence | 7/10 | **8/10** |

Including the separately reviewed GLS COD-receipt PDF family, the extended 11-family development slice becomes:

| Metric | v1.5 extended development slice |
|---|---:|
| commerce-specific TechnicalEvidence | **11/11** |
| explicit event TechnicalEvidence | **8/11** |
| merchant-scoped / namespaced identifier TechnicalEvidence | **9/11** |

These figures are development coverage only. They are not precision/recall, a blind holdout result, or production accuracy.

## External corroboration

Current Shopify developer documentation separately confirms that Shopify supports customer order confirmation and shipping/fulfillment notifications and tracking information. This corroborates the event families but does not replace the real-email evidence or relax the transport/template gates.

## Next gate

1. Keep v1.5 shadow-only; do not wire it into automatic Purchase/Shipment decisions yet.
2. Run/compile the repository test suite when a CI-capable target is available.
3. Freeze a completely new untouched broad holdout before any generalization/accuracy claim.
4. In the blind gate, measure false-positive safety especially against Shopify account/security/marketing mail and merchant custom mail containing Shopify assets.
