import gc
import json
from pathlib import Path

import torch
from peft import LoraConfig, TaskType, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoTokenizer, BitsAndBytesConfig, Gemma3ForConditionalGeneration

MODEL_ID = "google/gemma-3-12b-it"
ROOT = Path.home() / "BuyFlowTools"
MODEL_DIR = ROOT / "models" / "gemma-3-12b-it"


def main() -> None:
    print("==============================================================")
    print("BUYFLOW V17 - GEMMA 3 12B TEXT-ONLY QLORA SMOKE V3")
    print(f"Model: {MODEL_ID}")
    print(f"Local dir: {MODEL_DIR}")
    print("Uses cached model files only: YES")
    print("Training: NOT STARTED")
    print("Production: OFF")
    print("==============================================================")

    if not MODEL_DIR.exists():
        raise RuntimeError(f"Local Gemma model directory missing: {MODEL_DIR}")
    if not torch.cuda.is_available():
        raise RuntimeError("PyTorch cannot see the AMD GPU through the ROCm CUDA-compatible API.")

    qconfig = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )

    print("\nLoading cached Gemma 3 12B in 4-bit NF4 on GPU...")
    torch.cuda.empty_cache()
    model = Gemma3ForConditionalGeneration.from_pretrained(
        str(MODEL_DIR),
        quantization_config=qconfig,
        device_map={"": 0},
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="eager",
        local_files_only=True,
    ).eval()

    print("Loading TEXT tokenizer only (no torchvision/Pillow needed)...")
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)

    messages = [
        {"role": "user", "content": "Reply with exactly: BUYFLOW_SMOKE_OK"},
    ]
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt")
    inputs = {k: v.to("cuda") for k, v in inputs.items()}
    input_len = inputs["input_ids"].shape[-1]

    print("Running text generation smoke...")
    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=20,
            do_sample=False,
            use_cache=True,
        )
    text = tokenizer.decode(output[0][input_len:], skip_special_tokens=True).strip()
    print(f"generated= {text}")
    if "BUYFLOW_SMOKE_OK" not in text:
        raise RuntimeError(f"Unexpected generation output: {text!r}")

    print("\nAttaching a small LoRA adapter (no training step yet)...")
    del inputs, output
    gc.collect()
    torch.cuda.empty_cache()

    model.train()
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    lora = LoraConfig(
        r=8,
        lora_alpha=16,
        lora_dropout=0.0,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    if trainable <= 0:
        raise RuntimeError("LoRA adapter attached but no trainable parameters were found.")

    stats = {
        "torch": torch.__version__,
        "hip": getattr(torch.version, "hip", None),
        "device": torch.cuda.get_device_name(0),
        "vram_total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2),
        "vram_allocated_gb": round(torch.cuda.memory_allocated(0) / 1024**3, 2),
        "vram_reserved_gb": round(torch.cuda.memory_reserved(0) / 1024**3, 2),
        "quantization": "bnb-4bit-nf4-double-quant-bf16",
        "generated": text,
        "lora_trainable_params": trainable,
        "model_params_seen": total,
    }
    print("\n" + json.dumps(stats, ensure_ascii=False, indent=2))

    del model, tokenizer
    gc.collect()
    torch.cuda.empty_cache()

    print("\n==============================================================")
    print("BUYFLOW V17 GEMMA 3 12B TEXT QLORA: PASS")
    print("Full Gemma weights: CACHED")
    print("4-bit NF4 load: PASS")
    print("Text tokenizer: PASS")
    print("Text generation: PASS")
    print("LoRA adapter attach: PASS")
    print("Training: NOT STARTED")
    print("Production: OFF")
    print("==============================================================")


if __name__ == "__main__":
    main()
