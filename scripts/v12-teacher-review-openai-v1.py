from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from v11_fresh_blind_config import ALLOWED
from v12_hard_candidates_v1 import build_cases, corpus_sha256

API_URL = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = "gpt-5.6-sol"
DEFAULT_REASONING = "high"

TEACHER_INSTRUCTIONS = """You are the independent semantic teacher for BuyFlow, an email-driven purchase lifecycle classifier.

Classify ONLY what the email explicitly says has most recently/concretely happened. Do not infer a later lifecycle state just because it is likely to happen next. The subject can be stale or misleading. Structured identifiers such as orderNumber, trackingNumber, invoice numbers, payment references, carrier names, domains and technical metadata are identifiers/context, not lifecycle states by themselves.

Legal event types:
ORDER_CREATED = order accepted/placed/created.
ORDER_PROCESSING = order is being processed/prepared administratively, but explicit packing has not begun.
ORDER_PACKING = explicit picking/packing/preparing-the-parcel activity.
SHIPMENT_CREATED = shipment/label/tracking data created or electronically announced, but no physical carrier handoff yet.
SHIPPED = explicit physical handoff/acceptance by carrier or explicit dispatch from merchant.
IN_TRANSIT = parcel is moving through carrier network after shipment, but not yet out for final delivery.
OUT_FOR_DELIVERY = parcel is with final-mile courier / expected for delivery now/today.
READY_FOR_PICKUP = parcel is explicitly available at pickup point/locker/store.
DELIVERED = successful delivery completed.
DELIVERY_FAILED = delivery attempt failed or could not be completed.
DELAYED = explicit delay/postponement while lifecycle otherwise continues.
CANCELLED = order/transaction explicitly cancelled.
REFUNDED = refund completed/issued, not merely requested.
PAYMENT = payment completed/confirmed/received.
INVOICE = invoice issued/available.
RETURN = return initiated/accepted/in progress, not refund completed.
WARRANTY = warranty/guarantee claim or service lifecycle.
OTHER = no sufficiently explicit supported commerce lifecycle event.

Critical boundaries: ORDER_PROCESSING != ORDER_PACKING; SHIPMENT_CREATED != SHIPPED; SHIPPED != IN_TRANSIT; IN_TRANSIT != OUT_FOR_DELIVERY; OUT_FOR_DELIVERY != DELIVERED; READY_FOR_PICKUP != DELIVERED; RETURN != REFUNDED; PAYMENT != INVOICE. Prefer the most recent explicit state, but never promote to a later state without direct evidence.

The case is synthetic/deidentified. Independently judge it; you are deliberately NOT shown the seed label or student prediction. Give only a short evidence-based rationale, not hidden chain-of-thought. If the document does not contain enough explicit evidence for one legal event, set evidence_sufficient=false and choose OTHER.
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "event_type": {"type": "string", "enum": list(ALLOWED)},
        "evidence_sufficient": {"type": "boolean"},
        "confidence": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
        "rationale": {"type": "string"},
    },
    "required": ["event_type", "evidence_sufficient", "confidence", "rationale"],
    "additionalProperties": False,
}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.is_file():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _latest_mine(root: Path) -> tuple[Path, dict[str, Any], list[dict[str, Any]]]:
    out_root = root / "local-data" / "lora-v12" / "teacher-candidates-v1"
    latest = out_root / "LATEST_MINE.txt"
    if not latest.is_file():
        raise RuntimeError(f"V12_LATEST_MINE_MISSING:{latest}")
    run_dir = Path(latest.read_text(encoding="utf-8").strip()).expanduser().resolve()
    metrics_path = run_dir / "metrics.json"
    queue_path = run_dir / "teacher-review-queue.jsonl"
    if not metrics_path.is_file() or not queue_path.is_file():
        raise RuntimeError(f"V12_MINE_INCOMPLETE:{run_dir}")
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if metrics.get("status") != "V12_STUDENT_MINE_V1_COMPLETE":
        raise RuntimeError(f"V12_MINE_STATUS:{metrics.get('status')}")
    expected_sha = corpus_sha256(build_cases())
    if metrics.get("candidate_sha256") != expected_sha:
        raise RuntimeError("V12_CANDIDATE_HASH_MISMATCH")
    queue = _read_jsonl(queue_path)
    if len(queue) != int(metrics.get("teacher_review_queue_count", -1)):
        raise RuntimeError("V12_TEACHER_QUEUE_COUNT_MISMATCH")
    for row in queue:
        if row.get("synthetic") is not True or row.get("deidentified") is not True:
            raise RuntimeError(f"V12_TEACHER_PRIVACY_GATE:{row.get('case_id')}")
        if row.get("train_eligible") is not False:
            raise RuntimeError(f"V12_TEACHER_QUEUE_ALREADY_TRAINABLE:{row.get('case_id')}")
    return run_dir, metrics, queue


def _extract_output_text(response: dict[str, Any]) -> str:
    for item in response.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if isinstance(content, dict) and content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise RuntimeError("OPENAI_TEACHER_OUTPUT_TEXT_MISSING")


def _validate_teacher(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise RuntimeError("OPENAI_TEACHER_NOT_OBJECT")
    if set(obj) != {"event_type", "evidence_sufficient", "confidence", "rationale"}:
        raise RuntimeError("OPENAI_TEACHER_SCHEMA_KEYS")
    if obj.get("event_type") not in ALLOWED:
        raise RuntimeError("OPENAI_TEACHER_EVENT_TYPE")
    if not isinstance(obj.get("evidence_sufficient"), bool):
        raise RuntimeError("OPENAI_TEACHER_EVIDENCE_BOOL")
    if obj.get("confidence") not in {"HIGH", "MEDIUM", "LOW"}:
        raise RuntimeError("OPENAI_TEACHER_CONFIDENCE")
    if not isinstance(obj.get("rationale"), str):
        raise RuntimeError("OPENAI_TEACHER_RATIONALE")
    return obj


def _call_teacher(api_key: str, model: str, reasoning: str, row: dict[str, Any], attempts: int = 5) -> tuple[dict[str, Any], dict[str, Any]]:
    user_text = (
        f"CASE_ID: {row['case_id']}\n"
        f"BOUNDARY_FAMILY: {row['family']}\n"
        f"LANGUAGE_HINT: {row['language']}\n\n"
        "EMAIL_DOCUMENT:\n"
        + json.dumps(row["document"], ensure_ascii=False, separators=(",", ":"))
    )
    payload = {
        "model": model,
        "store": False,
        "reasoning": {"effort": reasoning},
        "instructions": TEACHER_INSTRUCTIONS,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": user_text}]}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "buyflow_teacher_review_v1",
                "strict": True,
                "schema": SCHEMA,
            }
        },
        "max_output_tokens": 500,
        "metadata": {"buyflow_case_id": str(row["case_id"]), "purpose": "v12_teacher_review_v1"},
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                raw = response.read().decode("utf-8")
            envelope = json.loads(raw)
            if envelope.get("status") != "completed":
                raise RuntimeError(f"OPENAI_TEACHER_STATUS:{envelope.get('status')}:{envelope.get('error')}")
            text = _extract_output_text(envelope)
            parsed = _validate_teacher(json.loads(text))
            return parsed, {
                "response_id": envelope.get("id"),
                "usage": envelope.get("usage") or {},
            }
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1200]
            last_error = RuntimeError(f"OPENAI_HTTP_{error.code}:{detail}")
            if error.code not in {408, 409, 429, 500, 502, 503, 504} or attempt == attempts:
                raise last_error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            last_error = error
            if attempt == attempts:
                raise
        time.sleep(min(20.0, 1.5 * (2 ** (attempt - 1))))
    raise RuntimeError(f"OPENAI_TEACHER_FAILED:{last_error}")


def _usage_tokens(meta: dict[str, Any]) -> tuple[int, int, int]:
    usage = meta.get("usage") if isinstance(meta, dict) else {}
    if not isinstance(usage, dict):
        return 0, 0, 0
    return int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0), int(usage.get("total_tokens") or 0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Review V12 synthetic teacher queue with OpenAI Responses API")
    parser.add_argument("project_root")
    parser.add_argument("--model", default=os.environ.get("BUYFLOW_TEACHER_MODEL", DEFAULT_MODEL))
    parser.add_argument("--reasoning", default=os.environ.get("BUYFLOW_TEACHER_REASONING", DEFAULT_REASONING))
    args = parser.parse_args()

    if args.reasoning not in {"none", "low", "medium", "high", "xhigh", "max"}:
        raise RuntimeError(f"INVALID_TEACHER_REASONING:{args.reasoning}")
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY_MISSING")

    root = Path(args.project_root).resolve()
    run_dir, mine_metrics, queue = _latest_mine(root)
    partial_path = run_dir / "teacher-reviews-openai-v1.partial.jsonl"
    existing = _read_jsonl(partial_path)
    by_id = {row["case_id"]: row for row in existing}

    print("# BUYFLOW V12 OPENAI TEACHER REVIEW V1")
    print(f"source_run: {run_dir}")
    print(f"candidate_sha256: {mine_metrics['candidate_sha256']}")
    print(f"queue_cases: {len(queue)}")
    print(f"resume_completed: {len(by_id)}/{len(queue)}")
    print(f"teacher_model: {args.model}")
    print(f"reasoning_effort: {args.reasoning}")
    print("store: False")
    print("synthetic_deidentified_only: True")
    print("seed_and_student_hidden_from_teacher: True")
    print("training: False")

    with partial_path.open("a", encoding="utf-8") as partial:
        for index, row in enumerate(queue, 1):
            if row["case_id"] in by_id:
                continue
            teacher, meta = _call_teacher(api_key, args.model, args.reasoning, row)
            seed_event = row["seed_expected"]["event_type"]
            student_event = row["student_prediction"]["event_type"]
            teacher_event = teacher["event_type"]
            teacher_matches_seed = teacher_event == seed_event
            teacher_matches_student = teacher_event == student_event
            approved = bool(
                teacher_matches_seed
                and teacher["evidence_sufficient"] is True
                and teacher["confidence"] == "HIGH"
            )
            input_tokens, output_tokens, total_tokens = _usage_tokens(meta)
            result = {
                "case_id": row["case_id"],
                "review_reason": row["review_reason"],
                "family": row["family"],
                "language": row["language"],
                "seed_expected": row["seed_expected"],
                "student_prediction": row["student_prediction"],
                "teacher_event_type": teacher_event,
                "teacher_evidence_sufficient": teacher["evidence_sufficient"],
                "teacher_confidence": teacher["confidence"],
                "teacher_rationale": teacher["rationale"],
                "teacher_matches_seed": teacher_matches_seed,
                "teacher_matches_student": teacher_matches_student,
                "teacher_approved_for_augmentation": approved,
                "teacher_model": args.model,
                "teacher_response_id": meta.get("response_id"),
                "usage_input_tokens": input_tokens,
                "usage_output_tokens": output_tokens,
                "usage_total_tokens": total_tokens,
                "synthetic": True,
                "deidentified": True,
                "train_eligible": False,
            }
            partial.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
            partial.flush()
            os.fsync(partial.fileno())
            by_id[row["case_id"]] = result
            print(
                f"case {index}/{len(queue)} {row['case_id']} reason={row['review_reason']} "
                f"seed={seed_event} student={student_event} teacher={teacher_event} "
                f"confidence={teacher['confidence']} sufficient={teacher['evidence_sufficient']} approved={approved}"
            )

    results = [by_id[row["case_id"]] for row in queue]
    reviews_path = run_dir / "teacher-reviews-openai-v1.jsonl"
    with reviews_path.open("w", encoding="utf-8") as handle:
        for row in results:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    reviewed_queue_path = run_dir / "teacher-reviewed-queue-v1.jsonl"
    reviewed_by_id = {row["case_id"]: row for row in results}
    with reviewed_queue_path.open("w", encoding="utf-8") as handle:
        for source in queue:
            review = reviewed_by_id[source["case_id"]]
            merged = {
                **source,
                "teacher_status": "APPROVED_FOR_AUGMENTATION" if review["teacher_approved_for_augmentation"] else "NEEDS_SECONDARY_REVIEW",
                "teacher_label": {
                    "is_commerce": review["teacher_event_type"] != "OTHER",
                    "event_type": review["teacher_event_type"],
                },
                "teacher_rationale": review["teacher_rationale"],
                "teacher_confidence": review["teacher_confidence"],
                "teacher_evidence_sufficient": review["teacher_evidence_sufficient"],
                "teacher_matches_seed": review["teacher_matches_seed"],
                "teacher_matches_student": review["teacher_matches_student"],
                "teacher_model": review["teacher_model"],
                "teacher_response_id": review["teacher_response_id"],
                "train_eligible": False,
            }
            handle.write(json.dumps(merged, ensure_ascii=False, separators=(",", ":")) + "\n")

    approved = sum(1 for row in results if row["teacher_approved_for_augmentation"])
    match_seed = sum(1 for row in results if row["teacher_matches_seed"])
    match_student = sum(1 for row in results if row["teacher_matches_student"])
    insufficient = sum(1 for row in results if not row["teacher_evidence_sufficient"])
    conflicts = len(results) - match_seed
    disagreement_rows = [row for row in results if row["review_reason"] == "STUDENT_DISAGREEMENT"]
    teacher_corrected_student = sum(1 for row in disagreement_rows if row["teacher_matches_seed"] and not row["teacher_matches_student"])
    teacher_backed_student = sum(1 for row in disagreement_rows if row["teacher_matches_student"] and not row["teacher_matches_seed"])
    total_input = sum(int(row["usage_input_tokens"]) for row in results)
    total_output = sum(int(row["usage_output_tokens"]) for row in results)
    total_tokens = sum(int(row["usage_total_tokens"]) for row in results)

    metrics = {
        "status": "V12_OPENAI_TEACHER_REVIEW_V1_COMPLETE",
        "source_run": str(run_dir),
        "candidate_sha256": mine_metrics["candidate_sha256"],
        "queue_count": len(results),
        "teacher_model": args.model,
        "reasoning_effort": args.reasoning,
        "store": False,
        "synthetic_deidentified_only": True,
        "seed_and_student_hidden_from_teacher": True,
        "teacher_matches_seed": match_seed,
        "teacher_matches_student": match_student,
        "teacher_conflicts_with_seed": conflicts,
        "teacher_evidence_insufficient": insufficient,
        "approved_for_augmentation": approved,
        "disagreement_count": len(disagreement_rows),
        "disagreement_teacher_corrected_student": teacher_corrected_student,
        "disagreement_teacher_backed_student": teacher_backed_student,
        "usage_input_tokens": total_input,
        "usage_output_tokens": total_output,
        "usage_total_tokens": total_tokens,
        "training": False,
        "train_eligible": False,
    }
    metrics_path = run_dir / "teacher-review-openai-v1.metrics.json"
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n# SUMMARY")
    print(f"queue_count: {len(results)}")
    print(f"teacher_matches_seed: {match_seed}/{len(results)}")
    print(f"teacher_matches_student: {match_student}/{len(results)}")
    print(f"teacher_conflicts_with_seed: {conflicts}")
    print(f"teacher_evidence_insufficient: {insufficient}")
    print(f"approved_for_augmentation: {approved}/{len(results)}")
    print(f"disagreement_teacher_corrected_student: {teacher_corrected_student}/{len(disagreement_rows)}")
    print(f"disagreement_teacher_backed_student: {teacher_backed_student}/{len(disagreement_rows)}")
    print(f"usage_input_tokens: {total_input}")
    print(f"usage_output_tokens: {total_output}")
    print(f"usage_total_tokens: {total_tokens}")
    print(f"reviewed_queue_file: {reviewed_queue_path}")
    print(f"metrics_file: {metrics_path}")
    print("status: V12_OPENAI_TEACHER_REVIEW_V1_COMPLETE")


if __name__ == "__main__":
    main()
