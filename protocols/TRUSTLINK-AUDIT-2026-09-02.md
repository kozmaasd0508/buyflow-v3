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

## Current verdict

- TrustLink deterministic correlation logic: reviewed, conservative.
- Merchant sender-authority promotion gap: remediated.
- Production writes: still OFF / unavailable from this audit path.
- Trusted provider-authentication provenance: not implemented yet, therefore merchant-scoped production promotion remains BLOCKED by default.

Next after CI: record exact verified head/run, then continue the module audit with JourneyGraph. MailGate/RawVault live/staging gates remain separate blockers for any source cutover.
