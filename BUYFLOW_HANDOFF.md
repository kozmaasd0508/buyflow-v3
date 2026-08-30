# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md` / `BUYFLOW_WORKLOG.md`. Reconcile with GitHub before runtime changes.

**Last updated:** 2026-08-31 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Identity architecture base:** `codex/v9-real-gmail-identity-shadow`  
**Modern email source branch:** `codex/modern-email-source-foundation-v1` / PR #295 (draft)  
**Mobile cleanup branch:** `codex/mobile-architecture-cleanup-v1` / PR #297 (draft)  
**Exact mobile-cleanup code head verified by CI:** `b90670c9c7e4654537c060f99733b6d56ddb8553`

## SAFETY CONTRACT

- AI/Qwen may provide lifecycle semantics only; it never grants hard identity/link authority.
- Lifecycle-only mail cannot create a Purchase.
- Hard conflicts remain REVIEW/PENDING; false merge / false Purchase-create tolerance is zero.
- Direct Gmail runtime, source archive and Mailgun source persistence remain OFF by default.
- No modern email-source/direct-Gmail migration has been applied live from this development flow.
- No provider cutover, Purchase/Shipment/Identity authority change or raw customer mail commit occurred in the mobile cleanup.

## EXISTING PURCHASE IDENTITY GRAPH

Extend the existing Purchase Identity Graph v2 concepts; do not create a parallel graph. Existing core includes `CanonicalEvent`, Purchase/Order/Shipment/Payment/Invoice identities, `EvidenceEdge`, `CorrelationDecision`, merchant identity and explicit parent/child order relations.

## MODERN EMAIL SOURCE + DIRECT GMAIL FOUNDATION

PR #295 contains the privacy-first source layer:
- `NormalizedEmailDocumentV1` with plain text + HTML, headers, attachments, structured data, safe links, auth verdicts and provenance;
- JSON-LD/schema.org extraction before AI;
- immutable raw/normalized object archive with SHA-256 and opaque keys;
- direct Gmail provider with exact RAW MIME, attachments, initial snapshot + `history.list`, expired-history reset and Pub/Sub watch/renew/stop;
- OAuth Authorization Code + PKCE with `gmail.readonly`, encrypted refresh token storage and separate durable cursor/watch state;
- authenticated Google Pub/Sub wake-up path with OIDC/JWKS verification, dedupe/retry/stale recovery/dead-letter;
- personal-mailbox privacy gate: broad Gmail read may happen, but unknown personal mail is dropped before source/archive persistence unless positive commerce evidence exists;
- read-only `gmail:direct-shadow-smoke` command that performs 0 source writes, 0 Purchase/Shipment/Document writes and 0 AI calls.

Live Google staging/shadow setup is still pending; do not claim direct Gmail production cutover.

## MOBILE ARCHITECTURE CLEANUP V1

PR #297 is based on the modern email source branch and is intentionally separate from Gmail/identity runtime work.

Implemented on verified code head `b90670c9c7e4654537c060f99733b6d56ddb8553`:
- one `purchase-detail-controller.ts` now owns purchase status overview, lifecycle timeline and product cards/editing;
- deleted the three legacy purchase-detail TS enhancers (`purchase-detail-overview-panel.ts`, `purchase-timeline-panel.ts`, `product-details-panel.ts`);
- removed their top-level script tags and their three independent document-wide `MutationObserver`s;
- first purchase-detail render reuses the already-loaded `PurchaseDetail` instead of re-fetching the same record independently for overview/timeline/products;
- product edit/hide refreshes the combined detail enhancement with one fresh purchase read;
- `/api/purchases` now exposes `productPreviewImageUrl` from an already-stored visible product image;
- purchase cards render that safe HTTP(S) product image with lazy loading + `no-referrer`, otherwise fall back to the existing icon;
- shipment-facing UI label is now **Csomagok**, while the internal legacy route key `orders` remains for compatibility;
- visible lifecycle labels now cover shipment-created, in-transit, out-for-delivery, pickup-ready, delayed and delivery-failed states;
- CI exposed one stale hidden import in `password-reset-helper.ts`; it was removed before the final green gate.

What this cleanup does NOT do:
- it does not invent or externally search for product images; it only displays `products.image_url` already present in BuyFlow data;
- it does not yet consolidate every remaining design/settings/inbox enhancer;
- it does not change Gmail provider selection or OAuth cutover;
- it does not add first-class Return/Refund/Warranty persistence/UI yet.

## MOBILE VERIFICATION

Temporary PR #298 targeted `main` only for CI and is closed unmerged.

GitHub Actions CI **#1139** on exact code head `b90670c9c7e4654537c060f99733b6d56ddb8553`:
- API typecheck PASS
- API tests **1286 / 1286 PASS**
- API build PASS
- Mobile typecheck PASS
- Mobile web build PASS

A browser visual smoke is still required before merge/APK. Verify at minimum:
1. purchase cards with image and icon fallback;
2. **Csomagok** navigation and empty/loading states;
3. purchase detail ordering and responsive layout;
4. product edit/hide behavior after the controller consolidation.

Do not claim visual validation until it is actually run.

## NEXT ACTIONS

Mobile track:
1. browser visual smoke for PR #297;
2. refine only concrete visual/interaction regressions found there;
3. keep #297 draft until the smoke is clean;
4. later cleanup v2 may replace remaining route-repurposing/design enhancer MutationObservers with explicit app routes/components.

Product track after the cleanup gate:
- decide deterministic product-image acquisition/provenance rules (email structured data / merchant product URL first; never guess a model image);
- add first-class Return / Refund / Warranty views on Purchase Detail;
- add Gmail disconnect/data-deletion/export UX;
- cut Gmail settings over to direct Gmail only after the staging migration + real shadow smoke is green.

Direct Gmail track remains as before:
- staging/test Supabase migrations;
- dedicated Google OAuth test client/account + encrypted credential key;
- run `gmail:direct-shadow-smoke` with zero writes;
- only then consider single-account source persistence/archive shadow enablement.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
