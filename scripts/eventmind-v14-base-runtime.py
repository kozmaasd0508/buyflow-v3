#!/usr/bin/env python3
"""LoRA-free BuyFlow EventMind V14 diagnostic runtime.

This server is intentionally isolated from production. It loads the cached base
Qwen3-8B model only, accepts separate system/user messages, disables thinking,
uses deterministic decoding, binds to loopback, and never logs prompt bodies.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MODEL_ID = "Qwen/Qwen3-8B"
PROTOCOL_VERSION = "buyflow-eventmind-v14-base-runtime-v1"
RUNTIME_VERSION = "eventmind-v14-base-runtime-v1"
TEMPLATE_VERSION = "qwen3-system-user-thinking-off-v1"
MAX_NEW_TOKENS = 48
MAX_REQUEST_BYTES = 256_000
DEFAULT_PORT = 4395
VENV_ROOT = Path.home() / ".venvs" / "buyflow-lora"
VENV_PYTHON = VENV_ROOT / "bin" / "python"


def ensure_runtime() -> None:
    os.environ.setdefault("HSA_ENABLE_DXG_DETECTION", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("HF_HOME", str(Path.home() / ".cache" / "huggingface"))
    if not VENV_PYTHON.is_file():
        raise RuntimeError(f"BuyFlow AI venv missing: {VENV_PYTHON}")
    if Path(sys.prefix).resolve() != VENV_ROOT.resolve():
        os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])


def strict_request(value: Any) -> tuple[str, str] | None:
    if not isinstance(value, dict) or set(value) != {"protocol_version", "system_prompt", "user_prompt", "generation"}:
        return None
    if value.get("protocol_version") != PROTOCOL_VERSION:
        return None
    system_prompt = value.get("system_prompt")
    user_prompt = value.get("user_prompt")
    generation = value.get("generation")
    if not isinstance(system_prompt, str) or not system_prompt.strip():
        return None
    if not isinstance(user_prompt, str) or not user_prompt.strip():
        return None
    if not isinstance(generation, dict) or set(generation) != {"do_sample", "enable_thinking", "max_new_tokens"}:
        return None
    if generation.get("do_sample") is not False:
        return None
    if generation.get("enable_thinking") is not False:
        return None
    if generation.get("max_new_tokens") != MAX_NEW_TOKENS:
        return None
    return system_prompt, user_prompt


class RuntimeState:
    def __init__(self, tokenizer: Any, model: Any):
        self.tokenizer = tokenizer
        self.model = model
        self.lock = threading.Lock()

    def render_prompt(self, system_prompt: str, user_prompt: str) -> str:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        try:
            return self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=False,
            )
        except TypeError as exc:
            raise RuntimeError("TOKENIZER_CANNOT_PROVE_THINKING_OFF") from exc

    def infer(self, system_prompt: str, user_prompt: str) -> str:
        import torch

        prompt = self.render_prompt(system_prompt, user_prompt)
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
    server_version = "BuyFlowEventMindV14Base/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
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
        if self.path != "/health" or STATE is None:
            self._send(404, {"ok": False})
            return
        self._send(200, {
            "ok": True,
            "protocol_version": PROTOCOL_VERSION,
            "model_id": MODEL_ID,
            "adapter": None,
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
        try:
            length = int(self.headers.get("Content-Length") or "0")
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
        system_prompt, user_prompt = parsed
        try:
            output = state.infer(system_prompt, user_prompt)
        except RuntimeError as exc:
            reason = str(exc)
            self._send(503 if reason == "CUDA_OUT_OF_MEMORY" else 500, {"ok": False, "reason": reason})
            return
        except Exception:
            self._send(500, {"ok": False, "reason": "INFERENCE_FAILED"})
            return
        self._send(200, {
            "protocol_version": PROTOCOL_VERSION,
            "model_id": MODEL_ID,
            "adapter": None,
            "runtime_version": RUNTIME_VERSION,
            "template_version": TEMPLATE_VERSION,
            "thinking_enabled": False,
            "deterministic": True,
            "output": output,
        })


def load_model() -> tuple[Any, Any]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise RuntimeError("ROCM_GPU_UNAVAILABLE")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    try:
        tokenizer.apply_chat_template(
            [
                {"role": "system", "content": "You are a classifier."},
                {"role": "user", "content": "health"},
            ],
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
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        quantization_config=quantization,
        device_map={"": 0},
        dtype=torch.float16,
        low_cpu_mem_usage=True,
        local_files_only=True,
    )
    model.eval()
    model.config.use_cache = True
    return tokenizer, model


def main() -> None:
    parser = argparse.ArgumentParser(description="BuyFlow EventMind V14 base Qwen3-8B diagnostic runtime")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    ensure_runtime()
    tokenizer, model = load_model()
    global STATE
    STATE = RuntimeState(tokenizer, model)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"eventmind_v14_base_ready: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        print("eventmind_v14_base_stopped: True", flush=True)


if __name__ == "__main__":
    main()
