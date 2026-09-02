from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from v11_fresh_blind_config import ALLOWED, INSTRUCTION
from v11_fresh_blind_model import resolve_adapter

EXPECTED_V11_TRAIN = 5760
EXPECTED_V11_VALIDATION = 576
REPLAY_TRAIN_PER_EVENT = 64
REPLAY_VALIDATION_PER_EVENT = 16
HARD_CORPUS_SHA = "f5e255b42bf460d02c9854ca5dced93b774ffc785dec8680a1408a52d6cea9cf"

UNSAFE_PATH_TOKENS = (
    "fresh-blind",
    "fresh_blind",
    "input-view",
    "input_view",
    "holdout",
    "blind50",
    "blind_50",
    "frozen108",
    "frozen_108",
    "locked-test",
    "locked_test",
    "teacher-candidates",
    "teacher_candidates",
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_row_hash(row: dict[str, Any]) -> str:
    raw = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _is_safe_path(path: Path, base: Path) -> bool:
    try:
        rel = str(path.resolve().relative_to(base.resolve())).lower()
    except Exception:
        rel = str(path.resolve()).lower()
    return not any(token in rel for token in UNSAFE_PATH_TOKENS)


def _iter_metric_strings(obj: Any, key_path: str = "") -> Iterable[tuple[str, str]]:
    if isinstance(obj, dict):
        for key, value in obj.items():
            next_key = f"{key_path}.{key}" if key_path else str(key)
            yield from _iter_metric_strings(value, next_key)
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            yield from _iter_metric_strings(value, f"{key_path}[{index}]")
    elif isinstance(obj, str):
        yield key_path, obj


def _resolve_metric_path(value: str, project_root: Path) -> Path | None:
    candidates = [Path(value).expanduser()]
    if not Path(value).is_absolute():
        candidates.append(project_root / value)
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except Exception:
            continue
        if resolved.is_file():
            return resolved
    return None


def _read_json_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if path.suffix.lower() == ".jsonl":
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    row = json.loads(line)
                    if isinstance(row, dict):
                        rows.append(row)
        return rows
    if path.suffix.lower() == ".json":
        obj = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(obj, list):
            return [row for row in obj if isinstance(row, dict)]
        if isinstance(obj, dict):
            for key in ("rows", "data", "train", "validation", "examples"):
                value = obj.get(key)
                if isinstance(value, list):
                    return [row for row in value if isinstance(row, dict)]
    return rows


def _event_type(row: dict[str, Any]) -> str | None:
    direct = row.get("event_type")
    if direct in ALLOWED:
        return str(direct)
    expected = row.get("expected")
    if isinstance(expected, dict) and expected.get("event_type") in ALLOWED:
        return str(expected["event_type"])
    for key in ("output", "target", "response", "assistant", "label"):
        value = row.get(key)
        if isinstance(value, dict) and value.get("event_type") in ALLOWED:
            return str(value["event_type"])
        if isinstance(value, str):
            try:
                obj = json.loads(value.strip())
            except Exception:
                obj = None
            if isinstance(obj, dict) and obj.get("event_type") in ALLOWED:
                return str(obj["event_type"])
    return None


def _distribution(rows: list[dict[str, Any]]) -> Counter[str]:
    return Counter(event for row in rows if (event := _event_type(row)) is not None)


def _looks_like_v11_train(rows: list[dict[str, Any]]) -> bool:
    dist = _distribution(rows)
    return len(rows) == EXPECTED_V11_TRAIN and set(dist) == set(ALLOWED) and all(dist[event] == 320 for event in ALLOWED)


def _looks_like_v11_validation(rows: list[dict[str, Any]]) -> bool:
    dist = _distribution(rows)
    return len(rows) == EXPECTED_V11_VALIDATION and set(dist) == set(ALLOWED) and all(dist[event] == 32 for event in ALLOWED)


def _discovery_roots(project_root: Path) -> list[Path]:
    roots: list[Path] = []
    for candidate in (
        project_root / "local-data",
        project_root / "data",
        project_root / "training-data",
        project_root / "artifacts",
    ):
        if candidate.is_dir():
            roots.append(candidate.resolve())
    if not roots:
        raise RuntimeError(f"V11_DISCOVERY_ROOTS_MISSING:{project_root}")
    return roots


def _discover_v11_corpora(project_root: Path, v11_metrics: dict[str, Any]) -> tuple[Path, list[dict[str, Any]], Path, list[dict[str, Any]]]:
    roots = _discovery_roots(project_root)
    safety_base = project_root.resolve()

    candidates: dict[Path, str] = {}
    for key, value in _iter_metric_strings(v11_metrics):
        key_lower = key.lower()
        if not any(token in key_lower for token in ("train", "valid", "corpus", "dataset", "data")):
            continue
        resolved = _resolve_metric_path(value, project_root)
        if resolved and resolved.suffix.lower() in {".jsonl", ".json"} and _is_safe_path(resolved, safety_base):
            candidates[resolved] = f"metrics:{key}"

    for search_root in roots:
        for pattern in ("*.jsonl", "*.json"):
            for path in search_root.rglob(pattern):
                if not _is_safe_path(path, safety_base):
                    continue
                name = path.name.lower()
                if any(token in name for token in ("train", "valid", "corpus", "dataset")):
                    candidates.setdefault(path.resolve(), f"safe_filename_scan:{search_root.name}")

    train_matches: list[tuple[Path, list[dict[str, Any]]]] = []
    validation_matches: list[tuple[Path, list[dict[str, Any]]]] = []
    inspected: list[str] = []
    for path in sorted(candidates):
        try:
            rows = _read_json_rows(path)
        except Exception as exc:
            inspected.append(f"{path} -> READ_ERROR:{type(exc).__name__}")
            continue
        dist = _distribution(rows)
        inspected.append(f"{path} -> rows={len(rows)} labels={len(dist)}")
        if _looks_like_v11_train(rows):
            train_matches.append((path, rows))
        if _looks_like_v11_validation(rows):
            validation_matches.append((path, rows))

    if len(train_matches) != 1 or len(validation_matches) != 1:
        detail = "\n".join(inspected[:120])
        roots_text = ", ".join(str(root) for root in roots)
        raise RuntimeError(
            "V11_CORPUS_DISCOVERY_FAILED: "
            f"train_matches={len(train_matches)} validation_matches={len(validation_matches)} "
            f"roots=[{roots_text}]\n{detail}"
        )
    return train_matches[0][0], train_matches[0][1], validation_matches[0][0], validation_matches[0][1]


def _normalize_sft(row: dict[str, Any], source: str) -> dict[str, Any]:
    event = _event_type(row)
    if event not in ALLOWED:
        raise RuntimeError("ROW_EVENT_MISSING")

    instruction = row.get("instruction", INSTRUCTION)
    input_value = row.get("input")
    if input_value is None and isinstance(row.get("document"), dict):
        input_value = json.dumps(row["document"], ensure_ascii=False, separators=(",", ":"))
    if isinstance(input_value, (dict, list)):
        input_value = json.dumps(input_value, ensure_ascii=False, separators=(",", ":"))
    if not isinstance(input_value, str) or not input_value.strip():
        raise RuntimeError("ROW_INPUT_MISSING")

    output_value = row.get("output")
    if isinstance(output_value, dict):
        output_value = json.dumps(output_value, ensure_ascii=False, separators=(",", ":"))
    if not isinstance(output_value, str):
        expected = row.get("expected")
        if isinstance(expected, dict):
            output_value = json.dumps(expected, ensure_ascii=False, separators=(",", ":"))
        else:
            output_value = json.dumps(
                {"is_commerce": event != "OTHER", "event_type": event},
                ensure_ascii=False,
                separators=(",", ":"),
            )

    canonical_output = json.dumps(
        {"is_commerce": event != "OTHER", "event_type": event},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if json.loads(output_value.strip()) != json.loads(canonical_output):
        raise RuntimeError(f"ROW_OUTPUT_MISMATCH:{event}")

    digest = hashlib.sha256((str(instruction) + "\n" + input_value + "\n" + canonical_output).encode("utf-8")).hexdigest()
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    metadata = dict(metadata)
    metadata.update({"v12_source": source, "v12_replay": source.startswith("V11_")})
    return {
        "instruction": str(instruction),
        "input": input_value,
        "output": canonical_output,
        "case_id": str(row.get("case_id") or f"{source}-{digest[:16]}"),
        "metadata": metadata,
    }


def _sample_per_event(rows: list[dict[str, Any]], count: int, source: str) -> list[dict[str, Any]]:
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for raw in rows:
        normalized = _normalize_sft(raw, source)
        event = json.loads(normalized["output"])["event_type"]
        buckets[event].append(normalized)

    selected: list[dict[str, Any]] = []
    for event in ALLOWED:
        bucket = sorted(buckets[event], key=canonical_row_hash)
        if len(bucket) < count:
            raise RuntimeError(f"REPLAY_BUCKET_TOO_SMALL:{event}:{len(bucket)}<{count}")
        selected.extend(bucket[:count])
    return selected


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build V12 retention replay + hard-sibling training merge")
    parser.add_argument("project_root")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    v11_run, _adapter, v11_metrics = resolve_adapter(root, None)

    hard_root = root / "local-data" / "lora-v12" / "hard-siblings-v2"
    hard_sha_path = hard_root / "CORPUS_SHA256.txt"
    hard_train_path = hard_root / "train.sft.jsonl"
    hard_validation_path = hard_root / "validation.sft.jsonl"
    if not hard_sha_path.is_file() or hard_sha_path.read_text(encoding="utf-8").strip() != HARD_CORPUS_SHA:
        raise RuntimeError("HARD_CORPUS_SHA_MISMATCH")
    hard_train = _read_json_rows(hard_train_path)
    hard_validation = _read_json_rows(hard_validation_path)
    if len(hard_train) != 144 or len(hard_validation) != 72:
        raise RuntimeError(f"HARD_CORPUS_COUNTS:{len(hard_train)}/{len(hard_validation)}")

    v11_train_path, v11_train, v11_validation_path, v11_validation = _discover_v11_corpora(root, v11_metrics)
    replay_train = _sample_per_event(v11_train, REPLAY_TRAIN_PER_EVENT, "V11_REPLAY_TRAIN")
    replay_validation = _sample_per_event(v11_validation, REPLAY_VALIDATION_PER_EVENT, "V11_REPLAY_VALIDATION")
    hard_train_norm = [_normalize_sft(row, "V12_HARD_TRAIN") for row in hard_train]
    hard_validation_norm = [_normalize_sft(row, "V12_HARD_VALIDATION") for row in hard_validation]

    merged_train = replay_train + hard_train_norm
    merged_validation = replay_validation + hard_validation_norm

    train_hashes = {canonical_row_hash(row) for row in merged_train}
    val_hashes = {canonical_row_hash(row) for row in merged_validation}
    if train_hashes & val_hashes:
        raise RuntimeError(f"MERGED_TRAIN_VALIDATION_EXACT_OVERLAP:{len(train_hashes & val_hashes)}")

    train_dist = Counter(json.loads(row["output"])["event_type"] for row in merged_train)
    val_dist = Counter(json.loads(row["output"])["event_type"] for row in merged_validation)
    expected_train = {event: REPLAY_TRAIN_PER_EVENT for event in ALLOWED}
    expected_val = {event: REPLAY_VALIDATION_PER_EVENT for event in ALLOWED}
    for event in ("ORDER_PROCESSING", "ORDER_PACKING"):
        expected_train[event] += 72
        expected_val[event] += 36
    if dict(train_dist) != expected_train:
        raise RuntimeError(f"MERGED_TRAIN_DISTRIBUTION:{dict(train_dist)}")
    if dict(val_dist) != expected_val:
        raise RuntimeError(f"MERGED_VALIDATION_DISTRIBUTION:{dict(val_dist)}")

    out = root / "local-data" / "lora-v12" / "retention-replay-v1"
    out.mkdir(parents=True, exist_ok=True)
    train_out = out / "train.merged.sft.jsonl"
    val_out = out / "validation.merged.sft.jsonl"
    _write_jsonl(train_out, merged_train)
    _write_jsonl(val_out, merged_validation)

    manifest = {
        "status": "V12_RETENTION_REPLAY_V1_READY",
        "training_started": False,
        "v11_run": str(v11_run),
        "v11_train_source": str(v11_train_path),
        "v11_validation_source": str(v11_validation_path),
        "v11_train_source_sha256": sha256_file(v11_train_path),
        "v11_validation_source_sha256": sha256_file(v11_validation_path),
        "hard_corpus_sha256": HARD_CORPUS_SHA,
        "replay_train_per_event": REPLAY_TRAIN_PER_EVENT,
        "replay_validation_per_event": REPLAY_VALIDATION_PER_EVENT,
        "replay_train_rows": len(replay_train),
        "hard_train_rows": len(hard_train_norm),
        "merged_train_rows": len(merged_train),
        "replay_validation_rows": len(replay_validation),
        "hard_validation_rows": len(hard_validation_norm),
        "merged_validation_rows": len(merged_validation),
        "train_distribution": dict(train_dist),
        "validation_distribution": dict(val_dist),
        "exact_train_validation_overlap": 0,
        "frozen_holdouts_read": False,
        "fresh_blind_read": False,
        "input_view_holdout_read": False,
        "frozen108_read": False,
        "blind50_read": False,
        "purpose": "retain all 18 V11 classes while oversampling confirmed ORDER_PROCESSING/ORDER_PACKING hard boundary",
    }
    manifest_path = out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "TRAIN_SHA256.txt").write_text(sha256_file(train_out) + "\n", encoding="utf-8")
    (out / "VALIDATION_SHA256.txt").write_text(sha256_file(val_out) + "\n", encoding="utf-8")

    print("# BUYFLOW V12 RETENTION REPLAY V1")
    print(f"status: {manifest['status']}")
    print(f"v11_train_source: {v11_train_path}")
    print(f"v11_validation_source: {v11_validation_path}")
    print(f"replay_train_rows: {len(replay_train)}")
    print(f"hard_train_rows: {len(hard_train_norm)}")
    print(f"merged_train_rows: {len(merged_train)}")
    print(f"replay_validation_rows: {len(replay_validation)}")
    print(f"hard_validation_rows: {len(hard_validation_norm)}")
    print(f"merged_validation_rows: {len(merged_validation)}")
    print(f"train_order_processing: {train_dist['ORDER_PROCESSING']}")
    print(f"train_order_packing: {train_dist['ORDER_PACKING']}")
    print(f"train_other_event_each: {REPLAY_TRAIN_PER_EVENT}")
    print(f"validation_order_processing: {val_dist['ORDER_PROCESSING']}")
    print(f"validation_order_packing: {val_dist['ORDER_PACKING']}")
    print(f"validation_other_event_each: {REPLAY_VALIDATION_PER_EVENT}")
    print("exact_train_validation_overlap: 0")
    print("frozen_holdouts_read: False")
    print(f"train_sha256: {sha256_file(train_out)}")
    print(f"validation_sha256: {sha256_file(val_out)}")
    print(f"manifest_file: {manifest_path}")
    print("training_started: False")


if __name__ == "__main__":
    main()
