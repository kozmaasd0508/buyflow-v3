from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: patch-buyflow-v17-5-targeted-qlora.py <trainer.py>')

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')

replacements = [
    ('SEED = 17032026', 'SEED = 1752026'),
    ('START_ADAPTER = ROOT / "adapters" / "buyflow-v17-gemma3-12b-qlora-r8-v3"', 'START_ADAPTER = ROOT / "adapters" / "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"'),
    ('DATA_DIR = Path.home() / "Desktop" / "buyflow-v17-3-large"', 'DATA_DIR = Path.home() / "Desktop" / "buyflow-v17-5-targeted"'),
    ('OUT_DIR = ROOT / "adapters" / "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"', 'OUT_DIR = ROOT / "adapters" / "buyflow-v17-5-gemma3-12b-qlora-r8-targeted1"'),
    ('EXPECTED_TRAIN_SHA = "50fb0d02df0e27c02c52763b4740614c354de02896df5494df0b42c1acbeb2bf"', 'EXPECTED_TRAIN_SHA = "2d5f11244bec1292827460b05fec215f404b12799b0375fbce8ea52d3883d092"'),
    ('EXPECTED_VAL_SHA = "3586eeab32c1d769f471f6604037350b0daafb88d5df66b716595794fbe2f56c"', 'EXPECTED_VAL_SHA = "15f68db07fb844b09708f25599ade58cf510bc24dea4ec9a99eb64472899e93c"'),
    ('EXPECTED_TRAIN_ROWS = 3000', 'EXPECTED_TRAIN_ROWS = 2400'),
    ('EXPECTED_VAL_ROWS = 400', 'EXPECTED_VAL_ROWS = 320'),
    ('LR = 2.0e-5', 'LR = 8.0e-6'),
    ('CHECKPOINT_EVERY = 500', 'CHECKPOINT_EVERY = 600'),
    ('BUYFLOW V17.3 - GEMMA 3 12B QLORA CONTINUATION', 'BUYFLOW V17.5 - GEMMA 3 12B TARGETED QLORA CONTINUATION'),
    ('Start adapter: buyflow-v17-gemma3-12b-qlora-r8-v3', 'Start adapter: buyflow-v17-3-gemma3-12b-qlora-r8-cont1'),
    ('Train: 3000 | Validation: 400', 'Train: 2400 | Validation: 320 | targeted contrastive hardening'),
    ('Continuation: 1 epoch | batch=1 | grad_accum=8 | lr=2e-5', 'Continuation: 1 epoch | batch=1 | grad_accum=8 | lr=8e-6'),
    ('Validating assistant boundaries for ALL 3400 rows before model load...', 'Validating assistant boundaries for ALL 2720 rows before model load...'),
    ('DATASET MASKING PRECHECK: PASS | 3400/3400', 'DATASET MASKING PRECHECK: PASS | 2720/2720'),
    ('Measuring initial V17.3 validation loss...', 'Measuring initial V17.5 targeted validation loss...'),
    ('Measuring final V17.3 validation loss...', 'Measuring final V17.5 targeted validation loss...'),
    ('"run": "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"', '"run": "buyflow-v17-5-gemma3-12b-qlora-r8-targeted1"'),
    ('"external_blind_v2_touched": False', '"closed_blind_v4_read_during_training": False'),
    ('BUYFLOW V17.3 QLORA CONTINUATION: COMPLETE', 'BUYFLOW V17.5 TARGETED QLORA CONTINUATION: COMPLETE'),
]

for old, new in replacements:
    n = s.count(old)
    if n != 1:
        raise RuntimeError(f'Expected exactly one occurrence, got {n}: {old}')
    s = s.replace(old, new)

old = 'External Blind V2: UNTOUCHED'
new = 'Closed Blind V4: NOT READ DURING TRAINING'
n = s.count(old)
if n != 2:
    raise RuntimeError(f'Expected exactly two Blind V2 status strings, got {n}')
s = s.replace(old, new)

needle = '    final_val = eval_loss(model, val_loader)\n    elapsed = time.time() - start\n'
insert = '    final_val = eval_loss(model, val_loader)\n    if final_val > initial_val:\n        print(f"WARNING: targeted validation worsened: {initial_val:.6f} -> {final_val:.6f}; do not promote without fresh Blind V5")\n    elapsed = time.time() - start\n'
if s.count(needle) != 1:
    raise RuntimeError('Could not locate final validation block')
s = s.replace(needle, insert)

p.write_text(s, encoding='utf-8')
print('V17.5 TRAINER PATCH: PASS')
print('Start adapter: V17.3 champion')
print('Data: 2400 targeted train + 320 disjoint validation')
print('LR: 8e-6 | epochs: 1 | grad_accum: 8')
print('Closed Blind V4: NOT READ DURING TRAINING')
print('Fresh Blind V5: UNTOUCHED')
print('Production: OFF')
