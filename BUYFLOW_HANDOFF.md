# BuyFlow V3 — persistent handoff

> Current-state snapshot for a new AI/chat. Read `AGENTS.md`, then this file, then `BUYFLOW_WORKLOG_LATEST.md` / `BUYFLOW_WORKLOG.md`. Reconcile with current GitHub state before changing runtime code.

**Last updated:** 2026-08-31 Europe/Budapest  
**Repository:** `kozmaasd0508/buyflow-v3`  
**Current `main`:** `92461ac103d4e337baa69ef91d09717eeb488d00`  
**Architecture base:** `codex/v9-real-gmail-identity-shadow` @ `2e05b435a9f4fbc6467477c02fac462004bfa183`  
**Extension branch:** `codex/modern-email-source-foundation-v1`  
**Extension PR:** #295 (draft) -> `codex/v9-real-gmail-identity-shadow`  
**Implementation head before this handoff commit:** `9391fbe9ddb4c16bf65656303cba5a020e9e07dd`

## CURRENT SAFETY CONTRACT

Safety remains unchanged:
- AI/V9 may provide lifecycle semantics only, never hard identity.
- lifecycle-only mail cannot create Purchase.
- hard conflicts -> REVIEW/PENDING.
- wrong auto-link / false Purchase create tolerance = 0.
- direct Gmail runtime defaults OFF.
- source archive defaults OFF.
- Mailgun source persistence defaults OFF.
- no modern email-source/direct-Gmail migration has been applied live.
- no new provider has been cut over into production.
- no raw customer email content is committed to Git.
- Pub/Sub/OAuth/Gmail source state never grants Purchase identity authority.

## PURCHASE IDENTITY GRAPH V2 ALREADY EXISTS

Use/extend the existing `CanonicalEvent`, Purchase/Order/Shipment/Payment/Invoice identities, `EvidenceEdge`, `CorrelationDecision`, merchant identity and parent/child relation types. Do not build duplicate parallel graph concepts.

## MODERN EMAIL SOURCE FOUNDATION V1

PR #295 contains:
- `NormalizedEmailDocumentV1` with provider full text + HTML + headers + attachment metadata;
- bounded JSON-LD/schema.org extraction before AI;
- safe HTTP(S) link extraction;
- fail-closed DKIM/SPF/DMARC normalization;
- immutable raw + normalized object archive with SHA-256;
- opaque content-addressed object paths;
- deterministic trace id;
- retry-safe immutable-object verification;
- additive `source_emails` metadata migration + private `buyflow-email-source-v1` bucket;
- archive flag `BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED=false` by default.

The generic normalized inbound pipeline may store source/provenance when deliberately enabled, but its Purchase/Shipment/Document/AI write counters remain zero.

## DIRECT GMAIL PROVIDER + OAUTH RUNTIME

`GmailIncrementalEmailProvider` now has a server runtime behind `BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED=false`.

Provider support:
- Gmail search + full message fetch;
- full provider text/HTML/headers/attachment metadata;
- exact RAW MIME (`format=raw`);
- attachment bytes;
- initial `historyId` captured before snapshot scan;
- `history.list` created/updated/deleted replay;
- expired history -> `resetRequired=true`, no guessed continuation;
- Pub/Sub watch / renew / stop.

OAuth/runtime security:
- Google OAuth Authorization Code + PKCE;
- required scope is exactly Gmail read-only authority (`gmail.readonly` must be present; unexpected extra Gmail scopes are rejected by the runtime boundary);
- refresh token encrypted with AES-256-GCM;
- encryption AAD binds credential to user + connection + provider + key version;
- encrypted credential table is server-only with RLS and no authenticated-client grant;
- provider cursor/watch state is stored separately from Purchase identity state;
- cursor commit uses compare-and-swap so a stale worker cannot overwrite a newer Gmail cursor.

## DIRECT GMAIL PERSONAL-MAILBOX PRIVACY GATE

Direct Gmail intentionally does NOT rely exclusively on `category:purchases`.

Default direct Gmail discovery query:
`newer_than:30d -in:spam -in:trash`

The broad provider read is followed by a positive-commerce gate. A personal Gmail message is persisted only when at least one supported positive signal exists, for example:
- Gmail `CATEGORY_PURCHASES`, OR
- transactional schema.org markup such as Order / ParcelDelivery / Invoice, OR
- deterministic commerce recognition, OR
- universal commerce lifecycle semantics.

Unknown personal mail is ignored before DB/archive persistence. Product/Offer-only markup is insufficient by itself. Strong promotional mail remains ignored.

## AUTHENTICATED GMAIL PUB/SUB WAKE-UP PATH

`POST /webhooks/google/gmail` is a wake-up endpoint, not an evidence endpoint.

Security and durability:
- Google Pub/Sub OIDC bearer JWT verified locally using Google JWKS;
- only RS256 accepted;
- issuer, audience, expiry/not-before/issued-at and exact configured Google service-account email are checked;
- malformed/oversized payloads fail closed;
- payload contributes only `emailAddress + historyId` wake-up metadata;
- durable `gmail_sync_inbox` dedupes `(email_connection_id, history_id)`;
- safe claim/retry/stale-processing recovery;
- explicit exponential retry schedule;
- `dead_letter` after 8 failed attempts;
- 60-second recovery drain covers crash-after-Pub/Sub-ack cases;
- worker resumes from the DB-committed Gmail cursor, not from the Pub/Sub history id directly.

## CONTROLLED DIRECT-GMAIL SHADOW SMOKE

New command:
`npm run gmail:direct-shadow-smoke --workspace @buyflow/api`

Required controlled environment:
- `BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED=true`
- Google OAuth client configuration
- `BUYFLOW_EMAIL_CREDENTIALS_KEY_BASE64`
- Supabase admin configuration
- a pre-connected direct Gmail test account selected by `BUYFLOW_SMOKE_USER_ID` + `BUYFLOW_SMOKE_CONNECTION_ID`
- optional `BUYFLOW_GMAIL_SHADOW_SMOKE_LIMIT` (default 10, hard max 50)

The smoke is deliberately read-only:
- reads a small Gmail sample using `GMAIL_DIRECT_DISCOVERY_QUERY`;
- fetches exact RAW MIME for each sampled message;
- evaluates the personal-mailbox commerce privacy gate;
- exercises `history.list` from the captured boundary;
- prints only privacy-reduced counters/reasons;
- does NOT persist `source_emails`;
- does NOT write archive objects;
- does NOT commit the durable Gmail cursor;
- does NOT mutate the mailbox;
- does NOT write Purchase/Shipment/Document state;
- does NOT call AI.

This means the first live Google smoke can be run before enabling source archive or any Purchase-side behavior.

## MAILGUN EXACT EML SOURCE PATH

The existing Mailgun shadow route preserves full plain text and can pass an expanded forwarded `.eml` attachment's exact bytes into the immutable archive path.

Two independent gates remain OFF by default:
- `BUYFLOW_EMAIL_SOURCE_ARCHIVE_ENABLED=false`
- `BUYFLOW_MAILGUN_SOURCE_PERSIST_ENABLED=false`

Only when both are deliberately enabled may Mailgun source persistence/archive run. Purchase/Shipment/Document writes remain disabled.

## DATABASE / DEPLOYMENT STATE

Committed migrations include:
- modern raw/normalized source archive metadata + private bucket;
- direct Gmail OAuth credential state;
- direct Gmail cursor/watch state;
- durable Gmail Pub/Sub sync inbox.

These migrations are code-reviewed artifacts only at this point and have NOT been applied live from this development flow.

No Google OAuth client secret, refresh token, AES key, Pub/Sub service-account credential or customer raw mail exists in the repository.

## VERIFICATION

Historical checkpoints:
- CI #1092: rich normalizer/source archive GREEN.
- CI #1095: Gmail incremental provider GREEN.
- CI #1099: Mailgun exact EML/source wiring GREEN.
- CI #1132 on code head `30bd9baaf64bd5f2660ee223f1d54ed8994a49db`: API typecheck/tests/build + mobile typecheck/build all GREEN.

After the new shadow-smoke + handoff/worklog commits, run one final exact-head CI before claiming the entire current PR head green. Temporary PR #296 is CI-only and must be closed unmerged after verification.

## NEXT ACTION

1. Run final exact-head CI for the current branch.
2. Keep live flags OFF.
3. In a controlled staging/test Supabase project, review/apply only the additive direct-Gmail/source-state migrations needed for a shadow account.
4. Configure one Google OAuth test client + one dedicated test Gmail account + encrypted credential key.
5. Run `gmail:direct-shadow-smoke` and require: RAW parity for every sample, valid captured cursor, history replay without guessed continuation, 0 persistent source writes, 0 Purchase/Shipment/Document writes, 0 AI calls.
6. Only after that smoke is green consider enabling source persistence/archive for the single controlled shadow account; Purchase/Identity authority still remains unchanged.

## RESUME CONTRACT

**Folytasd a BuyFlowot a GitHubból.**
