import gc
import json
import os
import shutil
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from transformers import AutoProcessor, BitsAndBytesConfig, Gemma3ForConditionalGeneration

MODEL_ID = "google/gemma-3-12b-it"
ROOT = Path.home() / "BuyFlowTools"
MODEL_DIR = ROOT / "models" / "gemma-3-12b-it"
MIN_FREE_GB = 32


def gb(x: int) -> float:
    return round(x / (1024 ** 3), 2)


def main() -> None:
    print("==============================================================")
    print("BUYFLOW V17 - GEMMA 3 12B QLORA DOWNLOAD + LOAD SMOKE V2")
    print(f"Model: {MODEL_ID}")
    print(f"Local dir: {MODEL_DIR}")
    print("Training: NOT STARTED")
    print("Production: OFF")
    print("==============================================================")

    if not torch.cuda.is_available():
        raise RuntimeError("PyTorch cannot see the AMD GPU through the CUDA-compatible ROCm API.")

    ROOT.mkdir(parents=True, exist_ok=True)
    total, used, free = shutil.disk_usage(ROOT)
    print(f"Disk total: {gb(total)} GB")
    print(f"Disk used:  {gb(used)} GB")
    print(f"Disk free:  {gb(free)} GB")
    if gb(free) < MIN_FREE_GB and not MODEL_DIR.exists():
        raise RuntimeError(f"Need at least {MIN_FREE_GB} GB free before first model download.")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    print("\nDownloading / resuming Gemma 3 12B files...")
    snapshot_path = snapshot_download(
        repo_id=MODEL_ID,
        local_dir=str(MODEL_DIR),
        allow_patterns=[
            "*.json",
            "*.safetensors",
            "*.model",
            "*.jinja",
            "tokenizer*",
            "preprocessor*",
            "processor*",
            "chat_template*",
        ],
    )
    print(f"snapshot= {snapshot_path}")

    weight_files = list(MODEL_DIR.glob("*.safetensors"))
    if not weight_files:
        raise RuntimeError("No safetensors model weights were downloaded.")
    model_bytes = sum(p.stat().st_size for p in weight_files)
    print(f"Weight files: {len(weight_files)} | on disk: {gb(model_bytes)} GB")

    print("\nLoading 4-bit NF4 model on GPU...")
    qconfig = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )

    torch.cuda.empty_cache()
    model = Gemma3ForConditionalGeneration.from_pretrained(
        str(MODEL_DIR),
        quantization_config=qconfig,
        device_map={"": 0},
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="eager",
    ).eval()

    processor = AutoProcessor.from_pretrained(str(MODEL_DIR))

    messages = [
        {
            "role": "system",
            "content": [{"type": "text", "text": "You are a helpful assistant."}],
        },
        {
            "role": "user",
            "content": [{"type": "text", "text": "Reply with exactly: BUYFLOW_SMOKE_OK"}],
        },
    ]
    inputs = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    )
    inputs = {k: v.to("cuda") if hasattr(v, "to") else v for k, v in inputs.items()}
    input_len = inputs["input_ids"].shape[-1]

    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=20,
            do_sample=False,
            use_cache=True,
        )
    text = processor.decode(output[0][input_len:], skip_special_tokens=True).strip()

    stats = {
        "torch": torch.__version__,
        "hip": getattr(torch.version, "hip", None),
        "device": torch.cuda.get_device_name(0),
        "vram_total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2),
        "vram_allocated_gb": round(torch.cuda.memory_allocated(0) / 1024**3, 2),
        "vram_reserved_gb": round(torch.cuda.memory_reserved(0) / 1024**3, 2),
        "quantization": "bnb-4bit-nf4-double-quant-bf16",
        "generated": text,
    }
    print("\n" + json.dumps(stats, ensure_ascii=False, indent=2))

    if "BUYFLOW_SMOKE_OK" not in text:
        raise RuntimeError(f"Model loaded but generation smoke output was unexpected: {text!r}")

    del model, processor, inputs, output
    gc.collect()
    torch.cuda.empty_cache()

    print("\n==============================================================")
    print("BUYFLOW V17 GEMMA 3 12B QLORA LOAD: PASS")
    print("Full Gemma weights: DOWNLOADED")
    print("4-bit NF4 load: PASS")
    print("Text generation: PASS")
    print("Training: NOT STARTED")
    print("Production: OFF")
    print("==============================================================")


if __name__ == "__main__":
    main()
