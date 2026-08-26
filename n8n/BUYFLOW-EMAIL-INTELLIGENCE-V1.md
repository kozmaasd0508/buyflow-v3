# BuyFlow n8n Email Intelligence v1 — Shadow

This design combines the strongest reusable patterns from n8n templates #9689, #5496 and #16181.

## Architecture

Gmail Trigger → Normalize Email → Dedupe → deterministic commerce prefilter → GPT-5.6 Luna structured extraction → fallback gate → GPT-5.6 Sol only for ambiguous/incomplete cases → deterministic payload validation → optional BuyFlow SHADOW webhook → mark processed.

## Critical boundary

AI does not decide Purchase CREATE/LINK/merge. Those decisions remain inside the BuyFlow Identity Graph. n8n is orchestration and AI is evidence extraction only.

## Default safety

- shadow sending disabled by default
- 0 production writes
- OpenAI Responses API requests use `store=false`
- identifiers must be explicitly evidenced
- future shipment intent is not a shipment event
- policy/disclaimer text is not a cancellation/refund event
- ambiguity is preserved rather than guessed
- unresolved/low-confidence extraction escalates from Luna to Sol
- the final Identity Graph remains fail-closed

## Reused ideas

### n8n #9689

Gmail monitoring, lifecycle-oriented commerce extraction, structured output and multi-vendor handling. The template's AI-controlled database CREATE/UPDATE logic is deliberately not reused.

### n8n #5496

Idempotency/dedup before repeated AI processing. The v1 workflow uses a local n8n static-data dedup cache only as a temporary shadow mechanism; production idempotency must live in BuyFlow.

### n8n #16181

Explicit validation after extraction and before posting structured data to an HTTP endpoint.

## Models

Primary: `gpt-5.6-luna` with low reasoning effort.

Fallback: `gpt-5.6-sol` with medium reasoning effort, only when the first pass is low-confidence, ambiguous, lacks evidence, or claims a hard event without a core identifier.

Both use JSON Schema Structured Outputs.

## BuyFlow handoff

The current workflow is intentionally shadow-only. Do not enable its HTTP handoff until BuyFlow has a dedicated, authenticated n8n shadow-ingress endpoint that performs 0 production writes. After that endpoint exists, the exact same payload can be replayed through the current Identity Graph for CREATE/LINK/REVIEW measurement.

## Privacy

For self-hosted n8n, raw email execution data should not be retained longer than necessary. Credentials must remain in n8n's credential store and must never be embedded into exported workflow JSON.