# Unknown Webshop Challenge v2 — blind freeze

Date: 2026-08-24

## Goal
Measure whether the Universal Commerce Grammar + Universal Semantic Layer generalizes to previously unused webshop emails without merchant-specific patching.

## Frozen code snapshot
`3743282d354a36c0752370094ea58aea38f5a3c5`

This is the code snapshot to score. No parser/grammar/semantic rule changes are allowed before the first v2 score is recorded.

## Candidate selection
Gmail ID-only query used before reading candidate content:

`after:2023/01/01 before:2024/01/01 -from:me -in:spam -in:trash {rendelés megrendelés order rendelésed megrendelésed}`

Selected: 60 incoming messages.

Only opaque SHA-256 prefixes are stored below. Raw Gmail message IDs, addresses, order numbers, tracking numbers and email bodies are intentionally not committed.

## Frozen candidate hashes
- `9f3f4f98338d8e99`
- `1369cb55887625e1`
- `f42a186a43521315`
- `33e72b02768cfc39`
- `2108f6e5dffda0b9`
- `d1bd9fd1f6d6e335`
- `eaced3efd23a0292`
- `05e495154a9f6772`
- `ef67fde1345bfd0b`
- `54d0e46b537d9ec5`
- `5eaf6f32d897b1a4`
- `90c155f3142b922e`
- `cf1627e0e51d360f`
- `b2dad10f15be7ef6`
- `5e7540174948a0fd`
- `65f66917a89bf831`
- `f5e66ead06378236`
- `39aa53ab5d6c598c`
- `e359313519149e73`
- `7b22e54ba062a645`
- `94ad548fcfba3dba`
- `c56423e2dee6d4e1`
- `61a5dfb9b30b1f4e`
- `2f27b8e2fb7aad41`
- `67cb03257f365074`
- `457af7621b87d2f5`
- `df50023e8fb0b202`
- `b69692290d4cb0bd`
- `e5be63e2c7ec7aed`
- `e06b4320d31294ed`
- `2e9ceddd0ebb02ab`
- `b9388a2ecea661e8`
- `7bd8696476aac537`
- `d34853d8a3cb1c5d`
- `7589eae7e5815cf7`
- `ce04a9612f54ba7b`
- `77521e2441ae8abb`
- `cdbf3b37a5d76918`
- `89797b2e0794f29e`
- `6544df260e548e8f`
- `7b4eaa7786a86e1f`
- `d9d91e1a6e9a3681`
- `fe7d22d6cb85acc4`
- `2fdd20ea942036a8`
- `af2e75f19bf0f00f`
- `76d51a13529ecdc0`
- `eb6c73793deb4d7a`
- `f121dcd9ee126441`
- `690497d4bb428094`
- `a312ffa8afa7c9cc`
- `482b90c330aaf0e5`
- `c6e39c25157bca64`
- `2891247c54ca4c3e`
- `99e341584bf4e4ff`
- `b82855ac248dc92e`
- `84bc66840bcffd07`
- `62c90b6464ce4c6d`
- `a58b24ad96501cd6`
- `ee0ffc0fab18f976`
- `552fa7edac6af494`

## Scoring rules
Report separately:
1. visible-language grammar result,
2. technical HTML/URL semantic evidence contribution,
3. combined universal result,
4. full-stack result only as a secondary comparison.

Do not count a message as an unknown-webshop success if recognition depends on an existing merchant-specific adapter.

Primary safety metrics:
- wrong automatic commerce classification,
- wrong lifecycle promotion,
- wrong hard identifier,
- unsafe merchant-specific dependency.

After the first score is recorded these messages become regression-only and are no longer blind.