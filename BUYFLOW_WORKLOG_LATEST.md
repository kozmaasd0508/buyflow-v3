# BuyFlow worklog latest

> Newest active slices only. Longer historical notes remain in `BUYFLOW_WORKLOG.md` and Git history.

## 2026-08-31 — Mobile Architecture Cleanup v1 — code gate GREEN

Branch: `codex/mobile-architecture-cleanup-v1`  
Review PR: #297 -> `codex/modern-email-source-foundation-v1`  
Exact verified **code** head: `b90670c9c7e4654537c060f99733b6d56ddb8553`

Implemented:
- consolidated purchase-detail status overview, lifecycle timeline and product UI into one `purchase-detail-controller.ts`;
- removed the three legacy purchase-detail TS enhancers and their document-wide MutationObservers;
- first detail render now reuses the `PurchaseDetail` already loaded by `main.ts`, avoiding three duplicate detail reads;
- product edit/hide triggers one controlled fresh detail read for the combined enhancement area;
- purchase-list API now returns `productPreviewImageUrl` from the first visible stored product image;
- purchase/home cards render a safe stored HTTP(S) product image with lazy loading + no-referrer and retain the existing icon fallback;
- shipment-facing UI wording is now **Csomagok** instead of the ambiguous `Rendelések` label;
- UI labels cover shipment-created, in-transit, out-for-delivery, pickup-ready, delayed and delivery-failed states;
- deleted detail modules exposed one stale import in `password-reset-helper.ts`; CI caught it, the import was removed, and the full gate was rerun.

Safety unchanged:
- no Purchase/Shipment/Identity authority changes;
- no Gmail/source runtime changes;
- no database migration;
- no AI authority changes;
- no product-image guessing or external product lookup; UI uses only already-stored `products.image_url`.

Verification:
- an intermediate deletion head failed only at mobile build because of the stale deleted-module import;
- GitHub Actions CI **#1139** on exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553` is GREEN:
  - API typecheck PASS
  - API tests **1286 / 1286 PASS**
  - API build PASS
  - mobile typecheck PASS
  - mobile web build PASS
- temporary CI-only PR #298 is closed **without merge**.

Remaining gate:
- browser visual smoke is still required before merge/APK. Check image + fallback cards, Csomagok navigation, detail layout and product edit/hide interaction.

Next cleanup slice after the visual gate:
- replace remaining route repurposing / design enhancer MutationObservers with explicit app routes/components;
- then add first-class Return / Refund / Warranty UX and Gmail disconnect/data-deletion UX.

---

## 2026-08-31 — Direct Gmail runtime + authenticated Pub/Sub + read-only shadow smoke

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 -> `codex/v9-real-gmail-identity-shadow`

Implemented additively:
- direct Google Gmail OAuth Authorization Code + PKCE runtime behind `BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED=false`;
- mandatory Gmail readonly scope with unexpected extra Gmail scopes rejected at the runtime boundary;
- AES-256-GCM encrypted refresh-token storage with user/connection/provider/key-version AAD;
- separate server-only credentials + Gmail cursor/watch state;
- compare-and-swap cursor commits;
- broad Gmail discovery followed by positive-commerce privacy filtering rather than whole-mailbox persistence;
- authenticated Google Pub/Sub wake-up path with RS256/JWKS, audience/issuer/time/service-account verification;
- durable deduped Gmail sync inbox with retry, stale recovery and dead-letter;
- `gmail:direct-shadow-smoke` reads a bounded sample + exact RAW MIME + history replay while performing 0 source/Purchase/Shipment/Document writes and 0 AI calls.

Deployment remains OFF/not-live:
- no live direct-Gmail/source migrations from this development flow;
- no direct Gmail production cutover;
- source archive OFF;
- Purchase/Identity authority unchanged.

Verified foundation reference: CI #1134 / modern email source branch was GREEN before the separate mobile cleanup branch was cut.

---

## 2026-08-30 — Modern email source archive + rich normalizer v1

Foundation includes `NormalizedEmailDocumentV1`, JSON-LD/schema.org extraction before AI, safe links/auth verdicts, immutable SHA-256 raw/normalized object archive, source provenance metadata and private storage design. Archive remains disabled by default and raw email bytes are not stored inline in Postgres.

Historical exact checkpoint: CI #1092 GREEN on `1f1ae0023d695f8e3b21bb4ebcde249714d358de`.
