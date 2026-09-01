from __future__ import annotations

import json
import re
from html import unescape
from html.parser import HTMLParser
from typing import Any

from v11_fresh_blind_config import INSTRUCTION, MAX_PROMPT_TOKENS
from v11_fresh_blind_model import tokenizer_template


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript"}:
            self._hidden_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript"} and self._hidden_depth:
            self._hidden_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._hidden_depth and data.strip():
            self.parts.append(data)


def _compact_whitespace(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"\s+", " ", unescape(value)).strip()
    return text or None


def html_visible_text(value: str | None) -> str | None:
    if not value:
        return None
    parser = _VisibleTextParser()
    parser.feed(value)
    parser.close()
    return _compact_whitespace(" ".join(parser.parts))


def _sender_view(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    output: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        record: dict[str, str] = {}
        name = item.get("name")
        email = item.get("email")
        if isinstance(name, str) and name.strip():
            record["name"] = name.strip()
        if isinstance(email, str) and email.strip():
            record["email"] = email.strip()
        if record:
            output.append(record)
    return output


def _structured_view(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    output: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        record: dict[str, Any] = {}
        schema_type = item.get("schemaType")
        source = item.get("source")
        payload = item.get("payload")
        if isinstance(schema_type, str) and schema_type:
            record["schemaType"] = schema_type
        if isinstance(source, str) and source:
            record["source"] = source
        if isinstance(payload, dict) and payload:
            record["payload"] = payload
        if record:
            output.append(record)
    return output


def _link_view(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    output: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        record: dict[str, Any] = {}
        for key in ("text", "href", "rel"):
            value = item.get(key)
            if value not in (None, "", []):
                record[key] = value
        if record:
            output.append(record)
    return output


def _attachment_view(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    output: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        record: dict[str, Any] = {}
        for key in ("filename", "contentType", "isInline"):
            value = item.get(key)
            if value not in (None, ""):
                record[key] = value
        if record:
            output.append(record)
    return output


def build_semantic_email_view(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "viewVersion": "BuyFlowSemanticEmailViewV1",
        "subject": _compact_whitespace(document.get("subject")),
        "from": _sender_view(document.get("from")),
        "receivedAt": document.get("receivedAt"),
        "snippet": _compact_whitespace(document.get("snippet")),
        "bodyText": document.get("bodyText"),
        "bodyHtmlVisibleText": html_visible_text(document.get("bodyHtml")),
        "structuredData": _structured_view(document.get("structuredData")),
        "links": _link_view(document.get("links")),
        "attachments": _attachment_view(document.get("attachments")),
    }


def semantic_prompt_for_case(tokenizer: Any, case: dict[str, Any]) -> tuple[str, int]:
    view = build_semantic_email_view(case["document"])
    payload = json.dumps(view, ensure_ascii=False, separators=(",", ":"))
    user = f"{INSTRUCTION}\n\nEMAIL_DOCUMENT:\n{payload}"
    prompt = tokenizer_template(tokenizer, [{"role": "user", "content": user}], True)
    token_count = len(tokenizer(prompt, add_special_tokens=False)["input_ids"])
    if token_count > MAX_PROMPT_TOKENS:
        raise RuntimeError(
            f"SEMANTIC_PROMPT_TOO_LONG {case['case_id']}: {token_count}>{MAX_PROMPT_TOKENS}"
        )
    return prompt, token_count
