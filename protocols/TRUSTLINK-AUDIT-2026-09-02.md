# TrustLink audit — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`

## Role

TrustLink answers only:

> Which existing Purchase, if any, is this event safely allowed to correlate with?

It must not guess identity from score, time proximity, product similarity or AI semantics.

## Existing safety properties reviewed

- identity keys are scoped by user + namespace + normalized stable identifier;
- unscoped order/tracking/payment/invoice discovery is review-only;
- multiple hard candidates become REVIEW;
- extraction hard conflicts become PENDING;
- lifecycle-only messages cannot create a Purchase;
- Purchase creation requires separate deterministic root authority;
- explicit parent/child relations require explicit provenance and fail closed on ambiguity;
- REVIEW/PENDING/UNLINKED decisions do not mutate the graph;
- the current orchestration remains shadow-only with `productionWrites: 0`;
- promotion readiness is audit-only and is the stricter gate for any future write path.

## Finding: visible sender domain was too strong for promotion

The canonical merchant resolver and unknown-merchant sender namespace can use the visible sender domain as one identity signal. That is useful for discovery/simulation, but the visible `From:` domain by itself is not cryptographic sender authentication and can be spoofed.

MailLens deliberately parses raw authentication headers as diagnostic-only (`trusted: false`) because raw message content cannot prove which trusted authentication service inserted those headers.

Before remediation, a merchant-scoped hard order decision could therefore be marked promotion-eligible without a separately trusted sender-authority signal.

## Remediation

`promotion-readiness.ts` now requires an explicit trusted merchant-sender authority marker before merchant-scoped CREATE_PURCHASE or hard order/parent-child/invoice-via-merchant promotion can be eligible.

The accepted marker is deliberately narrow:

- provenance field: `sender_authority`
- provenance source: `provider_adapter`
- qualifier: `trusted_sender_authority`

A raw/header-origin marker does not qualify. Current MailLens diagnostic authentication does not create this marker, so the default remains fail-closed.

Carrier-scoped tracking identity remains independent of merchant sender authority because its hard identity is user + carrier namespace + tracking identifier. Journey/state authority is audited separately downstream.

## Regression verification

The first verification CI (#1168 / run `33648039402`) correctly exposed that the old synthetic lifecycle-chain fixture did not declare the new trusted sender authority. The production safety rule was not weakened. Instead, the synthetic safe-merchant fixture was updated to explicitly model a provider-authenticated sender.

Final verified code head:
`dcbd2e5a95b00d1b7c67ce845329d9b8164cc8ba`

GitHub Actions CI #1169 / run `33648405215`: **PASS**.

All checks passed:
- EventMind V11 Python runtime syntax;
- EventMind V11 PowerShell launcher syntax;
- API typecheck;
- API tests;
- API build;
- mobile typecheck;
- mobile web build.

The 25-scenario lifecycle-chain regression gate remains zero-trust: safe synthetic merchant cases carry explicit trusted provider provenance, while ambiguous/conflicting/unscoped cases remain blocked.

## Final verdict

- **TrustLink deterministic correlation logic: PASS**.
- **Merchant sender-authority promotion gap: REMEDIATED**.
- **Production writes: OFF / unavailable from this audit path**.
- **Trusted provider-authentication provenance is not wired into real source adapters yet**, therefore merchant-scoped production promotion remains **BLOCKED by default**.
- MailGate/RawVault live/staging gates remain separate blockers for source cutover.

Next module audit: **JourneyGraph**.
