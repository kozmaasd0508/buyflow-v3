from pathlib import Path
import sys

p = Path(sys.argv[1])
if not p.exists():
    raise SystemExit(f"trainer missing: {p}")

s = p.read_text(encoding="utf-8")
repls = {
    'SEED = 17032026': 'SEED = 17042026',
    'START_ADAPTER = ROOT / "adapters" / "buyflow-v17-gemma3-12b-qlora-r8-v3"': 'START_ADAPTER = ROOT / "adapters" / "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"',
    'DATA_DIR = Path.home() / "Desktop" / "buyflow-v17-3-large"': 'DATA_DIR = Path.home() / "Desktop" / "buyflow-v17-4-5000"',
    'OUT_DIR = ROOT / "adapters" / "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"': 'OUT_DIR = ROOT / "adapters" / "buyflow-v17-4-gemma3-12b-qlora-r8-cont2"',
    'EXPECTED_TRAIN_SHA = "50fb0d02df0e27c02c52763b4740614c354de02896df5494df0b42c1acbeb2bf"': 'EXPECTED_TRAIN_SHA = "c53d866b62df32b61e47d861d71b24d56ddd024c88aeeb07e6f2472b49f25865"',
    'EXPECTED_VAL_SHA = "3586eeab32c1d769f471f6604037350b0daafb88d5df66b716595794fbe2f56c"': 'EXPECTED_VAL_SHA = "693ed74616c97c2348332c488c71efb07b88bc8aeca64dcde407ba501225ffd2"',
    'EXPECTED_TRAIN_ROWS = 3000': 'EXPECTED_TRAIN_ROWS = 5000',
    'EXPECTED_VAL_ROWS = 400': 'EXPECTED_VAL_ROWS = 600',
    'LR = 2.0e-5': 'LR = 1.0e-5',
    'CHECKPOINT_EVERY = 500': 'CHECKPOINT_EVERY = 1000',
    'BUYFLOW V17.3 - GEMMA 3 12B QLORA CONTINUATION': 'BUYFLOW V17.4 - GEMMA 3 12B QLORA CONTINUATION',
    'Start adapter: buyflow-v17-gemma3-12b-qlora-r8-v3': 'Start adapter: buyflow-v17-3-gemma3-12b-qlora-r8-cont1',
    'Train: 3000 | Validation: 400': 'Train: 5000 | Validation: 600',
    'External Blind V2: UNTOUCHED': 'External Blind V3: UNTOUCHED',
    'Continuation: 1 epoch | batch=1 | grad_accum=8 | lr=2e-5': 'Continuation: 1 epoch | batch=1 | grad_accum=8 | lr=1e-5',
    'Validating assistant boundaries for ALL 3400 rows before model load...': 'Validating assistant boundaries for ALL 5600 rows before model load...',
    'DATASET MASKING PRECHECK: PASS | 3400/3400': 'DATASET MASKING PRECHECK: PASS | 5600/5600',
    'Loading existing V17 LoRA adapter as TRAINABLE continuation...': 'Loading existing V17.3 LoRA adapter as TRAINABLE continuation...',
    'Measuring initial V17.3 validation loss...': 'Measuring initial V17.4 validation loss...',
    'Measuring final V17.3 validation loss...': 'Measuring final V17.4 validation loss...',
    '"run": "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"': '"run": "buyflow-v17-4-gemma3-12b-qlora-r8-cont2"',
    '"external_blind_v2_touched": False': '"external_blind_v3_touched": False',
    'BUYFLOW V17.3 QLORA CONTINUATION: COMPLETE': 'BUYFLOW V17.4 QLORA CONTINUATION: COMPLETE',
}

count = 0
for old, new in repls.items():
    if old not in s:
        raise SystemExit(f"expected source pattern missing; refusing patch: {old}")
    s = s.replace(old, new)
    count += 1

p.write_text(s, encoding="utf-8")
print(f"V17.4 TRAINER PATCH: PASS | replacements={count}")
print("Start adapter: V17.3 3000-row continuation")
print("Data: 5000 train + 600 validation")
print("Plan: 1 epoch | lr=1e-5 | grad_accum=8 | checkpoint_every=1000")
print("External Blind V3: NOT READ / NOT MODIFIED")
print("Production: OFF")
