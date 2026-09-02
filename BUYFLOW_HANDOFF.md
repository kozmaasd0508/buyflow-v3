# BuyFlow V3 — persistent handoff

> Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md`. Reconcile with current GitHub/live state before changing runtime code.

**Last updated:** 2026-09-02 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current main:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Source/audit branch:** `codex/modern-email-source-foundation-v1`  
**Architecture PR:** #295 draft -> `codex/v9-real-gmail-identity-shadow`

## SAFETY CONTRACT

- Qwen/AI may classify commerce/lifecycle semantics only; it never grants hard Purchase identity.
- Lifecycle-only email cannot create a Purchase.
- Multiple/hard-conflicting identity candidates remain REVIEW/PENDING.
- Direct Gmail runtime defaults OFF.
- Source archive defaults OFF.
- Mailgun source persistence defaults OFF.
- No direct-Gmail/source migration has been applied live from this development flow.
- No provider production cutover.
- No raw customer email bodies/secrets committed to Git.
- Pub/Sub/OAuth/provider cursor/archive state has zero Purchase authority.

## MODULE AUDIT ORDER

`MailGate -> RawVault -> MailLens -> EventMind -> TrustLink -> JourneyGraph -> DocVault -> Core -> Pulse`

The full audit started on 2026-09-02 after the V12 promotion gate failed. V11 remains the better current semantic model; V12 is not promoted.

## MAILGATE

Role: provider authorization/source acquisition only. It must read Gmail safely, maintain complete durable incremental sync, protect personal-mailbox privacy, and never create/link Purchase identity.

Audit blockers were remediated on behavior head `e67b908e07d072e3737611eca4ee804d7d905c26`:
- complete discovery snapshot before cursor commit;
- detached Gmail text/html body hydration;
- no fabricated 1970 timestamp;
- bounded retry/concurrency;
- expired-history automatic recovery snapshot;
- automatic watch renewal;
- periodic cursor fallback independent of Pub/Sub;
- rejection of unexpected/broad Gmail OAuth authority.

CI #1142 on exact behavior head: API typecheck/tests/build + mobile typecheck/web build all PASS.

Protocol: `protocols/MAILGATE-DIRECT-GMAIL-AUDIT-REMEDIATION-2026-09-02.md`

Status:
- **MailGate code audit remediation: PASS**
- **Production MailGate: BLOCKED** pending controlled real-Gmail read-only shadow smoke.

## RAWVAULT

Role: immutable source evidence storage only. It owns exact raw provider/MIME bytes when available, versioned normalized source documents, integrity metadata, opaque object identities, retention and crash/orphan/account-deletion cleanup. It has zero Purchase/Identity authority.

Behavior code head verified by CI:
`9480e6d4e8d5c3e0a771b43671503cda593971c2`

Current RawVault design:
- artifacts are fully prepared/hashes computed before writes;
- opaque durable `email_source_archive_manifests` row is staged before object writes;
- manifest contains no user id, provider message id, subject or body;
- raw + normalized object identities/hashes/retention are DB-immutable;
- separate raw and normalized retention boundaries;
- no retention duration is guessed: archive writes fail closed until both retention settings are explicit;
- empty raw and expired/invalid retention fail before object writes;
- duplicate provider message raw SHA mismatch fails closed;
- pending manifests survive source-insert failure and provide a crash-safe retry/cleanup journal;
- periodic maintenance heals commit races, deletes stale orphans, enforces raw/normalized retention independently, and removes archived objects after source/user deletion;
- object/hash identity remains in audit metadata while deletion timestamps record cleanup;
- bucket remains private and archive remains OFF by default.

Migration:
`supabase/migrations/20260902115500_harden_email_source_archive_v1.sql`

Protocol:
`protocols/RAWVAULT-AUDIT-REMEDIATION-2026-09-02.md`

Temporary CI-only PR #296 / CI #1147 on exact behavior head:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

Status:
- **RawVault code audit remediation: PASS**
- **Production RawVault: BLOCKED** until controlled staging migration + explicit retention policy + real private-storage retention/orphan smoke.

## MAILLENS

Role: one provider-neutral evidence normalization contract between MailGate/RawVault and candidate gating, deterministic parsing, universal semantics and EventMind. MailLens may normalize representation but has zero identity authority.

Initial blockers were remediated on exact behavior head:
`f69195404831323f2783464a61f6f7b7435698b5`

Current MailLens contract:
- normalizer version `normalized-email-document-v1.1`;
- full bounded `bodyText` and separate current `semanticText`;
- explicit body-source/truncation/hidden/quoted-history metadata;
- provider plain text preferred, HTML-derived text fallback, snippet last resort;
- archived raw HTML stays preserved while legacy semantic consumers receive the MailLens semantic text view;
- deterministic parser, legacy email document, Gmail privacy candidate gate, normalized inbound planning/universal grammar and diagnostic identity shadow are routed through the MailLens semantic view;
- common hidden/preheader HTML is removed from derived semantic text without deleting source HTML;
- strong quoted/reply history is excluded from current semantic text but remains in full body evidence;
- Gmail text/HTML attachments cannot contaminate authored message body; detached real body parts still hydrate;
- raw `Authentication-Results`/ARC/Received-SPF parsing is explicitly diagnostic-only (`trusted:false`) with source provenance;
- JSON-LD audit is bounded/iterative; raw JSON parses first, compatibility entity decoding is provenance-tagged;
- microdata itemtype is type-hint-only (`fieldEvidence:false`) until real bounded itemprop extraction exists;
- numeric HTML entities are handled in semantic/link/structured-data compatibility paths.

Protocol:
`protocols/MAILLENS-AUDIT-2026-09-02.md`

Temporary CI-only PR #296 / GitHub Actions CI #1151, run `33631564933`, exact behavior head `f69195404831323f2783464a61f6f7b7435698b5`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #296 was closed unmerged after verification.

Status:
- **MailLens code audit remediation: PASS**
- **Production source path: BLOCKED** behind controlled MailGate + RawVault staging/live smokes and explicit enablement.

Important limitations remain fail-closed/non-authoritative:
- arbitrary HTML/CSS is not claimed to be browser-perfect rendered;
- type-only microdata is not field evidence;
- header-derived email-auth verdicts are never hard trust evidence by themselves.

## EVENTMIND

Role: semantic commerce/lifecycle classification only: **“Mi történt ebben az emailben?”** It must not answer **“Melyik vásárláshoz tartozik?”**

Current reference semantic model remains V11 Qwen3-8B QLoRA. V12 remains unpromoted because its untouched post-training holdout regressed versus V11:
- V11: 105/108 = 97.22%
- V12: 102/108 = 94.44%
- V12 wins: 0; V11 wins: 3.

EventMind authority/input remediation is verified on exact behavior head:
`1b7b3c29d40a2f9f62f6cecd73df5affe35d38e6`

Implemented:
- `apps/api/src/ai/eventmind-v1.ts` is the only production-side EventMind input/decoder contract;
- EventMind consumes an already-normalized MailLens `NormalizedEmailDocumentV1`, never reparses raw provider body/HTML;
- input uses current `semanticText`, sender/subject/time, truncation/quote flags and bounded lifecycle structured hints;
- provider/thread ids, recipients, snippet, full body, raw HTML, raw headers/auth, folders, links, attachment metadata, raw archive refs, trace ids and internal Purchase candidate/id values are omitted;
- identity-bearing structured keys/URLs are removed while lifecycle status/state hints may remain;
- prompt explicitly denies Purchase create/link/merge/select/identify authority;
- fixed 18-event taxonomy is shared and locked;
- decoder accepts exactly `is_commerce` + `event_type`; any extra field invalidates the response;
- decoder rejects invalid event values and commerce/event incoherence;
- shared semantic overlay accepts/returns semantics + provenance only, never identity;
- legacy V9 semantic overlay remains backwards compatible through the shared contract;
- existing Purchase Identity Graph boundary remains authoritative: all order/tracking/invoice/payment/merchant/carrier identity stays deterministic, hard conflicts remain REVIEW/PENDING, and NEW_PURCHASE requires separate deterministic purchase-creation authority.

Regression coverage proves stale quoted history/snippet/raw/provider/archive/attachment/identity values cannot enter the EventMind contract, and attempted model identity output is rejected.

Protocol:
`protocols/EVENTMIND-AUDIT-2026-09-02.md`

Temporary CI-only PR #303 / GitHub Actions CI #1152, run `33632992124`, exact behavior head `1b7b3c29d40a2f9f62f6cecd73df5affe35d38e6`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #303 was closed unmerged after verification.

Status:
- **EventMind code contract / identity-authority remediation: PASS**
- **Production EventMind runtime: BLOCKED**

Production blockers before any Qwen enablement:
- actual V11 runtime must be wired only through `buildEventMindInputV1(...)` + `decodeEventMindPredictionV1(...)`;
- exact base model/tokenizer/template and adapter SHA-256 must be pinned; no mutable `LATEST.txt` authority;
- thinking must be explicitly disabled with no silent compatibility fallback;
- model unavailable/OOM/timeout/invalid output must fail closed with no semantic or identity authority escalation;
- a new untouched representation gate must validate the exact MailLens/EventMind V1 input because the already-used 180-case SemanticEmailView A/B is diagnostic only;
- observability must record model/adapter/contract versions, latency and failure/event metadata without raw private email bodies.

## DEPLOYMENT STATE

Still conservative:
- direct Gmail runtime OFF by default;
- source archive OFF by default;
- Mailgun source persistence OFF by default;
- EventMind/Qwen production runtime not wired/enabled;
- new migrations committed only, not applied live here;
- no Google OAuth credentials/archive secrets/customer raw email committed;
- no Purchase/Shipment/Document/Identity authority change.

## NEXT ACTION

1. Keep PR #295 draft and all live/source/AI flags OFF.
2. Controlled Gmail/RawVault staging smokes remain required before production source cutover.
3. Prepare the exact **V11 runtime integration + untouched MailLens/EventMind V1 representation gate** without consuming frozen evaluation data for tuning.
4. After EventMind runtime evidence is clean, continue module audit with **TrustLink**.
5. Do not promote V12; V11 remains the reference model unless new untouched evidence justifies a future version.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
