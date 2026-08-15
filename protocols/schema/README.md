# Protocol schema

Runtime types and validation live in `apps/api/src/protocols/`.

Profiles must use stable `protocol_id` values, semantic versions, explicit source references, event-specific positive rules, hard-negative rules where appropriate, identifier extraction patterns, confidence, and prohibitions.

A future JSON-schema export may be generated from the runtime contract, but the TypeScript contract is authoritative in Foundation V1 to avoid maintaining two divergent schemas by hand.
