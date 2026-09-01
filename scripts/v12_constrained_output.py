from __future__ import annotations

import json
import time
from typing import Any, Callable

from v11_fresh_blind_config import ALLOWED


def canonical_prediction(event_type: str) -> dict[str, Any]:
    if event_type not in ALLOWED:
        raise ValueError(f"UNKNOWN_EVENT_TYPE:{event_type}")
    return {
        "is_commerce": event_type != "OTHER",
        "event_type": event_type,
    }


def canonical_text(event_type: str) -> str:
    return json.dumps(canonical_prediction(event_type), ensure_ascii=False, separators=(",", ":"))


def _candidate_token_sequences(tokenizer: Any) -> list[list[int]]:
    eos = tokenizer.eos_token_id
    if eos is None:
        raise RuntimeError("TOKENIZER_EOS_MISSING")

    sequences: list[list[int]] = []
    seen: set[tuple[int, ...]] = set()
    for event_type in ALLOWED:
        text = canonical_text(event_type)
        # The V11 target was exact JSON. Leading whitespace is harmless because
        # strict_prediction() strips it, and allowing it avoids depending on one
        # tokenizer-specific first-token convention.
        for variant in (text, "\n" + text, " " + text):
            token_ids = tokenizer(variant, add_special_tokens=False)["input_ids"]
            seq = tuple(int(token) for token in token_ids + [eos])
            if seq not in seen:
                seen.add(seq)
                sequences.append(list(seq))
    if not sequences:
        raise RuntimeError("NO_CONSTRAINED_OUTPUT_CANDIDATES")
    return sequences


def build_prefix_allowed_tokens_fn(tokenizer: Any, prompt_length: int) -> tuple[Callable[[int, Any], list[int]], int]:
    sequences = _candidate_token_sequences(tokenizer)
    max_new_tokens = max(len(sequence) for sequence in sequences)
    eos = int(tokenizer.eos_token_id)

    def allowed_tokens(_batch_id: int, input_ids: Any) -> list[int]:
        generated = [int(token) for token in input_ids[prompt_length:].tolist()]
        next_tokens: set[int] = set()
        for sequence in sequences:
            if len(generated) <= len(sequence) and sequence[: len(generated)] == generated:
                if len(generated) < len(sequence):
                    next_tokens.add(int(sequence[len(generated)]))
        # This should never be needed when generation follows the trie, but fail
        # closed to EOS rather than reopening unconstrained vocabulary.
        return sorted(next_tokens) if next_tokens else [eos]

    return allowed_tokens, max_new_tokens


def infer_constrained(tokenizer: Any, model: Any, prompt: str) -> tuple[str, float]:
    import torch

    encoded = tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
    encoded = {key: value.to("cuda") for key, value in encoded.items()}
    prompt_length = int(encoded["input_ids"].shape[1])
    prefix_allowed_tokens_fn, max_new_tokens = build_prefix_allowed_tokens_fn(tokenizer, prompt_length)

    started = time.perf_counter()
    with torch.inference_mode():
        output = model.generate(
            **encoded,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
            eos_token_id=tokenizer.eos_token_id,
            prefix_allowed_tokens_fn=prefix_allowed_tokens_fn,
        )
    torch.cuda.synchronize()
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    generated = output[0, prompt_length:]
    return tokenizer.decode(generated, skip_special_tokens=True), elapsed_ms
