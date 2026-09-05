# Core audit — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`

## Scope

Core was reviewed as the final Purchase authority boundary after TrustLink, JourneyGraph and DocVault. The audit focused on Purchase creation, financial enrichment, payment mutation and lifecycle state changes that could bypass those newer controls.

## Findings

### 1. Legacy lifecycle trigger bypassed JourneyGraph and trusted sender authority

`trg_apply_trusted_merchant_lifecycle_source` derived merchant authority from the visible email `From:` domain and directly changed `purchases.current_state`, `shipped_at` and `delivered_at`.

This was unsafe because:
- visible `From:` is not trusted sender authority;
- the trigger bypassed TrustLink's provider-authenticated sender requirement;
- it bypassed JourneyGraph's multi-shipment aggregate and could mark a Purchase delivered from one lifecycle source.

Remediation: the prepared Core migration drops the trigger and its function. No replacement direct Purchase lifecycle trigger is introduced.

### 2. Legacy Purchase creation boundary was weaker than TrustLink

`controlled_create_purchase_with_sources` checked source ownership but did not independently prove the current trusted-sender authority contract or derive Purchase identity from a locked database-side evidence contract.

Remediation:
- automatic Purchase creation is fail-closed in `automatic-write-gate.ts`;
- the prepared Core migration replaces the legacy RPC with an explicit fail-closed function.

### 3. Legacy order/payment RPCs accepted caller-supplied financial JSON

`controlled_enrich_purchase_from_order_source` and `controlled_apply_payment_evidence` validated that a source existed, then used caller-provided JSON to mutate Purchase financial/payment fields. A valid source could therefore act as a bearer token for values that were not independently re-derived at the database boundary.

Remediation:
- legacy automatic `payment_completed` evidence is fail-closed at the automatic write gate;
- both legacy financial/payment RPCs are replaced by explicit fail-closed functions in the prepared Core migration.

## Preserved lanes

This Core hardening does not disable:
- the separately controlled Shipment write lane audited under JourneyGraph;
- the separately controlled invoice/document write lane audited under DocVault.

The authenticated application Purchase API remains read-oriented; this audit does not introduce a user-facing direct Core mutation endpoint.

## Prepared migration

`supabase/migrations/20260902170000_harden_core_purchase_authority.sql`

The migration is source-only preparation. It was **not applied** to staging or production. Staging must first apply the prior JourneyGraph/DocVault prerequisites and verify existing Purchase data/state before Core migration promotion.

## Verification

Verified PR head:
`326b6481fc74c9f367a841f334ecd22928030012`

GitHub Actions CI #1185 / run `33658358024`: **PASS**.
- EventMind Python runtime syntax: PASS
- EventMind PowerShell launcher syntax: PASS
- API typecheck: PASS
- API tests, including Core fail-closed tests: PASS
- API build: PASS
- mobile typecheck: PASS
- mobile web build: PASS

Temporary verification PR #308 was closed unmerged.

## Verdict

- **Core code / Purchase authority audit: PASS**
- legacy automatic Purchase creation: **OFF / FAIL-CLOSED**
- legacy automatic payment/financial mutation: **OFF / FAIL-CLOSED**
- legacy visible-From lifecycle Purchase mutation: **REMOVED BY PREPARED MIGRATION**
- Shipment/DocVault controlled lanes: **PRESERVED**
- production Core migration: **NOT APPLIED / BLOCKED** pending controlled staging migration + smoke verification

Next module audit: **Pulse**.
