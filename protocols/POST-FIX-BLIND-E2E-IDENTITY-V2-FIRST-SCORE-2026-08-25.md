# Post-fix Blind E2E Identity v2 — FIRST SCORE

Date: 2026-08-25
Frozen recognition/correlation snapshot: `83837066f35ab186c30f93273cf8cb8cb81e7f32`
Mode: blind manual replay / code inspection
Production writes: 0
AI calls: 0

> This is a small frozen challenge result, **not production-wide accuracy**. The first score is intentionally permanent and must not be rewritten after fixes.

## Headline — unknown merchant eligible chains

After excluding merchants/templates already represented by dedicated/researched profiles and excluding cases that correctly fail Purchase-creation authority, the frozen sample produced **3 eligible, previously unrepresented merchant chains** with enough independent commerce structure for a Purchase anchor and a later related event.

| Case | Ground truth | Frozen v2 result | Safety |
|---|---|---|---|
| Kávégép Bolt | order confirmation -> later processing status | SAFE MISS | no wrong merge |
| LibAirator | order confirmation -> carrier-handoff status | SAFE MISS | no wrong merge |
| Konyhaluxnet | order received -> later cancellation | SAFE MISS | no wrong merge |

### First score

- eligible unknown-merchant chains: **3**
- complete automatic E2E Purchase create + later exact link: **0 / 3**
- safe misses / REVIEW-or-unlinked: **3 / 3**
- wrong automatic links: **0**
- unsafe cross-merchant merges: **0**

## Why the three eligible chains missed

### 1. Decorated order identity
One merchant uses the plain order identity in the confirmation and a merchant-decorated form in the later status mail. The current stable identifier normalizer correctly refuses to assume these are identical. This protects precision but loses recall.

**Required direction:** a generic merchant-scoped decorated-ID *candidate* must be REVIEW-only unless a separate hard bridge proves equivalence. Never strip arbitrary prefixes globally.

### 2. Generic carrier-handoff wording gap
One later lifecycle message states a carrier handoff in the form equivalent to “handed to courier service”, but the frozen universal event extractor does not cover this word order/form strongly enough.

**Required direction:** extend the semantic handoff grammar generically, with completed-vs-future semantics preserved. This is a recognition gap, not an Identity Graph merge gap.

### 3. Generic order-received wording gap
One real order anchor uses wording equivalent to “we successfully recorded/took your order” rather than the currently-covered received/confirmed phrases. The frozen event extractor can miss the order-created event even though order number, merchant source and commerce structure are present.

**Required direction:** add generic semantic RECEIVE/RECORD order wording, not a merchant-specific template.

## Safety-gated controls

Two additional previously unrepresented merchant examples were deliberately **not** counted as eligible positive chains:

- KomPhone: the automatic acknowledgement explicitly says it does not mean the contract has been formed -> Purchase creation must remain REVIEW.
- Sportisimo: the message says the order will only be finally confirmed later -> Purchase creation must remain conservative/REVIEW.

These are **safety passes**, not misses.

## Decision

The unknown-merchant namespace correlation design did **not** produce a wrong merge in this frozen challenge. The next work should therefore improve universal semantic coverage and REVIEW routing without weakening exact identity safety:

1. generic completed carrier-handoff grammar,
2. generic order-recorded/received grammar,
3. merchant-scoped decorated order-ID discovery as REVIEW-only evidence,
4. rerun a new blind holdout after CI, never rescore this first result.
