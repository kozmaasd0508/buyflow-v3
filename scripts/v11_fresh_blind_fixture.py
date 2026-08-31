from __future__ import annotations

import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from v11_fresh_blind_config import ALLOWED, CASES_PER_EVENT, LANGS, SEED
from v11_fresh_blind_corpus import CARRIERS, CONFUSER, FAMILY, MERCHANTS, PHRASES


def stable_id(prefix: str, rng: random.Random, digits: int) -> str:
    return prefix + "-" + "".join(str(rng.randrange(10)) for _ in range(digits))


def auth_headers(domain: str) -> list[dict[str, str]]:
    value = (
        f"mx.buyflow.invalid; dkim=pass header.d={domain}; "
        f"spf=pass smtp.mailfrom={domain}; dmarc=pass header.from={domain}"
    )
    return [
        {"name": "Authentication-Results", "value": value},
        {"name": "Content-Language", "value": "und"},
    ]


def event_tracking(event: str, rng: random.Random) -> str | None:
    if event in {
        "SHIPMENT_CREATED", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY",
        "READY_FOR_PICKUP", "DELIVERED", "DELIVERY_FAILED", "DELAYED",
    }:
        return stable_id("PK", rng, 11)
    return None


def structured_records(event: str, order_id: str, tracking_id: str | None, merchant: str, carrier: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if event != "OTHER":
        records.append({
            "kind": "json_ld",
            "schemaType": "Order",
            "payload": {
                "@context": "https://schema.org",
                "@type": "Order",
                "orderNumber": order_id,
                "merchant": {"@type": "Organization", "name": merchant},
            },
            "source": "body_html",
        })
    if tracking_id:
        records.append({
            "kind": "schema_org",
            "schemaType": "ParcelDelivery",
            "payload": {
                "@type": "ParcelDelivery",
                "trackingNumber": tracking_id,
                "provider": {"name": carrier},
            },
            "source": "body_html",
        })
    if event == "INVOICE":
        records.append({
            "kind": "json_ld",
            "schemaType": "Invoice",
            "payload": {"@type": "Invoice", "confirmationNumber": f"INV-{order_id[-6:]}"},
            "source": "body_html",
        })
    if event == "OTHER":
        records.append({
            "kind": "json_ld",
            "schemaType": "Product",
            "payload": {
                "@type": "Product",
                "name": "Weekend Special",
                "offers": {"@type": "Offer", "price": "39.90", "priceCurrency": "EUR"},
            },
            "source": "body_html",
        })
    return records


def make_case(event: str, index: int, case_no: int) -> dict[str, Any]:
    rng = random.Random(SEED + ALLOWED.index(event) * 10007 + index * 197)
    lang = LANGS[index % len(LANGS)]
    merchant = MERCHANTS[(index + ALLOWED.index(event)) % len(MERCHANTS)]
    carrier = CARRIERS[(index * 3 + ALLOWED.index(event)) % len(CARRIERS)]
    domain = merchant.lower().replace(" ", "-") + ".example"
    order_id = stable_id("O", rng, 8)
    tracking_id = event_tracking(event, rng)
    phrase = PHRASES[event][lang]
    confuser = PHRASES[CONFUSER[event]][lang]
    mode = index % 10

    subject = phrase
    snippet = phrase
    body_text: str | None = phrase
    body_html: str | None = None

    if event == "OTHER":
        body_text = f"{phrase} This is an account or promotional notice, not a placed order or parcel lifecycle update."
        if mode in {1, 6}:
            subject = PHRASES["ORDER_CREATED"][lang]
        elif mode in {2, 7}:
            subject = f"Order status / account notice {order_id}"
        else:
            subject = phrase
        if mode == 3:
            body_text = "Account notice. The current non-commerce message is in the HTML block."
            body_html = f"<section><div data-current-state='1'>{phrase}</div><small>No order was placed.</small></section>"
        elif mode == 7:
            body_text += f"\n\n> old quoted commerce-looking text: {PHRASES['ORDER_CREATED'][lang]}"
    else:
        if mode == 0:
            subject = phrase
        elif mode == 1:
            subject = confuser
            body_text = f"CURRENT STATUS: {phrase} Earlier notification (obsolete): {confuser}"
        elif mode == 2:
            subject = f"Status update {order_id}"
            body_text = f"{phrase} Important boundary: this message does NOT establish the following state: {confuser}"
        elif mode == 3:
            subject = f"Status details {order_id}"
            body_text = "The current lifecycle state is shown in the HTML status block below."
            body_html = f"<section><h2>Current status</h2><div data-current-state='1'>{phrase}</div><small>Order {order_id}</small></section>"
        elif mode == 4:
            subject = f"Reference {order_id}"
            body_text = f"{phrase} Identifiers below describe the same transaction; they do not change this current state."
        elif mode == 5:
            subject = phrase
            body_text = f"{phrase} Footer: explore new arrivals, member points and seasonal offers."
        elif mode == 6:
            subject = f"Update {order_id}"
            snippet = confuser
            body_text = f"Latest message body: {phrase}"
        elif mode == 7:
            subject = f"Re: {order_id}"
            body_text = f"NEWEST UPDATE: {phrase}\n\n> older quoted status: {confuser}\n> this quoted section is historical"
        elif mode == 8:
            subject = "Transaction notification"
            body_text = f"{phrase} Order reference: {order_id}."
            body_html = f"<table><tr><th>Current state</th><td>{phrase}</td></tr><tr><th>Reference</th><td>{order_id}</td></tr></table>"
        elif mode == 9:
            subject = f"Lifecycle update {order_id}"
            body_text = f"{phrase} A later next step may happen in the future, but it has not happened yet: {confuser}"

    use_structured = mode in {4, 8, 9} or event in {"INVOICE", "OTHER"}
    structured = structured_records(event, order_id, tracking_id, merchant, carrier) if use_structured else []

    links: list[dict[str, Any]] = []
    if tracking_id:
        links.append({
            "href": f"https://track.example/{tracking_id}",
            "text": "Track parcel",
            "rel": ["tracking"],
            "source": "body_text",
        })
    if event == "INVOICE":
        links.append({
            "href": f"https://billing.example/invoices/{order_id}",
            "text": "Invoice PDF",
            "rel": ["document"],
            "source": "body_html",
        })
    if event == "OTHER" and mode % 2 == 0:
        links.append({
            "href": "https://offers.example/weekend",
            "text": "View offers",
            "rel": ["marketing"],
            "source": "body_html",
        })

    attachments: list[dict[str, Any]] = []
    if event == "INVOICE":
        attachments.append({
            "id": f"att-{case_no}",
            "filename": f"invoice-{case_no}.pdf",
            "contentType": "application/pdf",
            "size": 48231,
            "isInline": False,
        })
    elif event == "WARRANTY" and mode in {4, 5, 8}:
        attachments.append({
            "id": f"att-{case_no}",
            "filename": "rma-instructions.pdf",
            "contentType": "application/pdf",
            "size": 22190,
            "isInline": False,
        })
    elif mode == 5:
        attachments.append({
            "id": f"att-{case_no}",
            "filename": "banner.png",
            "contentType": "image/png",
            "size": 8120,
            "isInline": True,
        })

    received = datetime(2026, 8, 31, 12, 0, tzinfo=timezone.utc) + timedelta(minutes=case_no)
    document = {
        "schemaVersion": "1",
        "provider": "gmail",
        "providerMessageId": f"synthetic-fbv11-{case_no:04d}",
        "providerThreadId": f"synthetic-thread-{ALLOWED.index(event):02d}",
        "subject": subject,
        "from": [{"email": f"updates@{domain}", "name": merchant}],
        "to": [{"email": "blind-eval@buyflow.invalid", "name": "Blind Eval"}],
        "cc": [],
        "bcc": [],
        "receivedAt": received.isoformat().replace("+00:00", "Z"),
        "snippet": snippet,
        "bodyText": body_text,
        "bodyHtml": body_html,
        "headers": auth_headers(domain),
        "folders": ["INBOX"],
        "attachments": attachments,
        "structuredData": structured,
        "links": links,
        "authentication": {"dkim": "pass", "spf": "pass", "dmarc": "pass"},
        "rawRef": None,
        "normalizerVersion": "email-document-v1/fresh-blind-v1",
        "traceId": f"fresh-blind-v1-{case_no:04d}",
    }
    return {
        "case_id": f"FBV11-{case_no:04d}",
        "expected": {"is_commerce": event != "OTHER", "event_type": event},
        "metadata": {
            "event_type": event,
            "language": lang,
            "family": FAMILY[event],
            "mode": mode,
            "synthetic": True,
            "train_eligible": False,
            "contains_raw_customer_data": False,
            "production_document_shape": "NormalizedEmailDocumentV1",
        },
        "document": document,
    }


def build_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    case_no = 1
    for event in ALLOWED:
        for index in range(CASES_PER_EVENT):
            cases.append(make_case(event, index, case_no))
            case_no += 1
    random.Random(SEED).shuffle(cases)
    return cases


def canonical_jsonl(cases: list[dict[str, Any]]) -> bytes:
    return "".join(
        json.dumps(case, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        for case in cases
    ).encode("utf-8")
