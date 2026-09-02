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

The RawVault audit found and remediated:
- source/user deletion could leave untracked Storage objects;
- retention metadata had no deletion worker;
- object upload before DB insert could leave crash/DB-failure orphans;
- deduped provider id did not verify raw-byte integrity;
- empty raw bytes were accepted;
- expired retention boundaries were accepted;
- normalized JSON had no separate retention;
- archive metadata was not DB-level immutable.

Behavior code head verified by CI:
`9480e6d4e8d5c3e0a771b43671503cda593971c2`

Current RawVault design:
- artifacts are fully prepared/hashes computed before writes;
- opaque durable `email_source_archive_manifests` row is staged before object writes;
- manifest contains no user id, provider message id, subject or body;
- raw + normalized object identities/hashes/retention are DB-immutable;
- separate raw and normalized retention boundaries;
- no retention duration is guessed: archive writes fail closed until both `BUYFLOW_EMAIL_SOURCE_RAW_RETENTION_DAYS` and `BUYFLOW_EMAIL_SOURCE_NORMALIZED_RETENTION_DAYS` are explicitly configured;
- empty raw and expired/invalid retention fail before object writes;
- duplicate provider message raw SHA mismatch fails closed;
- pending manifests survive source-insert failure and provide a crash-safe retry/cleanup journal;
- periodic maintenance heals commit races, deletes stale orphans, enforces raw/normalized retention independently, and removes archived objects after source/user deletion;
- object/hash identity remains in audit metadata while deletion timestamps record retention cleanup;
- bucket remains private and archive remains OFF by default.

Migration:
`supabase/migrations/20260902115500_harden_email_source_archive_v1.sql`

Protocol:
`protocols/RAWVAULT-AUDIT-REMEDIATION-2026-09-02.md`

Temporary CI-only PR #296 / CI #1147 on exact behavior head `9480e6d4e8d5c3e0a771b43671503cda593971c2`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #296 was closed unmerged after verification.

Status:
- **RawVault code audit remediation: PASS**
- **Production RawVault: BLOCKED** until controlled staging migration + explicit retention policy + real private-storage retention/orphan smoke.

## MAILLENS AUDIT

Role: the single provider-neutral evidence normalization boundary between MailGate/RawVault and every downstream deterministic/semantic/EventMind consumer. It may normalize representation but may not invent lifecycle or identity facts.

Audit protocol:
`protocols/MAILLENS-AUDIT-2026-09-02.md`

Current verdict:
- **MailLens code: BLOCKED pending remediation**
- production remains blocked; all relevant live/source flags stay OFF.

Blockers found:
1. `normalizeEmailDocumentV1()` is currently produced by the archive path, while deterministic parsing/universal grammar run earlier and directly from `NormalizedEmail`; therefore MailLens is not actually the single canonical downstream representation.
2. `normalizedEmailToDeterministicInput()` and the older `buildEmailDocumentV1()` use HTML when present, otherwise Gmail/provider `snippet`; they ignore full `bodyText` in the plain-text-only case. This can reduce a real commerce email to a snippet and can cause the direct-Gmail privacy candidate gate to drop a legitimate message before persistence.
3. Gmail MIME body collection recursively treats every nested `text/plain`/`text/html` part as message body even when it is a real attachment/nested message, allowing attachment content to contaminate lifecycle semantics.
4. Regex-based HTML text conversion does not separate hidden/preheader content or quoted/replied history from current visible content, so stale/hidden lifecycle text can be given equal semantic weight.
5. DKIM/SPF/DMARC normalization reads arbitrary `Authentication-Results`/ARC headers without binding them to a trusted provider/authserv-id provenance, so those verdicts are not safe hard trust evidence.

Additional required hardening:
- complete HTML entity decoding with bounded parser semantics;
- explicit truncation/provenance metadata instead of silent first-N character slicing;
- actual microdata property/value extraction rather than itemtype-only records;
- bounded/iterative JSON-LD audit traversal and provenance-aware compatibility parsing;
- dedicated adversarial tests for links/auth/hidden content/plain-text-only/attachments/deep structured data.

## DEPLOYMENT STATE

Still conservative:
- direct Gmail runtime OFF by default;
- source archive OFF by default;
- Mailgun source persistence OFF by default;
- new migrations committed only, not applied live here;
- no Google OAuth credentials/archive secrets/customer raw email committed;
- no Purchase/Shipment/Document/Identity authority change.

## NEXT ACTION

1. Keep PR #295 draft and all live flags OFF.
2. Controlled Gmail/RawVault staging smokes remain required before any production cutover.
3. Remediate MailLens blockers, make one canonical document feed candidate gating + deterministic/universal semantics + future EventMind, add regression tests, then run exact-head CI.
4. Only after MailLens code PASS continue to **EventMind** audit.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
