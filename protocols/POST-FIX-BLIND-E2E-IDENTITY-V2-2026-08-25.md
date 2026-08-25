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

## Candidate selection A

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

## Candidate selection B — supplemental unknown-shop hunt

After sample A was inspected and found to be dominated by Temu chains/promotional controls, no recognition/correlation code was changed. A second independent ID-only search was frozen before opening any result from this query.

Query:

`{subject:megrendelés subject:rendelés subject:order} -from:temu -from:expressone -from:posta -from:foxpost -from:gls -from:dpd -from:me -in:spam -in:trash`

Candidate count: **100** (first page)

SHA-256 prefixes:

```text
1c6af00db0d534fa
39db47b30d5fe251
2d0b9029da179df2
cfcee923a28bc720
0b297e86bf3ef099
83b0c1a879bfd808
c1906ee4d6e5ee57
83800d37626e3bad
75547982405eb11d
81da2d9cb99703f8
e0c751b6092ba0d6
54c760e6552fa2ca
c67c36e0f836f5af
db3218c33fbf8f32
77c850f278c939ce
14da3c258f8ddab0
7b5c39408153ca59
f02793b848a0c31b
207b768e79e953cf
bce2fec8b996fd21
7547fe79d826001b
88f96e420b16affd
d85467936509649b
ce0fe6316c0a1f34
3966121b7e5edde3
83d3eb5239cb9b4a
47fcd7575b16d40f
ec2790edc6b4d386
95a3da1fd37c8c77
f4592c6c1e164931
900a24373f99185d
0e3314f1de9dfbb5
22818676ca45de90
faa859b78fed99ae
2f1339ca5bd28ad3
6822db7094e0eb4a
5809c80cec2ad112
53b6f640e953bc68
c9df98b72526f701
b33ba52065ed6798
8592b821165acdaa
25d0c11a7aca86a1
bd0888719e932759
94d6cb12b5be0f48
3bfeaf43fc609fe4
39271ae9106398f3
f4f00ae5a8132d4c
60dec45c0d01463d
bcf6e5fec6387e26
31a353f26bbd6806
19c177e785340ed1
e5396c7ba68d5836
6261a9a1f037df2e
3732aa1fa2c0f879
dcaf25b56b7dde42
5d082f7d3787a84a
07f05d04fb235980
f5599fc8c96d3a84
1f6e8b7875c18bca
023bc0da8fbf6d32
74551acaf3176be9
80dd8e603d62f64a
e7c05bf1b7631b12
094d9a6b4f7b3f53
c08bf2d60075bcd9
a09e3b620afc3bd4
55ae65d058a7ac9a
1f838e5e7cbbb226
48fb2a2cc91fb744
ec1bddff331ab4fd
082bc07382283479
fbee1060ea9fc1e9
1187fc651caf720d
4697457fcb5e5263
bb09756027ae567b
6215bd8b54ccaa25
a14032771ab796ac
f2b9ba0ba342a6c4
2028b44a0385ffa7
b9c7908e9f7598a1
bbb3e433cfcf0bde
8a34fdd86f1f6dc0
c9f524d83a256516
4d6dfb0694fe4f3d
075bd1c594fca3bb
eb41ff43f5a8e5ba
3249964b754c54f8
fa975e1a3a733076
3f9570d0789abd6b
847ed91d628e6e28
2cea5444424bc485
72f652604a3fa741
6f05a62f5cee04d7
363080550922873c
23d5b7d8a291d218
85a9047d3b913f1e
6286333346a7fea8
388bdb07d21e3683
bb53c3561982f97f
1feae8b2e7c3922e
```

## Candidate selection C — second page of the same subject query

No recognition/correlation code changed after inspecting selection B. The second page was fetched ID-only and frozen before opening any message from it.

Pagination token used: `04703933897912975387`
Candidate count: **100**
Next token was available but is outside this frozen selection.

SHA-256 prefixes:

```text
4d8bc92cd8f0c39e
05555dd6fe2f9f0d
87bf90b4f551a559
1b340fd8ab9ae4f2
cc752cd3802c1376
58493d6e26b79e22
b4aab143382c566b
1f54312341b1da6f
7e639887e2d31da7
def859e9556ef06f
e6b384767cf838d7
85bfcabe154bdc93
4a7b1b70a73bf30c
3696e2cb8ba2ea7e
e9a7c730b16bba9e
cb59bbc69f1bf7ff
eae0cd316b5e90be
5a7df5f8cbcba394
441948423a6e2560
ce9394ceb305f336
7d93a1bebddb89d1
81acf80c4faa7dbe
543f4b9b145ba384
34b532dbd86a69a1
822cbebd1295e38b
0dcaa4b7a9186476
b5d25dab4b764404
64aea163fdf3fba3
d0a080db1ff7c891
277a122d27076489
5abd14f21befc7f7
8c3e4d7a0f53dbea
9a365bdae96ce899
1142cbbf212cd3ca
6248dec1bc845a29
5470d3b60c69a8a7
254b51d6405602c4
06ca143f38e62e3d
93e07e702d48055b
3beb421d102d119a
ef8ee9c775ea1d56
1b1a8169e2212e3d
87d0636613f33657
1e7476f02da96325
0d704bab2414bbdb
cc92a23589a92917
9726f43cf44706da
91453637e0f321d4
58dc55c5205ea6e8
caa5122334d2ae88
825c1165d57e2673
44d2c12bf65883d9
bf3bb9b3fe3905cd
9e11bd44da9d9c01
120ffcfb91dbaed2
14421fc4b08aff4a
5c9dc73321426e58
35863d7e24bd8aef
0890ea6e1cb317e3
1e51c79350ba78ba
2ef955a1d4a5ea00
0e59af8a3673173d
35c12b4d26c93e5c
b988842916ab93db
39af2cae8fee7852
0d5cc6f9e5b5ff3c
a2034e79e5ac52b0
03b5778e86b10188
74b0424e9bd862a1
dfce386b2c6a26d1
ace47b7782122fea
61eb5a3a44c345d5
15dce25de008f8ce
c2d1b97060d7894f
760018e5568a146e
51acd5c733dcec4d
31eaf1e52a36c3d7
66fe1c43637b9fff
7a28edc6ce71f07f
3d78f49e318ed92a
cf48ff98a00ee744
225a8e0c5f844e7b
73dbe452c2fa3e05
a1f81805fb151de6
d8f7b92a776b6ab2
f3603823ecedd8e0
9faf110cc9d6928e
5ede8173a7e29e95
c416b751f550ac86
f19a193e813c5b2a
f557a43e0ebcb2d5
5a710d1a4397b749
223900f13e701a6b
eed5c2bbff350b12
9ee40c75eb1979eb
d080d2e52881c25e
3c1d81f1c54a0da7
67324ecb28a32281
33fb35df0779587d
16e6d1a9a14b3912
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
