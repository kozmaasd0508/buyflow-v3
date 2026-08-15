# BuyFlow V3 — latest recovery worklog

> Newest detailed entries. Read this after `BUYFLOW_HANDOFF.md`; older historical entries remain in `BUYFLOW_WORKLOG.md` and Git history.

## 2026-08-16 — web-derived unseen email benchmark

### Goal

The user had no additional fresh Gmail account available, so we built a second blind-style benchmark from **publicly documented notification categories and semantics** instead of private customer emails. Official Shopify/WooCommerce documentation was used only to identify notification types and expected meanings; fixtures are synthetic and do not copy full real emails.

### PR #95 — unseen public-web notification corpus

Branch `agent/web-unseen-email-benchmark-v1`.

24 new fixtures were added on top of the permanent 31-email demo mailbox benchmark, for **55 benchmark emails total** across both suites.

New Shopify-like cases:
- order edited
- order cancelled
- partial refund
- shipping confirmation
- shipping update
- ready for local pickup
- picked up
- return created
- return approved
- exchange balance due / action required
- pending payment success
- POS receipt with a short local id.

New WooCommerce-like cases:
- failed payment
- on hold
- processing
- completed
- full refund
- partial refund
- invoice/order-details payment link.

Carrier/security cases:
- DPD out for delivery
- DHL delivered
- UPS in transit
- DHL attacker-domain lookalike
- account-reset noise.

Safety assertions require all post-purchase lifecycle fixtures to avoid `order_created`; delivery-today/out-for-delivery must never become final delivery; explicit carrier lookalikes and unrelated account mail must stay held.

### First run found another real carrier-domain bug

PR CI #472 failed on synthetic sender `alerts@notify.dhl.com.attacker.example`.

Root cause: PR #93 had hardened the central `sender-role.ts`, but `deterministic-commerce-parser.ts` still carried a second legacy carrier-domain matcher. It accepted the trusted string `dhl.com` when it appeared inside a larger attacker-controlled hostname.

The benchmark was not changed to allow the behavior. The parser was fixed so carrier domain matching now requires either:
- exact trusted domain, or
- an actual subdomain ending in `.<trusted-domain>`.

Thus `notify.dhl.com` remains valid while `notify.dhl.com.attacker.example` is rejected.

Fix commit on PR branch: `6386fb6a9f47e2c90a3f1a029ef9d44f4eeabba3`.

### Final result

Final PR CI #473:
- **370/370 API tests passed**
- API build passed
- mobile typecheck passed
- mobile web build passed.

Merged runtime: `8f41524bdd361b326464ab92e7d3645b0ae8191f`.
- main CI #474 passed.
- exact Render smoke #368 passed for that exact runtime commit, including exact-deployment health, browser preview, password-reset page, authenticated API protection, CORS, Nylas challenge and webhook-secret enforcement.

Final web benchmark report:
- fixtures: 24
- deterministic recognized: 3
- safely held/unrecognized: 21
- dangerous `order_created` classifications among unseen lifecycle fixtures: 0
- DPD out-for-delivery -> shipment, not delivery, tracking retained, phase currently null
- DHL delivered -> delivery
- UPS in transit -> shipment
- DHL attacker lookalike -> rejected
- short POS receipt -> held
- account reset -> held.

The **3/24 number is not an overall recognition percentage**. Eighteen fixtures are deliberately new lifecycle classes not yet implemented generically. Their safe non-recognition is preferable to creating or modifying the wrong Purchase.

### Coverage gaps exposed

18 important generic lifecycle gaps remain:

Shopify-like:
- order edited
- order cancelled
- partial refund
- shipping confirmation
- shipping update
- ready for pickup
- picked up
- return created
- return approved
- exchange balance due
- pending payment success.

WooCommerce-like:
- failed payment
- on hold
- processing
- completed
- full refund
- partial refund
- invoice/payment link.

Implementation rule: these must be linked to an already established Purchase identity with lifecycle-safe semantics. Do not broaden the generic order-confirmation parser to make them pass.

Priority from this benchmark:
1. generic DPD out-for-delivery phase;
2. generic trusted-merchant shipping confirmation/update using exact order + tracking anchors;
3. generic cancellation/payment-failed/on-hold/processing;
4. refund partial/full;
5. pickup ready/picked-up;
6. explicit return/exchange model and lifecycle.

---

## 2026-08-15 — isolated demo mailbox benchmark

PR #93 added the first isolated 31-email synthetic mailbox benchmark executing the deterministic parser/validator/resolution/state core without touching production user data.

Coverage:
- 20 must-positive commerce/lifecycle events
- 8 hard-negative/noise messages
- 3 probes
- HU/EN/DE/FR/ES orders, COD, GymBeam/Express One, Gyerekjatekbolt failed payment/cancel, AlzaBox, Szidibox/MPL and security/noise cases.

First run found two real defects:
1. Spanish order ID could be hidden by an earlier invalid `pedido` match.
2. loose central carrier token matching allowed `gls-security.example`.

Both were fixed. Final result:
- 20/20 positives recognized
- 0/8 hard-negative false parser matches
- 8 generic direct Purchase candidates
- GymBeam/Express One final delivered
- Gyerekjatekbolt final cancelled + payment failed
- MPL pickup stays ready_for_pickup
- packing/pre-advice cannot downgrade physical shipment.

Runtime `09dc10193b2be8404dcdac2306caf4a28bd4b564`; PR CI #468, main CI #469, exact Render smoke #363 passed.

The later PR #95 web benchmark then discovered that a **second** independent carrier matcher still needed the same trusted-suffix hardening.

---

## 2026-08-15 — private invoice PDF opening

PR #91 runtime `f7d25a3384e864a45d5c9f10bff833b31304151a`.
- PR CI #459, main CI #460 and exact Render smoke #354 passed.
- authenticated Purchase ownership is verified before document access.
- private stored email-attachment PDFs get a 60-second signed Supabase URL.
- storage bucket/path are not exposed in the public DTO.
- Purchase detail is `Cache-Control: no-store`.
- existing mobile/web `Megnyitás` opens the signed URL.

Jatekbolt invoice `S26_044783` remains the live proof.

---

## 2026-08-15 — deterministic PDF attachment ingestion

PR #88 implemented native Nylas -> private Supabase Storage -> `unpdf` text-layer -> `pdf-invoice-v1` -> exact Purchase resolution -> controlled document write.

Important rules:
- PDF <=10 MiB
- private bucket
- full extracted PDF text not persisted
- explicit invoice + order identity required
- exactly one existing Purchase for auto-link
- ambiguity/unmatched => REVIEW
- no Purchase creation/lifecycle/money changes from attachment recovery
- scanned PDFs remain REVIEW; no OCR in V1
- AI 0.

First live proof: Jatekbolt `S26_044783.pdf`, order ref `JB12247833` -> existing Purchase `12247833`, exactly one private invoice document, Purchase financial/lifecycle integrity unchanged.

---

## Persistent current context

Multi-Gmail 7/30/90 deterministic scans are live. Second real Gmail 30-day blind scan checked 149 messages with zero false automatic Purchases.

Last verified source backlog before benchmark-only changes:
- REVIEW 34
- unlinked 10
- unresolved source emails 44
- historical AI runs 98.

The benchmark PRs themselves do not mutate production Purchase/Shipment/Document rows.
