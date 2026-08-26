# Phase C fresh blind availability check — 2026-08-25

## Frozen code snapshot

`7f3f63b3d26adcf655e0f057f0aa7c7d55fac09b`

CI #1002 on this code snapshot: API typecheck/tests/build + mobile typecheck/web build PASS.

## Goal

Find genuinely unseen real Gmail messages that explicitly describe a parent/child, split-order, or replacement-order relationship, without using their contents to modify the extractor first.

## Method

1. Freeze the Phase C code snapshot above.
2. Search Gmail IDs only before opening message contents.
3. Check exact explicit-relation language separately.
4. Do not store Gmail message IDs, recipient data, or private email contents in the repository.

## Availability result

Exact searches for the following relation language produced **0 eligible messages**:

- `eredeti rendelés`
- `csere rendelés`
- `részrendelés`
- `replacement order`

A broader `rendelés + csere` ID-only search produced candidates, and a fixed 12-message subset was inspected only after selection. Those messages were ordinary order/processing or unrelated emails; **0/12 contained an explicit parent/child, split-order, or replacement-order relation**.

## Decision

This is **not an accuracy PASS and not an accuracy FAIL**. There was no eligible real-world Phase C relation case to score.

Therefore:

- no blind accuracy percentage is claimed;
- no parser/extractor rule is changed from these inspected messages;
- the Phase C PR remains draft;
- merge should wait for at least one genuinely eligible real relation example or another independently sourced blind fixture that was not used to build the extractor.

## Safety status

The code-level regression gate remains green and fail-closed:

- no fuzzy parent/child inference;
- missing/ambiguous parent cannot create or merge a Purchase;
- conflicting explicit parents become hard conflict/PENDING;
- child identity already owned by another Purchase blocks mutation;
- 0 AI;
- productionWrites=0.
