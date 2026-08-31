from __future__ import annotations

import math
from collections import Counter, defaultdict
from typing import Any

from v11_fresh_blind_config import ALLOWED

UNSAFE_PROMOTIONS = {
    "ORDER_PACKING": {"SHIPMENT_CREATED", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED"},
    "SHIPMENT_CREATED": {"SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED"},
    "SHIPPED": {"OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED"},
    "IN_TRANSIT": {"OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED"},
    "OUT_FOR_DELIVERY": {"DELIVERED"},
    "READY_FOR_PICKUP": {"DELIVERED"},
    "RETURN": {"REFUNDED"},
    "CANCELLED": {"REFUNDED"},
}

CRITICAL_PAIRS = {
    frozenset(("ORDER_PROCESSING", "ORDER_PACKING")),
    frozenset(("ORDER_PACKING", "SHIPMENT_CREATED")),
    frozenset(("SHIPMENT_CREATED", "SHIPPED")),
    frozenset(("SHIPPED", "IN_TRANSIT")),
    frozenset(("IN_TRANSIT", "OUT_FOR_DELIVERY")),
    frozenset(("OUT_FOR_DELIVERY", "DELIVERED")),
    frozenset(("READY_FOR_PICKUP", "DELIVERED")),
    frozenset(("DELAYED", "DELIVERY_FAILED")),
    frozenset(("RETURN", "REFUNDED")),
    frozenset(("PAYMENT", "INVOICE")),
}


def score(cases: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(cases)
    exact = 0
    commerce_correct = 0
    invalid = 0
    incoherent = 0
    unsafe: list[dict[str, str]] = []
    other_false_commerce: list[str] = []
    critical: list[dict[str, str]] = []
    per_event_total: Counter[str] = Counter()
    per_event_exact: Counter[str] = Counter()
    confusion: dict[str, Counter[str]] = defaultdict(Counter)
    latencies: list[float] = []

    for case, row in zip(cases, rows):
        expected = case["expected"]
        expected_event = expected["event_type"]
        per_event_total[expected_event] += 1
        pred = row.get("prediction")
        if row.get("error"):
            invalid += 1
            confusion[expected_event]["INVALID_OUTPUT"] += 1
            continue
        assert isinstance(pred, dict)
        latencies.append(float(row["latency_ms"]))
        if pred["is_commerce"] == expected["is_commerce"]:
            commerce_correct += 1
        if pred["is_commerce"] != (pred["event_type"] != "OTHER"):
            incoherent += 1
        predicted_event = pred["event_type"]
        confusion[expected_event][predicted_event] += 1
        if pred == expected:
            exact += 1
            per_event_exact[expected_event] += 1
            continue
        if expected_event == "OTHER" and pred["is_commerce"]:
            other_false_commerce.append(case["case_id"])
        if predicted_event in UNSAFE_PROMOTIONS.get(expected_event, set()):
            unsafe.append({"case_id": case["case_id"], "expected": expected_event, "predicted": predicted_event})
        if frozenset((expected_event, predicted_event)) in CRITICAL_PAIRS:
            critical.append({"case_id": case["case_id"], "expected": expected_event, "predicted": predicted_event})

    per_event: dict[str, dict[str, float | int]] = {}
    event_accuracies: list[float] = []
    for event in ALLOWED:
        count = per_event_total[event]
        correct = per_event_exact[event]
        accuracy = correct / count if count else 0.0
        event_accuracies.append(accuracy)
        per_event[event] = {"correct": correct, "total": count, "accuracy": accuracy}

    exact_accuracy = exact / total
    commerce_accuracy = commerce_correct / total
    macro_accuracy = sum(event_accuracies) / len(event_accuracies)
    sorted_latency = sorted(latencies)
    p50 = sorted_latency[len(sorted_latency) // 2] if sorted_latency else None
    p95 = sorted_latency[max(0, math.ceil(len(sorted_latency) * 0.95) - 1)] if sorted_latency else None

    gate_pass = (
        invalid == 0
        and incoherent == 0
        and not unsafe
        and not other_false_commerce
        and exact_accuracy >= 0.90
        and macro_accuracy >= 0.85
    )
    return {
        "gate": "PASS" if gate_pass else "FAIL",
        "total": total,
        "exact_correct": exact,
        "exact_accuracy": exact_accuracy,
        "commerce_correct": commerce_correct,
        "commerce_accuracy": commerce_accuracy,
        "macro_event_accuracy": macro_accuracy,
        "invalid_output_count": invalid,
        "incoherent_output_count": incoherent,
        "unsafe_promotion_count": len(unsafe),
        "unsafe_promotions": unsafe,
        "other_false_commerce_count": len(other_false_commerce),
        "other_false_commerce_cases": other_false_commerce,
        "critical_boundary_error_count": len(critical),
        "critical_boundary_errors": critical,
        "latency_ms_p50": p50,
        "latency_ms_p95": p95,
        "per_event": per_event,
        "confusion": {event: dict(values) for event, values in confusion.items()},
        "gate_requirements": {
            "invalid_output_count": 0,
            "incoherent_output_count": 0,
            "unsafe_promotion_count": 0,
            "other_false_commerce_count": 0,
            "exact_accuracy_min": 0.90,
            "macro_event_accuracy_min": 0.85,
        },
    }
