# MailLens audit + remediation — 2026-09-02

Branch: `codex/modern-email-source-foundation-v1`  
Architecture PR: #295 draft -> `codex/v9-real-gmail-identity-shadow`

## Role

MailLens is the provider-neutral evidence normalization boundary between MailGate/RawVault and downstream deterministic/semantic/EventMind consumers. It may normalize representation, but it must never invent lifecycle or identity facts.

Required properties:
- one canonical normalization contract for candidate gating, deterministic parsing, universal semantics, archive provenance and future EventMind input;
- preserve provider plain text and HTML separately;
- produce a bounded current semantic text view with explicit provenance/truncation state;
- keep hidden/preheader/quoted-history source evidence without silently giving it equal current-state weight;
- never treat a real attachment as authored message body;
- structured-data/link/authentication extraction must be bounded, provenance-aware and fail closed;
- zero Purchase/Identity authority.

## Initial blockers found

The initial audit found:
1. `normalizeEmailDocumentV1()` existed mainly in the archive path while deterministic/universal consumers independently rebuilt their own text view.
2. Plain-text-only mail could lose the full body because some consumers used HTML when present and otherwise `snippet`, ignoring `bodyText`.
3. Gmail recursive MIME handling could treat `text/plain` / `text/html` attachments as authored body.
4. Hidden/preheader and quoted-history text was not separated from current semantic text.
5. Raw `Authentication-Results`/ARC headers could be parsed without trusted authserv-id provenance.
6. Truncation/provenance was implicit; JSON-LD audit traversal needed explicit bounds; compatibility entity decoding lacked provenance.

## Remediation

Exact behavior head verified by CI:
`f69195404831323f2783464a61f6f7b7435698b5`

Implemented:
- `NormalizedEmailDocumentV1` now carries both bounded full `bodyText` and a separate `semanticText` current-view field;
- explicit normalization metadata records body source, body/semantic truncation, hidden-HTML removal and quoted-history detection;
- normalizer version advanced to `normalized-email-document-v1.1`;
- provider plain text is preferred when supplied; HTML rendering is fallback; snippet is last-resort fallback only;
- deterministic input, legacy `EmailDocumentV1`, direct-Gmail privacy candidate gating, normalized inbound planning/universal grammar and diagnostic identity shadow are routed through the MailLens semantic view;
- raw HTML remains preserved in the MailLens/archive document, while legacy semantic consumers receive semantic text without raw HTML so they cannot bypass MailLens hidden/quote handling;
- common hidden email/preheader forms (`hidden`, `aria-hidden=true`, inline `display:none`, `visibility:hidden`, `mso-hide:all`) are removed from derived semantic text while source HTML remains preserved;
- strong quoted/replied-history boundaries produce a current semantic prefix while complete bounded body evidence remains stored separately;
- Gmail MIME body selection now excludes named and `Content-Disposition: attachment` text/HTML parts; detached real body parts behind `attachmentId` continue to hydrate correctly;
- raw authentication headers remain parseable diagnostics, but every MailLens header-derived result is explicitly `trusted:false` with source provenance and therefore cannot be hard trust evidence;
- archive diagnostics now preserve that auth trust/source flag instead of surfacing an unqualified `pass`;
- JSON-LD traversal is iterative and bounded by node/depth limits;
- JSON-LD is parsed raw first; entity-decoded compatibility parsing is only fallback and is explicitly provenance-tagged (`raw_json` vs `html_entity_compat`);
- microdata itemtype is explicitly tagged `microdata_type_hint` with `fieldEvidence:false`, so type-only markup cannot masquerade as extracted order/tracking field evidence;
- link extraction and structured markup gained numeric entity handling and bounded traversal behavior.

## Regression coverage

Added/updated tests cover:
- full plain-text body beats a stale/short snippet;
- direct-Gmail privacy gate can observe commerce proved only in the full plain-text body;
- hidden stale HTML preheader remains in source HTML but is absent from semantic text;
- quoted old history remains in full body evidence but is excluded from current semantic text;
- truncation is explicitly flagged;
- named text attachment stays an attachment and cannot inject lifecycle text into the message body;
- detached real Gmail body parts still hydrate;
- raw auth `pass` remains `trusted:false`;
- conflicting auth verdicts collapse to `unknown`;
- Received-SPF fallback retains explicit provenance;
- raw JSON-LD is preferred over compatibility decoding;
- compatibility-decoded JSON-LD is provenance-tagged;
- deep JSON-LD audit is bounded/non-recursive;
- microdata type-only records are explicitly non-field evidence.

## CI evidence

Temporary CI-only PR #296 / GitHub Actions CI #1151, run `33631564933`, exact behavior head `f69195404831323f2783464a61f6f7b7435698b5`:
- API typecheck PASS
- API tests PASS
- API build PASS
- mobile typecheck PASS
- mobile web build PASS

PR #296 was closed unmerged after verification.

## Deliberate limitations / fail-closed behavior

- MailLens does not claim that arbitrary CSS/HTML can be perfectly rendered without a browser. Raw HTML is preserved, and current semantic text uses bounded conservative heuristics; ambiguous representation must not become identity authority.
- Type-only microdata is not promoted to field evidence. A later parser may add bounded `itemprop` extraction, but until then it remains a schema hint only.
- Header-derived DKIM/SPF/DMARC remains diagnostic-only. Trusted gateway/provider authentication must enter through an explicitly provenance-bound channel before it can ever be used as hard trust evidence.
- MailLens may classify/normalize source representation only; it has no Purchase/Shipment/Document/Identity write authority.

## Safety / deployment state

Unchanged:
- direct Gmail runtime OFF by default;
- RawVault/source archive OFF by default;
- Mailgun source persistence OFF by default;
- no source migrations applied live from this flow;
- no provider production cutover;
- no Purchase/Shipment/Document/Identity authority change;
- AI identity authority remains zero.

## Verdict

**MailLens code audit remediation: PASS.**

**Production source path: still BLOCKED** behind the existing controlled MailGate real-Gmail smoke, RawVault staging/private-storage/retention smoke and explicit source enablement gates.

Next module audit: **EventMind**.
