# BuyFlow MailGate — Direct Gmail audit remediation

Date: 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`
PR: #295 (draft)

## Audit contract

MailGate is source acquisition only. It may connect/read provider mail, preserve source evidence, protect the privacy boundary, and advance provider cursors only after safe source handling. It must not grant Purchase/Identity authority, invent missing evidence, silently skip matching source messages, or depend on Pub/Sub as the sole durability mechanism.

## Findings remediated

### 1. Partial initial snapshot could skip pre-existing messages

Before: durable initial sync could stop after the requested limit and still commit the captured Gmail history cursor. Older matching messages that already existed before that cursor would never appear in later `history.list` replay.

Now:
- `InitialEmailSyncInput.completeSnapshot` explicitly separates bounded smoke sampling from durable initial synchronization;
- `GmailRuntimeProvider.readInitialSync(...)` forces `completeSnapshot: true`;
- durable initial sync exhausts all pages for the discovery query before cursor commit;
- pagination/message safety ceilings fail closed without advancing the cursor.

### 2. Large text/html or text/plain MIME body behind attachmentId could be lost

Before: body normalization only read inline `body.data`.

Now:
- `messages.get?format=full` is inspected for detached text body parts;
- `attachments.get` hydrates those text parts before normalization;
- detached body storage is not misreported as a user attachment;
- regression coverage proves detached body text reaches `bodyText`.

### 3. Invalid/missing Gmail internalDate fabricated 1970 timestamp

Before: invalid/missing `internalDate` became `1970-01-01T00:00:00.000Z`.

Now:
- valid Gmail `internalDate` remains primary;
- a valid RFC-style `Date` header is a fallback;
- if neither is valid, normalization fails closed;
- no synthetic 1970 evidence is created.

### 4. Gmail API transient errors and burst fan-out

Now:
- retryable 408/429/5xx responses and network failures use bounded retry delays;
- `Retry-After` is honored within a bounded maximum;
- full-message fetch fan-out is concurrency-bounded instead of one unbounded `Promise.all` for an entire page.

### 5. Expired history cursor could leave synchronization stuck

Before: `reset_required` was marked, but normal runtime needed a separate manual initial sync.

Now:
- `runDirectGmailIncrementalSync(...)` automatically performs a new complete initial snapshot after an expired history cursor;
- dedupe remains keyed downstream by provider message id;
- stale cursor is replaced only after the recovery snapshot is safely handled and CAS-committed;
- summary records `resetRecovered`.

### 6. Watch renewal was available but not automatic

Now:
- `gmail-direct-maintenance.ts` scans Gmail source state and renews missing/expiring watches before expiry;
- operational scheduler runs maintenance periodically while direct Gmail runtime is enabled;
- watch renewal failures do not disable fallback cursor synchronization.

### 7. Missed Pub/Sub push had no independent fallback sync

Now:
- periodic maintenance resumes from the durable DB cursor even when no push arrived;
- Pub/Sub remains only the low-latency wake-up path;
- existing durable push inbox/retry/dead-letter behavior remains unchanged.

### 8. Extra Gmail OAuth authority was not fully rejected

Before: runtime required `gmail.readonly` to be present but did not reject every additional Gmail authority.

Now:
- `gmail.readonly` is mandatory;
- extra `gmail.*` authority and the broad `https://mail.google.com/` scope are rejected;
- OAuth stays PKCE + offline refresh-token based.

## Verification

Exact behavior code head:
`e67b908e07d072e3737611eca4ee804d7d905c26`

Temporary CI-only PR #296 / GitHub Actions CI #1142:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

New/updated regressions cover:
- complete initial pagination despite a small page size;
- detached text-body hydration;
- timestamp fallback/fail-closed behavior;
- retryable Gmail API response;
- extra Gmail OAuth authority rejection.

## Safety state

Unchanged:
- `BUYFLOW_GMAIL_DIRECT_RUNTIME_ENABLED=false` by default;
- source archive OFF by default;
- no production provider cutover;
- no live migration application from this flow;
- Purchase/Shipment/Document writes remain zero in the direct-Gmail source lane;
- AI identity authority remains zero;
- Pub/Sub notification data remains wake-up metadata only.

## Remaining gate before MailGate PASS

Code-level blockers from this audit are remediated and CI-green. Full MailGate PASS still requires a controlled real-Gmail shadow smoke against the exact source runtime with:
- bounded sample read;
- exact RAW MIME available for every sampled message;
- detached/normal body parity checked on real messages where present;
- valid initial cursor capture;
- `history.list` replay;
- privacy-reduced output only;
- 0 source persistence/archive for the read-only smoke;
- 0 Purchase/Shipment/Document writes;
- 0 AI calls;
- 0 mailbox mutations.

Production remains BLOCKED until that controlled shadow gate is green.
