# BuyFlow TestLab v1

The TestLab is a non-production verification environment for BuyFlow.

## Goal

One reproducible test entry point for:

- API typecheck and regression tests
- EventMind V11 on a frozen real-Gmail 120-message set
- TrustLink / Purchase Identity Graph V9 real-Gmail sanitized shadow audit
- JourneyGraph/Core safety coverage through regression tests
- future LINK120 chain-ground-truth scoring
- future RawVault real private-Storage smoke

## Safety contract

- Production cutover is never authorized by TestLab.
- Gmail real120 uses GET-only mailbox access.
- EventMind may classify commerce/event semantics only.
- Purchase Identity Graph remains the only identity/link/create/merge authority.
- Real Gmail content and raw Gmail message IDs must not be uploaded as artifacts.
- The frozen 120 Gmail IDs stay only on the local TestLab runner under `.testlab-private`.
- The real120 artifact contains only SHA-256 message identifiers plus model predictions/runtime metadata.
- TrustLink V9 shadow must keep production writes at 0, graph AI calls at 0, false merges at 0, false shipment merges at 0, unauthorized creates at 0, duplicate creates at 0, and links without hard evidence at 0.
- RawVault real Storage remains BLOCKED until an isolated Storage-capable Supabase environment is available.

## Execution model

GitHub Actions is the control plane. A dedicated Windows self-hosted runner with label `buyflow-testlab` executes GPU/local-model tests. GitHub checks out the exact commit for every run, so tests do not depend on whichever branch happens to be open in a developer working directory.

The local V11 adapter/model remains outside Git and is discovered at:

`%USERPROFILE%\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation\local-data\lora-v11`

The frozen REAL120 Gmail ID list remains local at:

`%USERPROFILE%\Desktop\buyflow\.testlab-private\real120-ids.json`

## GitHub secrets for real Gmail

The EventMind REAL120 stage expects three repository secrets:

- `BUYFLOW_TESTLAB_GMAIL_CLIENT_ID`
- `BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET`
- `BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN`

Use a Gmail OAuth grant limited to read-only mailbox access. Secret values are never printed by the TestLab runner.

## Suites

- `core`: typecheck + API regression
- `identity`: core + TrustLink V9 sanitized real-Gmail shadow + LINK120 gate status
- `eventmind`: EventMind V11 REAL120
- `full`: all available suites + explicit BLOCKED status for unfinished environment gates

## Output

Each run creates a `buyflow-testlab-<run_id>` GitHub Actions artifact containing `testlab-summary.json` and available stage reports. GitHub Step Summary shows PASS / FAIL / BLOCKED per stage.
