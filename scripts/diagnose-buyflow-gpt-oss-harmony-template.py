import os
import re
from pathlib import Path

# Runtime hygiene before importing Unsloth.
os.environ.pop("BNB_ROCM_VERSION", None)
root = Path.home() / "BuyFlowTools" / "gptoss-training"
root.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("UNSLOTH_ROCM_GFX_ARCH", "gfx1200")
os.environ.setdefault("UNSLOTH_COMPILE_LOCATION", str(root / "unsloth_compiled_cache"))
os.environ.setdefault("HF_HOME", str(root / "hf-cache"))

print("BNB before torch:", os.environ.get("BNB_ROCM_VERSION"))
import torch
print("BNB after torch:", os.environ.get("BNB_ROCM_VERSION"))
from unsloth import FastLanguageModel
print("BNB after unsloth import:", os.environ.get("BNB_ROCM_VERSION"))

print("Loading exact GPT-OSS training model/tokenizer for TEMPLATE DIAGNOSTIC ONLY...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/gpt-oss-20b",
    dtype=None,
    max_seq_length=1024,
    load_in_4bit=True,
    full_finetuning=False,
)

messages = [
    {"role": "system", "content": "You are a test classifier."},
    {"role": "user", "content": "Test email."},
    {"role": "assistant", "content": '{"event_type":"OTHER","perspective":"non_purchase","order_id":null,"tracking_id":null,"link_status":"not_applicable"}'},
]
rendered = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=False,
    reasoning_effort="low",
)

print("RENDER TYPE:", type(rendered).__name__)
print("RENDER LENGTH:", len(rendered))

needle = '{"event_type":"OTHER"'
pos = rendered.find(needle)
print("TARGET JSON POSITION:", pos)
if pos < 0:
    raise RuntimeError("Synthetic target JSON not found in rendered template")

start = max(0, pos - 350)
end = min(len(rendered), pos + 250)
print("--- RENDERED WINDOW repr ---")
print(repr(rendered[start:end]))
print("--- CONTROL TOKENS BEFORE TARGET ---")
prefix = rendered[max(0, pos - 500):pos]
controls = re.findall(r"<\|[^>]+\|>", prefix)
print(controls)

candidates = [
    "<|start|>assistant<|channel|>final<|message|>",
    "<|start|>assistant<|channel|>analysis<|message|>",
    "<|start|>assistant<|message|>",
]
for c in candidates:
    print(f"MARKER {c!r}: {c in rendered}")

print("CHAT TEMPLATE CLASS:", tokenizer.__class__.__name__)
print("BUYFLOW GPT-OSS HARMONY TEMPLATE DIAGNOSTIC: PASS")
print("Training: NOT STARTED | Blind O2/O3: NOT USED | Production: OFF")
