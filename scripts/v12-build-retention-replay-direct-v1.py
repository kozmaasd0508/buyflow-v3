from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


def _load_base() -> Any:
    here = Path(__file__).resolve().parent
    base_path = here / "v12-build-retention-replay-v1.py"
    spec = importlib.util.spec_from_file_location("v12_retention_replay_base", base_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"V12_BASE_IMPORT_FAILED:{base_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    base = _load_base()

    def _direct_discovery(project_root: Path, _v11_metrics: dict[str, Any]):
        corpus_root = project_root / "local-data" / "training-v11-normalized-semantic"
        train_path = corpus_root / "classification.train.jsonl"
        validation_path = corpus_root / "classification.validation.jsonl"

        print("v11_corpus_mode: CANONICAL_DIRECT_PATH", flush=True)
        print(f"v11_corpus_root: {corpus_root}", flush=True)

        missing = [str(path) for path in (train_path, validation_path) if not path.is_file()]
        if missing:
            raise RuntimeError("V11_CANONICAL_CORPUS_MISSING:" + "|".join(missing))

        train_rows = base._read_json_rows(train_path)
        validation_rows = base._read_json_rows(validation_path)
        print(f"v11_train_rows_found: {len(train_rows)}", flush=True)
        print(f"v11_validation_rows_found: {len(validation_rows)}", flush=True)

        if not base._looks_like_v11_train(train_rows):
            raise RuntimeError(f"V11_CANONICAL_TRAIN_SIGNATURE_FAILED:{train_path}:{len(train_rows)}")
        if not base._looks_like_v11_validation(validation_rows):
            raise RuntimeError(
                f"V11_CANONICAL_VALIDATION_SIGNATURE_FAILED:{validation_path}:{len(validation_rows)}"
            )

        print("v11_corpus_signature: PASS_18_EVENTS_BALANCED", flush=True)
        return train_path, train_rows, validation_path, validation_rows

    base._discover_v11_corpora = _direct_discovery
    base.main()


if __name__ == "__main__":
    main()
