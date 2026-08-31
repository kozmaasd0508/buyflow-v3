from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

from v11_fresh_blind_config import ALLOWED, INSTRUCTION, MAX_NEW_TOKENS, MAX_PROMPT_TOKENS, MODEL_ID


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tokenizer_template(tokenizer: Any, messages: list[dict[str, str]], generation: bool) -> str:
    try:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=generation,
            enable_thinking=False,
        )
    except TypeError:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=generation)


def prompt_for_case(tokenizer: Any, case: dict[str, Any]) -> tuple[str, int]:
    document = json.dumps(case["document"], ensure_ascii=False, separators=(",", ":"))
    user = f"{INSTRUCTION}\n\nEMAIL_DOCUMENT:\n{document}"
    prompt = tokenizer_template(tokenizer, [{"role": "user", "content": user}], True)
    token_count = len(tokenizer(prompt, add_special_tokens=False)["input_ids"])
    if token_count > MAX_PROMPT_TOKENS:
        raise RuntimeError(f"PROMPT_TOO_LONG {case['case_id']}: {token_count}>{MAX_PROMPT_TOKENS}")
    return prompt, token_count


def strict_prediction(text: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        obj = json.loads(text.strip())
    except Exception:
        return None, "INVALID_JSON"
    if not isinstance(obj, dict) or set(obj) != {"is_commerce", "event_type"}:
        return None, "INVALID_SCHEMA"
    if not isinstance(obj["is_commerce"], bool) or obj["event_type"] not in ALLOWED:
        return None, "INVALID_VALUES"
    return obj, None


def resolve_adapter(project_root: Path, explicit: str | None) -> tuple[Path, Path, dict[str, Any]]:
    if explicit:
        adapter = Path(explicit).expanduser().resolve()
        run = adapter.parent if adapter.name == "best" else adapter
        if adapter.name != "best" and (adapter / "best").is_dir():
            adapter = adapter / "best"
    else:
        latest = project_root / "local-data" / "lora-v11" / "LATEST.txt"
        if not latest.is_file():
            raise RuntimeError(f"V11_LATEST_MISSING: {latest}")
        run = Path(latest.read_text(encoding="utf-8").strip()).expanduser().resolve()
        adapter = run / "best"

    metrics_path = run / "metrics.json"
    if not metrics_path.is_file():
        raise RuntimeError(f"V11_METRICS_MISSING: {metrics_path}")
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if metrics.get("status") != "LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE":
        raise RuntimeError(f"V11_STATUS_UNEXPECTED: {metrics.get('status')}")
    for key in ("frozen_108_trained", "blind_50_trained", "locked_test_read", "locked_test_trained"):
        if metrics.get(key) is not False:
            raise RuntimeError(f"V11_ISOLATION_GATE_FAILED: {key}")
    for name in ("adapter_model.safetensors", "adapter_config.json"):
        if not (adapter / name).is_file():
            raise RuntimeError(f"V11_ADAPTER_INCOMPLETE: {adapter / name}")
    return run, adapter, metrics


def load_model(adapter: Path) -> tuple[Any, Any]:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise RuntimeError("ROCM_GPU_UNAVAILABLE")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.float16,
    )
    base = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=quantization,
        device_map={"": 0},
        dtype=torch.float16,
        low_cpu_mem_usage=True,
        local_files_only=True,
    )
    model = PeftModel.from_pretrained(base, adapter, is_trainable=False)
    model.eval()
    model.config.use_cache = True
    return tokenizer, model


def infer(tokenizer: Any, model: Any, prompt: str) -> tuple[str, float]:
    import torch

    encoded = tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
    encoded = {key: value.to("cuda") for key, value in encoded.items()}
    started = time.perf_counter()
    with torch.inference_mode():
        output = model.generate(
            **encoded,
            max_new_tokens=MAX_NEW_TOKENS,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    torch.cuda.synchronize()
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    generated = output[0, encoded["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True), elapsed_ms
