from __future__ import annotations

import os

MODEL_ID = os.environ.get("BUYFLOW_LORA_MODEL_ID", "Qwen/Qwen3-8B")
SEED = 20260831
CASES_PER_EVENT = 10
MAX_PROMPT_TOKENS = 700
MAX_NEW_TOKENS = 48
EXPECTED_FIXTURE_SHA256 = "6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251"
ALLOWED = [
    "ORDER_CREATED", "ORDER_PROCESSING", "ORDER_PACKING", "SHIPMENT_CREATED", "SHIPPED", "IN_TRANSIT",
    "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED", "DELIVERY_FAILED", "DELAYED", "CANCELLED",
    "REFUNDED", "PAYMENT", "INVOICE", "RETURN", "WARRANTY", "OTHER",
]
LANGS = ["hu", "en", "de", "pl", "fr", "es"]
INSTRUCTION = (
    "Classify the latest concrete lifecycle state from this NormalizedEmailDocument. "
    "The subject may be stale or misleading. Structured keys such as orderNumber and trackingNumber are identifiers, "
    "not lifecycle states. Prefer explicit current-state evidence in text/HTML/structured data. "
    "Return JSON only with is_commerce and event_type."
)
