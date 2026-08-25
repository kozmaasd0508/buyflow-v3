# Post-fix Blind E2E Identity v2 — frozen sample

Date: 2026-08-25
Mode: blind, read-only evaluation
Production writes: 0
AI calls: 0

## Frozen code snapshot

Recognition/correlation code was frozen before candidate message contents were opened.

- PR: #265
- code SHA before freeze: `83837066f35ab186c30f93273cf8cb8cb81e7f32`
- branch: `codex/purchase-identity-graph-v2-universal-namespace`

## Candidate selection

Gmail ID-only search was executed before any message body/subject inspection for this round.

Query:

`{rendelés megrendelés order} after:2025/01/01 before:2025/06/01 -in:spam -in:trash -from:me`

Candidate count: **68**

Raw Gmail message IDs are intentionally not committed. The following SHA-256 prefixes freeze membership and order only:

```text
aafbad00f350f1a7
f324e6352a932cca
f8f3493aa78528df
4b0daebe263aa966
918582a54c56a4e7
3b111546a7bc45ea
2222bffd96dfa9a6
bea8a19a5c2e2859
4ac385750a4005e9
610fdde9584c6989
f506f5d9d5d63a97
6b1a8d1ec558f4f2
54e536e6a057d6af
6b0460635968d823
26fdb579b38e8b03
d3843fd549a1df85
478aef2c58842455
f35f96cdb46a9229
6a982eedb65c8ad4
d780f032378841f3
9b6346627eafb65f
254a3341d99fd5cc
64a7baefda793cbf
676e4a47ae088a85
4d23684b7ba61a1f
bca370c11b77b8a3
d3b298837e153346
3007a4824996f0f6
283cb5443e81cca7
7ba961586462a650
e2d3485071f07664
b1376632c3d74e99
a492c86e85cfe952
5d31c1ffff048e06
5a4cf8cc4c688225
e9d117513e733c03
ff07060bd148f9f2
14f8f1fd90ac1193
5644d86cfcad570e
6b0c5dbce1dd287d
de07dd33da089fe7
4b9fb68522514dd0
6162d7aed129dd71
61fe6f98d68599ab
345d0821d071ac1a
8c3b527f604a246f
d747e7790df1db48
5ff29bac2ed934ee
27ce16a70399a1b5
1e7b6986f8a6ae6b
20892a6808edf05f
48c302444235b932
a815d251868ed076
9b796539c36c5c08
059e3661d3471748
1b39c0b4898cc1bb
1b7380ade95a60bb
12547c78abb2107b
c9825ab72cc39885
3ca9f5884d7a8eed
f170abf1f2ee5d37
450cac1e76748ebb
760337a6198b24c7
4c77fc36976754ef
3e889785b05e55ee
57c0d770f415ed91
a8027650c076bc70
9b4abfe80d8deeb5
```

## Evaluation rule

No recognition/correlation rule may change before the first score is recorded.

Primary success criterion:

1. real order anchor is safe enough to create a Purchase,
2. later lifecycle/document event from the same unknown merchant links to that exact Purchase,
3. same order number in another merchant namespace must not cross-link,
4. ambiguity/conflict remains REVIEW/PENDING,
5. zero wrong automatic links.

Known merchant-specific profiles/adapters may be observed but do not count toward the unknown-shop headline result.
