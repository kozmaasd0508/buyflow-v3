#!/usr/bin/env python3
"""Local, fail-closed BuyFlow EventMind V11 inference server.

The server binds to loopback only, loads the completed V11 Qwen3-8B adapter,
requires the exact training/isolation markers, fingerprints adapter weights and
accepts only the fixed EventMind runtime request contract. Thinking is explicitly
disabled; tokenizers that cannot prove that setting are rejected rather than
falling back to a looser template.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MODEL_ID = "Qwen/Qwen3-8B"
EXPECTED_STATUS = "LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE"
PROTOCOL_VERSION = "buyflow-eventmind-v11-runtime-v1"
RUNTIME_VERSION = "eventmind-v11-runtime-v1"
TEMPLATE_VERSION = "qwen3-chat-template-thinking-off-v1"
MAX_NEW_TOKENS = 48
MAX_REQUEST_BYTES = 256_000
DEFAULT_PORT = 4394
VENV_ROOT = Path.home() / ".venvs" / "buyflow-lora"
VENV_PYTHON = VENV_ROOT / "bin" / "python"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_runtime() -> None:
    os.environ.setdefault("HSA_ENABLE_DXG_DETECTION", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("HF_HOME", str(Path.home() / ".cache" / "huggingface"))

    if not VENV_PYTHON.is_file():
        raise RuntimeError(
            f"BuyFlow LoRA venv missing: {VENV_PYTHON}. Refusing to install or modify it automatically."
        )
    if Path(sys.prefix).resolve() != VENV_ROOT.resolve():
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])


def resolve_run(project_root: Path, explicit: str | None) -> tuple[Path, Path, dict[str, Any], str]:
    if explicit:
        run_dir = Path(explicit).expanduser().resolve()
    else:
        latest = project_root / "local-data" / "lora-v11" / "LATEST.txt"
        if not latest.is_file():
            raise RuntimeError(f"V11 latest pointer missing: {latest}")
        run_dir = Path(latest.read_text(encoding="utf-8").strip()).expanduser().resolve()

    metrics_path = run_dir / "metrics.json"
    best_dir = run_dir / "best"
    adapter_weights = best_dir / "adapter_model.safetensors"
    adapter_config = best_dir / "adapter_config.json"
    if not metrics_path.is_file():
        raise RuntimeError(f"V11 metrics missing: {metrics_path}")
    if not adapter_weights.is_file() or not adapter_config.is_file():
        raise RuntimeError(f"V11 best adapter incomplete: {best_dir}")

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if metrics.get("status") != EXPECTED_STATUS:
        raise RuntimeError(f"Unexpected V11 training status: {metrics.get('status')}")
    for key in ("frozen_108_trained", "blind_50_trained", "locked_test_read", "locked_test_trained"):
        if metrics.get(key) is not False:
            raise RuntimeError(f"V11 isolation gate failed: {key}")

    adapter_sha = sha256_file(adapter_weights)
    return run_dir, best_dir, metrics, adapter_sha


def strict_request(value: Any) -> tuple[str, dict[str, Any]] | None:
    if not isinstance(value, dict) or set(value) != {"protocol_version", "prompt", "generation"}:
        return None
    if value.get("protocol_version") != PROTOCOL_VERSION:
        return None
    prompt = value.get("prompt")
    generation = value.get("generation")
    if not isinstance(prompt, str) or not prompt.strip() or not isinstance(generation, dict):
        return None
    if set(generation) != {"do_sample", "enable_thinking", "max_new_tokens"}:
        return None
    if generation.get("do_sample") is not False:
        return None
    if generation.get("enable_thinking") is not False:
        return None
    if generation.get("max_new_tokens") != MAX_NEW_TOKENS:
        return None
    return prompt, generation


class RuntimeState:
    def __init__(self, tokenizer: Any, model: Any, adapter_sha: str):
        self.tokenizer = tokenizer
        self.model = model
        self.adapter_sha = adapter_sha
        self.lock = threading.Lock()

    def render_prompt(self, user_prompt: str) -> str:
        # No compatibility fallback is allowed: if this tokenizer cannot accept
        # enable_thinking=False, the request fails closed.
        try:
            return self.tokenizer.apply_chat_template(
                [{"role": "user", "content": user_prompt}],
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=False,
            )
        except TypeError as exc:
            raise RuntimeError("TOKENIZER_CANNOT_PROVE_THINKING_OFF") from exc

    def infer(self, user_prompt: str) -> str:
        import torch

        prompt = self.render_prompt(user_prompt)
        encoded = self.tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
        encoded = {key: value.to("cuda") for key, value in encoded.items()}
        with self.lock, torch.inference_mode():
            try:
                output = self.model.generate(
                    **encoded,
                    max_new_tokens=MAX_NEW_TOKENS,
                    do_sample=False,
                    pad_token_id=self.tokenizer.eos_token_id,
                    eos_token_id=self.tokenizer.eos_token_id,
                )
                torch.cuda.synchronize()
            except torch.OutOfMemoryError:
                gc.collect()
                torch.cuda.empty_cache()
                raise RuntimeError("CUDA_OUT_OF_MEMORY")
        generated = output[0, encoded["input_ids"].shape[1]:]
        return self.tokenizer.decode(generated, skip_special_tokens=True)


STATE: RuntimeState | None = None


class Handler(BaseHTTPRequestHandler):
    server_version = "BuyFlowEventMindV11/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Never log request bodies/prompts. Keep only normal HTTP metadata.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        state = STATE
        if self.path != "/health" or state is None:
            self._send(404, {"ok": False})
            return
        self._send(200, {
            "ok": True,
            "protocol_version": PROTOCOL_VERSION,
            "model_id": MODEL_ID,
            "adapter_sha256": state.adapter_sha,
            "runtime_version": RUNTIME_VERSION,
            "template_version": TEMPLATE_VERSION,
            "thinking_enabled": False,
            "deterministic": True,
        })

    def do_POST(self) -> None:
        state = STATE
        if self.path != "/v1/eventmind" or state is None:
            self._send(404, {"ok": False})
            return
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError:
            self._send(400, {"ok": False, "reason": "INVALID_CONTENT_LENGTH"})
            return
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._send(413, {"ok": False, "reason": "REQUEST_SIZE_REJECTED"})
            return
        try:
            request = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._send(400, {"ok": False, "reason": "INVALID_JSON"})
            return
        parsed = strict_request(request)
        if parsed is None:
            self._send(400, {"ok": False, "reason": "INVALID_REQUEST_CONTRACT"})
            return
        prompt, _generation = parsed
        try:
            output = state.infer(prompt)
        except RuntimeError as exc:
            reason = str(exc)
            status = 503 if reason == "CUDA_OUT_OF_MEMORY" else 500
            self._send(status, {"ok": False, "reason": reason})
            return
        except Exception:
            self._send(500, {"ok": False, "reason": "INFERENCE_FAILED"})
            return

        self._send(200, {
            "protocol_version": PROTOCOL_VERSION,
            "model_id": MODEL_ID,
            "adapter_sha256": state.adapter_sha,
            "runtime_version": RUNTIME_VERSION,
            "template_version": TEMPLATE_VERSION,
            "thinking_enabled": False,
            "deterministic": True,
            "output": output,
        })


def load_model(adapter_dir: Path) -> tuple[Any, Any]:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise RuntimeError("ROCM_GPU_UNAVAILABLE")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Startup proof that thinking can be disabled. Do not silently fall back to
    # a template invocation that omits the setting.
    try:
        tokenizer.apply_chat_template(
            [{"role": "user", "content": "health"}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
    except TypeError as exc:
        raise RuntimeError("TOKENIZER_CANNOT_PROVE_THINKING_OFF") from exc

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
    model = PeftModel.from_pretrained(base, adapter_dir, is_trainable=False)
    model.eval()
    model.config.use_cache = True
    return tokenizer, model


def main() -> None:
    parser = argparse.ArgumentParser(description="BuyFlow EventMind V11 local runtime")
    parser.add_argument("project_root")
    parser.add_argument("--run-dir")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    ensure_runtime()
    root = Path(args.project_root).resolve()
    run_dir, best_dir, _metrics, adapter_sha = resolve_run(root, args.run_dir)
    tokenizer, model = load_model(best_dir)

    global STATE
    STATE = RuntimeState(tokenizer, model, adapter_sha)
    print(f"eventmind_v11_runtime: READY")
    print(f"model_id: {MODEL_ID}")
    print(f"adapter_sha256: {adapter_sha}")
    print(f"run_dir: {run_dir}")
    print(f"thinking_enabled: False")
    print(f"deterministic: True")
    print(f"listen: http://127.0.0.1:{args.port}")
    sys.stdout.flush()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        STATE = None
        del model
        gc.collect()
        import torch
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
