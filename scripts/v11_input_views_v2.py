from __future__ import annotations

import json
from typing import Any

from v11_fresh_blind_config import INSTRUCTION, MAX_PROMPT_TOKENS
from v11_fresh_blind_model import prompt_for_case, tokenizer_template
from v11_semantic_view_v1 import build_semantic_email_view, html_visible_text


def _first_sender_domain(document: dict[str, Any]) -> str | None:
    raw = document.get("from")
    if not isinstance(raw, list) or not raw or not isinstance(raw[0], dict):
        return None
    email = raw[0].get("email")
    if not isinstance(email, str) or "@" not in email:
        return None
    return email.rsplit("@", 1)[1].lower()


def _walk_identifiers(value: Any, output: dict[str, list[str]]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"orderNumber", "trackingNumber", "confirmationNumber"} and isinstance(item, (str, int, float)):
                output.setdefault(key, []).append(str(item))
            else:
                _walk_identifiers(item, output)
    elif isinstance(value, list):
        for item in value:
            _walk_identifiers(item, output)


def build_minimal_email_view(document: dict[str, Any]) -> dict[str, Any]:
    identifiers: dict[str, list[str]] = {}
    _walk_identifiers(document.get("structuredData"), identifiers)
    attachments = []
    for item in document.get("attachments") or []:
        if isinstance(item, dict):
            attachments.append({
                "filename": item.get("filename"),
                "contentType": item.get("contentType"),
            })
    return {
        "viewVersion": "BuyFlowMinimalEmailViewV1",
        "senderDomain": _first_sender_domain(document),
        "subject": document.get("subject"),
        "bodyText": document.get("bodyText"),
        "bodyHtmlVisibleText": html_visible_text(document.get("bodyHtml")),
        "identifiers": identifiers,
        "attachments": attachments,
    }


def _prompt_for_payload(tokenizer: Any, case_id: str, payload: dict[str, Any]) -> tuple[str, int]:
    encoded_payload = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    user = f"{INSTRUCTION}\n\nEMAIL_DOCUMENT:\n{encoded_payload}"
    prompt = tokenizer_template(tokenizer, [{"role":"user","content":user}], True)
    token_count = len(tokenizer(prompt, add_special_tokens=False)["input_ids"])
    if token_count > MAX_PROMPT_TOKENS:
        raise RuntimeError(f"INPUT_VIEW_PROMPT_TOO_LONG {case_id}: {token_count}>{MAX_PROMPT_TOKENS}")
    return prompt, token_count


def full_prompt(tokenizer: Any, case: dict[str, Any]) -> tuple[str, int]:
    return prompt_for_case(tokenizer, case)


def semantic_prompt(tokenizer: Any, case: dict[str, Any]) -> tuple[str, int]:
    return _prompt_for_payload(tokenizer, case["case_id"], build_semantic_email_view(case["document"]))


def minimal_prompt(tokenizer: Any, case: dict[str, Any]) -> tuple[str, int]:
    return _prompt_for_payload(tokenizer, case["case_id"], build_minimal_email_view(case["document"]))
