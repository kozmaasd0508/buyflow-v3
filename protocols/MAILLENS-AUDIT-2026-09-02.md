# MailLens audit — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

## Role

MailLens must be the single provider-neutral evidence normalization boundary between MailGate/RawVault and every downstream semantic/extraction consumer. It may normalize representation, but it must not invent lifecycle or identity facts.

Required properties:
- one canonical downstream document for deterministic parsing, semantic/EventMind classification and archive provenance;
- preserve full provider plain text and HTML separately;
- produce a bounded semantic/rendered text view with explicit provenance/truncation state;
- separate current/authored content from hidden/preheader/quoted-history content without deleting source evidence;
- never treat attachments as authored message body;
- structured-data/link/authentication extraction must be bounded, provenance-aware and fail closed;
- no Purchase/Identity authority.

## Audit verdict

**MailLens code: BLOCKED pending remediation.**

Production remains blocked as all related source/runtime flags are still OFF.

## Blockers

### 1. MailLens is not yet the canonical downstream representation

`planNormalizedInboundEmail()` runs deterministic parsing and universal grammar directly from `NormalizedEmail`. `normalizeEmailDocumentV1()` is currently created by the archive preparation path, after planning, and therefore may not run at all when source archive is disabled.

Consequence: the archived normalized document and the representation actually used for commerce semantics can differ. A future EventMind integration could drift again.

Required fix: normalize once before all semantic/extraction stages and make downstream consumers accept the canonical MailLens document (or one explicitly derived semantic view) rather than independently rebuilding text.

### 2. Full plain-text-only emails can lose their body downstream

Both `normalizedEmailToDeterministicInput()` and the older `buildEmailDocumentV1()` select HTML when present, otherwise `snippet`; they do not use `email.bodyText` in the no-HTML case.

Consequence: a real plain-text commerce email can be reduced to a short Gmail snippet. The direct-Gmail privacy candidate gate uses these consumers, so a legitimate commerce email that lacks Purchases label/schema/strong subject evidence can be dropped as `no_positive_commerce_evidence` before persistence.

Required fix: canonical MailLens semantic text must use complete provider plain text when available and only fall back to rendered HTML/snippet when appropriate.

### 3. Gmail text attachments can contaminate the message body

`collectBodyParts()` recursively appends every nested `text/plain` and `text/html` MIME part. It does not exclude parts with attachment disposition/filename, so an actual text/HTML attachment can be included in the authored email body while also being listed as an attachment.

Consequence: invoice text files, HTML attachments, forwarded/nested content or attacker-controlled attachments can alter lifecycle semantics.

Required fix: MIME/body selection must distinguish authored body alternatives from attachments/nested messages and preserve attachments separately.

### 4. Hidden/preheader and quoted-history HTML are not separated from visible current content

`htmlToCompactText()` is regex-based. It removes scripts/styles/comments but does not exclude hidden elements (`display:none`, `hidden`, `aria-hidden`, common email preheaders) and does not segment quoted/replied history.

Consequence: stale or intentionally hidden text can be presented to downstream logic as equal-weight current evidence. This is particularly dangerous for lifecycle transitions such as PROCESSING/PACKING/SHIPPED/DELIVERED.

Required fix: a dedicated email HTML normalizer must create explicit sections/provenance such as current-visible, hidden-preheader and quoted-history. Source HTML remains preserved.

### 5. Authentication verdicts are not bound to a trusted authentication service

`extractEmailAuthenticationResults()` accepts any `Authentication-Results` header (or ARC fallback) and collapses method tokens without validating a trusted `authserv-id`/provider provenance.

Consequence: an untrusted/injected header can theoretically upgrade a message to `dkim=pass`/`spf=pass`/`dmarc=pass` if no trusted provider result is present. These verdicts must never become hard trust evidence in this form.

Required fix: trusted provider/gateway authentication evidence must be passed explicitly with provenance; untrusted message headers remain raw evidence only or `unknown`.

## Additional fixes required

- `htmlToCompactText()` decodes only a small set of HTML entities; named/numeric entities common in non-English mail may remain encoded and degrade semantics.
- current semantic text truncation keeps only the first N characters and has no explicit `truncated` metadata; future consumers cannot distinguish complete from bounded evidence.
- structured microdata extraction records only `itemtype`, not `itemprop` values, so it cannot preserve actual order/tracking/etc. microdata evidence.
- JSON-LD audit recursively walks nested objects without an explicit depth/node budget; crafted deep structured data can cause reliability problems.
- JSON-LD source is entity-decoded before JSON parse; safer behavior is raw parse first, with any compatibility fallback recorded as derived/provenance-tagged normalization.
- link extraction and authentication normalization currently have no dedicated regression test files; add adversarial/bounds/provenance tests.

## Remediation direction

1. Introduce one canonical `MailLensDocumentV2`/equivalent semantic input contract.
2. Normalize exactly once before candidate gating, deterministic parsing, universal grammar and future EventMind.
3. Preserve `bodyText`, `bodyHtml`, snippet and raw reference separately; add explicit selected semantic text source + truncation state.
4. Replace regex-only HTML text conversion with a bounded email-aware parser/normalizer that handles hidden/preheader and quoted-history sections.
5. Correct Gmail MIME body/attachment selection.
6. Make authentication evidence provenance-bound and fail closed.
7. Harden structured data depth/size/provenance and extract useful microdata properties safely.
8. Add regression cases for plain-text-only commerce, hidden stale preheaders, quoted old state, text/HTML attachments, malformed/deep JSON-LD, HTML entities, auth-header spoofing and truncation.
9. Run exact-head CI and only then consider MailLens code PASS.

## Safety state

Unchanged:
- direct Gmail runtime OFF by default;
- RawVault/source archive OFF by default;
- no source migrations applied live from this flow;
- no provider production cutover;
- no Purchase/Shipment/Document/Identity authority change;
- AI identity authority remains zero.
