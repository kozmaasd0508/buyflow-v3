# TrustLink trusted provider authentication — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

## Purpose

Close the remaining TrustLink code-level gap between diagnostic message authentication headers and an explicit provider-verified sender-authority provenance marker.

TrustLink already required merchant-scoped create/link promotion to contain:
- `field=sender_authority`
- `source=provider_adapter`
- qualifier `trusted_sender_authority`

Before this change no runtime path produced that provenance, so merchant-scoped promotion remained fail-closed.

## Gmail provider policy v1

Added `apps/api/src/purchase-identity-v2/provider-sender-authority.ts`.

The Gmail adapter grants sender authority only when all of the following hold:
1. source provider is exactly `gmail`;
2. the **first** `Authentication-Results` header has authserv-id exactly `mx.google.com`;
3. that trusted header reports `dmarc=pass`;
4. the authenticated `header.from` domain is present and exactly equals the normalized visible primary sender domain.

If any condition is missing, malformed or contradictory, the adapter emits no authority provenance.

A successful result adds only provenance:
- field `sender_authority`;
- source `provider_adapter`;
- parser/extractor version `provider-sender-authority-v1`;
- qualifier `trusted_sender_authority` plus provider/authserv/DMARC/domain trace qualifiers.

It does **not** invent or mutate merchant id, order id, tracking id, payment reference, invoice id or any other Purchase identity value.

## Shadow integration

`runPurchaseIdentityShadow()` now appends provider sender-authority provenance after canonical extraction and before TrustLink promotion-readiness evaluation.

The graph remains an in-memory shadow simulation:
- productionWrites = 0;
- aiCalls = 0;
- no database write path was enabled;
- no production flag or migration was changed.

## Regression coverage

Added `provider-sender-authority.test.ts` covering:
- trusted Gmail `mx.google.com` + DMARC pass + exact `header.from` -> authority;
- non-Gmail source -> no authority;
- spoofed/non-Google authserv-id -> no authority;
- DMARC fail -> no authority;
- authenticated `header.from` mismatch -> no authority;
- a later forged `mx.google.com` header cannot override a non-trusted first Authentication-Results header;
- trusted Gmail authority flows into TrustLink audit-only promotion readiness;
- domain mismatch remains `NEW_PURCHASE_MERCHANT_SCOPE_UNPROVEN`.

## CI evidence

Verification PR #310 was created only for CI and closed unmerged.

Exact verified head: `2424d1d19bd975b7d2905f47352520abab93c50d`.

GitHub Actions CI #1188 / run `33666543307`: **PASS**.

All steps passed:
- EventMind V11 runtime syntax;
- EventMind V11 launcher syntax;
- API typecheck;
- API tests;
- API build;
- Mobile typecheck;
- Mobile web build.

## Verdict

**TrustLink trusted Gmail provider-authentication code path: PASS.**

This closes the prior code-level provenance gap for direct Gmail messages in shadow/readiness evaluation.

It does **not** mean TrustLink production writes are enabled. Before production promotion, BuyFlow still needs the controlled Direct Gmail runtime/cursor deployment gate and an explicit separate production cutover decision. Other mailbox/provider adapters must define their own trusted provider-authentication policy rather than inheriting Gmail trust.
