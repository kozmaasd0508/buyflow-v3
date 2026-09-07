from pathlib import Path
import sys

if len(sys.argv) != 3:
    raise SystemExit('usage: patcher.py <src> <dst>')

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
text = src.read_text(encoding='utf-8')

# The real Unsloth GPT-OSS tokenizer/template on this Windows+AMD install renders
# assistant training targets as:
#   <|start|>assistant<|message|>{...}<|return|>
# not with an explicit <|channel|>final marker. Use the discovered boundary
# exactly and validate it across the full train/validation datasets.
old = '''    # Refuse to proceed if the required Harmony final-response boundary disappeared.\n    marker = "<|start|>assistant<|channel|>final<|message|>"\n    if marker not in train_ds[0]["text"]:\n        raise RuntimeError("Harmony final-response marker missing; refusing to guess loss boundary")\n    print("HARMONY TEMPLATE PRECHECK: PASS")\n'''
new = '''    # Use the exact assistant-response boundary discovered from the loaded tokenizer.\n    # Diagnostic on this exact environment rendered:\n    # <|start|>assistant<|message|>{...}<|return|>\n    marker = "<|start|>assistant<|message|>"\n    bad_train = [i for i, t in enumerate(train_ds["text"]) if t.count(marker) != 1]\n    bad_val = [i for i, t in enumerate(val_ds["text"]) if t.count(marker) != 1]\n    if bad_train or bad_val:\n        raise RuntimeError(\n            f"Assistant response boundary mismatch; train_bad={len(bad_train)} val_bad={len(bad_val)}"\n        )\n    print(\n        f"HARMONY RESPONSE BOUNDARY PRECHECK: PASS | marker={marker!r} | "\n        f"train={len(train_ds)} validation={len(val_ds)}"\n    )\n'''
if text.count(old) != 1:
    raise SystemExit('Could not patch Harmony response-boundary block exactly once')
text = text.replace(old, new)

# Make the masking step visibly report the exact discovered response marker.
old2 = '''    trainer = train_on_responses_only(\n        trainer,\n        instruction_part="<|start|>user<|message|>",\n        response_part=marker,\n    )\n'''
new2 = '''    trainer = train_on_responses_only(\n        trainer,\n        instruction_part="<|start|>user<|message|>",\n        response_part=marker,\n    )\n    print(f"RESPONSE-ONLY MASKING CONFIG: instruction='<|start|>user<|message|>' response={marker!r}")\n'''
if text.count(old2) != 1:
    raise SystemExit('Could not patch response-only masking block exactly once')
text = text.replace(old2, new2)

dst.write_text(text, encoding='utf-8')
print('GPT-OSS TARGETED TRAINER V3 PATCH: PASS')
print("Discovered response marker: <|start|>assistant<|message|>")
