# Purchase Identity Graph v2 — targeted blind correlation freeze — 2026-08-24

## Purpose

The first random 47-message holdout contained strong safety controls but only one usable full purchase chain, and that chain belonged to an already researched merchant profile. This second holdout targets generic purchase-document subjects without selecting any merchant.

## Frozen gate

- Code snapshot: `f8651c272d4dd04110b21504be47565ff4203435` (correlation logic unchanged from `bcbc4a10266d3ed60b567be5b20394d67f51adb5`; only the first blind-freeze protocol was added afterward).
- CI #991 on correlation code: GREEN, 1166/1166 tests PASS.
- Gmail query: inbound, before 2025-07-15 and after 2024-01-01, excluding sent/spam/trash, with generic subject selection `{számla | rendelés | megrendelés}`.
- No merchant name was used in selection.
- **37 previously unopened message ids are frozen below only as SHA-256 hashes.**
- No message content from these candidates was opened before this freeze.
- No correlation rule may change before the first score is recorded.

## Frozen opaque message hashes

- e3b6ec38cccfbdcf9cec3b666811a4a2d834c9768452eb5d5fdd390e44ea7e1a
- 6b1997635460305116a2bd39c288ce1b1b0693d3a9d615376147e018091dd31c
- f02e65c44444e20955c184a05abde7bb9e80a57f0248eb86f913be2ed997b2a2
- db9092d57adef64008ef3055aaaf9a5be5085dc563c58c776f0107fd84f0909b
- 32b5266cc46e14099ae6cd839f4929a0e811c46e769b15d77ecf11adcc65f5b4
- bba6898629495dcbb09d77f000421fa968aaa2c9c8ff865b628eba49b15c1c80
- 14b59e1f3ddd2cad33177d9666e533f4ba0fb699fcada042f92864130bc6a35b
- e89ae5a67b9d959925ec56338e84c48226f6740d9f097b5b59420865b55d2500
- 9304e8d6d23b5934eae57bd45c11706225460e0f6a411043477b69eb078e8505
- 45fb9390e6d63e6e4beba20abef66ba839e7cbb2d8aaed70c0552a4177cab133
- f857dd2387d2ef4ab639acaab78ab040dbd82bd7da37534cbe8d50b78f0f4170
- 34bf515be3d24a7d18d9755fdb2e28bf508f80dc9be17635740dba367ece1974
- 71b0edf5b2a78e0917f62e5edd5d3b7c72b536ce1b6f56cc47aa7bed0d907b24
- 3284ff08389ebf58fd640f8b3448a54e2cc1e875871ea434e295adb5a2a34420
- b59ab1b1285330d1710eba6cd525ec47163745efefca5089bec7ea1f1886e9ef
- 106171f36e36f3b8540f48d27e458ab7a92febb2321bcf4af87790fe4d2f9721
- c5534388bcffe1e6b5acebfdc7eac4fe54e126c20edf9f7611d4e57ac3f8fa12
- d4b89b925b9c175b1fe17e1c239e7756d38f58f30cbe3c04e4f239beb5500c4c
- 6b2637178e8b6ddd90525fa42a8f5d35e699147e4d1c1adcc5d2170bfab362f3
- aafbad00f350f1a7ec252d94a0c358c5d9f901f30239b840e616c488bed8fe1c
- f324e6352a932cca2993fcb642037a86c62f943d2a380ab08e46faf2b044fcf6
- 283cb5443e81cca79a471bcb38175273ea0822481bf39f3d7a7c8276f2bf8903
- 7ba961586462a650f7c0eacede25492d5f2d3d023f5f7f82521959858bfb942d
- 66492f1010b2b0bd4009320dfc2e3f8139eb404f386b95c6f574595f697ade02
- 20892a6808edf05f4b238c9b1c1dd2680695e6033db6f677fb2c01fb1b9830f9
- 1b7380ade95a60bbd9bea661b56e477c5d0072cc2be334a3f3aafd83448d9ade
- c0f4f29f15beee7240e87f734b6ff6c75e0c8da8762e95fdae701a57110b092a
- 09639304441a9fc1b62277c210cc3aa6cd4746538a54b8d99d4beda562d4efe0
- f170abf1f2ee5d3704397f89ae669d60591ca25b31f2400bc7059bbaf4caac96
- 47186921aaed83d39df742a13b7f65f8bc754da24bf42957e91752fb352f0807
- 86fd621453ee6ca3242d8a2ede1c49426507aad851f4b7a412b9ad30ba8f7674
- 1df66d3cd75a08d3b1b67b3d1da9759a39fb64317243c0d91bb9cc55b16d64db
- 96e4dd4562281d5fc3ad0d168b0fe4a0062b29f0aa9fa0bfb96030a50172eb6e
- 71b31609812dd2de2bdd2fbc22addcc64de920c8d115fca9c7e41b513883bcff
- 258476d7f81d4869df84af5c8606e454aef448347e02ffdf4bcd9d91bbad739f
- d386e04ffca57e4d121f2ece06a45824d9f1185a0d9a727fcf7d7d621c664611
- ca8d0e282610ab644a6d8d3134ea0e6e82f1ce5240efbba10b1781878e1eeb70

## Scoring

Group usable emails by ground-truth purchase identity from visible order id + merchant source. For later events score:

- CORRECT_LINK
- REVIEW
- PENDING
- UNLINKED
- WRONG_LINK

A WRONG_LINK is a hard failure. Report merchant/template-family counts separately from message counts.
