#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import time
from pathlib import Path
from typing import Any

BASE_PATH = Path(__file__).with_name('eventmind-v11-runtime.py')
SPEC = importlib.util.spec_from_file_location('buyflow_eventmind_v11_runtime_base', BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('EVENTMIND_BASE_RUNTIME_IMPORT_FAILED')
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)

DIAG_LOG = Path(os.environ.get('BUYFLOW_EVENTMIND_DIAG_LOG', str(Path.home() / 'eventmind-diagnostic.jsonl'))).expanduser()
DIAG_LOG.parent.mkdir(parents=True, exist_ok=True)
_original_infer = base.RuntimeState.infer
_counter = 0


def _gpu_snapshot(torch: Any) -> dict[str, Any]:
    try:
        free_bytes, total_bytes = torch.cuda.mem_get_info()
    except Exception:
        free_bytes, total_bytes = None, None
    return {
        'memory_allocated_bytes': int(torch.cuda.memory_allocated()),
        'memory_reserved_bytes': int(torch.cuda.memory_reserved()),
        'max_memory_allocated_bytes': int(torch.cuda.max_memory_allocated()),
        'free_bytes': int(free_bytes) if free_bytes is not None else None,
        'total_bytes': int(total_bytes) if total_bytes is not None else None,
    }


def _write(record: dict[str, Any]) -> None:
    with DIAG_LOG.open('a', encoding='utf-8') as handle:
        handle.write(json.dumps(record, separators=(',', ':'), ensure_ascii=False) + '\n')
        handle.flush()


def diagnostic_infer(self: Any, user_prompt: str) -> str:
    global _counter
    import torch

    _counter += 1
    inference_id = _counter
    try:
        torch.cuda.synchronize()
    except Exception:
        pass
    try:
        torch.cuda.reset_peak_memory_stats()
    except Exception:
        pass

    started = time.perf_counter()
    _write({
        'event': 'inference_start',
        'inference_id': inference_id,
        'time_unix': time.time(),
        'gpu': _gpu_snapshot(torch),
    })
    try:
        output = _original_infer(self, user_prompt)
        elapsed = time.perf_counter() - started
        _write({
            'event': 'inference_end',
            'inference_id': inference_id,
            'time_unix': time.time(),
            'elapsed_seconds': round(elapsed, 6),
            'gpu': _gpu_snapshot(torch),
        })
        return output
    except Exception as exc:
        elapsed = time.perf_counter() - started
        _write({
            'event': 'inference_error',
            'inference_id': inference_id,
            'time_unix': time.time(),
            'elapsed_seconds': round(elapsed, 6),
            'error_type': type(exc).__name__,
            'error': str(exc)[:300],
            'gpu': _gpu_snapshot(torch),
        })
        raise


base.RuntimeState.infer = diagnostic_infer

if __name__ == '__main__':
    _write({'event': 'diagnostic_runtime_start', 'time_unix': time.time(), 'pid': os.getpid()})
    base.main()
