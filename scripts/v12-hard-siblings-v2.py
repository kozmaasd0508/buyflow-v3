from __future__ import annotations

import hashlib
import html
import json
from collections import Counter
from pathlib import Path
from typing import Any

from v11_fresh_blind_config import INSTRUCTION

LANGUAGES = ("hu", "en", "de", "pl", "fr", "es")
EVENTS = ("ORDER_PROCESSING", "ORDER_PACKING")
VARIANTS = (
    "clean_plain",
    "misleading_subject",
    "html_body",
    "stale_snippet",
    "quoted_old_state",
    "metadata_order_shift",
)

GENERIC_SUBJECT = {
    "hu": "Állapotfrissítés a rendelésedről",
    "en": "Order status update",
    "de": "Statusaktualisierung zu Ihrer Bestellung",
    "pl": "Aktualizacja statusu zamówienia",
    "fr": "Mise à jour du statut de votre commande",
    "es": "Actualización del estado de tu pedido",
}

FOOTER = {
    "hu": "Automatikus értesítés. Köszönjük a rendelést.",
    "en": "Automated notification. Thank you for your order.",
    "de": "Automatische Benachrichtigung. Vielen Dank für Ihre Bestellung.",
    "pl": "Automatyczne powiadomienie. Dziękujemy za zamówienie.",
    "fr": "Notification automatique. Merci pour votre commande.",
    "es": "Notificación automática. Gracias por tu pedido.",
}

OLD_MARKER = {
    "hu": "Korábbi üzenet, csak előzmény — nem a jelenlegi állapot:",
    "en": "Previous message, historical context only — not the current state:",
    "de": "Frühere Nachricht, nur Verlauf — nicht der aktuelle Status:",
    "pl": "Poprzednia wiadomość, tylko historia — nie bieżący status:",
    "fr": "Message précédent, historique uniquement — pas l'état actuel :",
    "es": "Mensaje anterior, solo historial — no es el estado actual:",
}

# Three independent semantic phrasings per label/language.
# Phrases 0-1 are TRAIN candidates; phrase 2 is VALIDATION-only so validation
# is separated by wording family, not merely row hash.
TEXT: dict[str, dict[str, tuple[str, str, str]]] = {
    "hu": {
        "ORDER_PROCESSING": (
            "A rendelés ellenőrzése és feldolgozása folyamatban van. A csomagolást még nem kezdtük meg.",
            "A rendelésedet most dolgozzuk fel; a termékek még nincsenek csomagolás alatt.",
            "A rendelés a feldolgozási szakaszban van. Dobozolás vagy csomagolás még nem indult.",
        ),
        "ORDER_PACKING": (
            "A feldolgozás befejeződött, a rendelés csomagolása most zajlik. A futár még nem vette át.",
            "A termékeket jelenleg dobozba készítjük és csomagoljuk; a küldeményt még nem adtuk át a futárnak.",
            "A rendelés már a csomagolási szakaszban van. Futárátvétel még nem történt.",
        ),
    },
    "en": {
        "ORDER_PROCESSING": (
            "Your order is currently being checked and processed. Packing has not started yet.",
            "We are still processing your order; the items are not being packed yet.",
            "The order remains in the processing stage. Boxing or packing has not begun.",
        ),
        "ORDER_PACKING": (
            "Processing is complete and your order is now being packed. The carrier has not collected it yet.",
            "The items are currently being boxed and packed; the parcel has not been handed to the carrier.",
            "Your order has entered the packing stage. Carrier pickup has not happened yet.",
        ),
    },
    "de": {
        "ORDER_PROCESSING": (
            "Ihre Bestellung wird derzeit geprüft und bearbeitet. Mit dem Verpacken wurde noch nicht begonnen.",
            "Wir bearbeiten Ihre Bestellung noch; die Artikel werden noch nicht verpackt.",
            "Die Bestellung befindet sich weiterhin in der Bearbeitung. Kartonieren oder Verpacken hat noch nicht begonnen.",
        ),
        "ORDER_PACKING": (
            "Die Bearbeitung ist abgeschlossen und Ihre Bestellung wird jetzt verpackt. Der Paketdienst hat sie noch nicht übernommen.",
            "Die Artikel werden derzeit eingepackt und verpackt; das Paket wurde dem Paketdienst noch nicht übergeben.",
            "Ihre Bestellung befindet sich nun in der Verpackungsphase. Eine Abholung durch den Paketdienst hat noch nicht stattgefunden.",
        ),
    },
    "pl": {
        "ORDER_PROCESSING": (
            "Zamówienie jest obecnie sprawdzane i przetwarzane. Pakowanie jeszcze się nie rozpoczęło.",
            "Nadal przetwarzamy Twoje zamówienie; produkty nie są jeszcze pakowane.",
            "Zamówienie pozostaje na etapie przetwarzania. Umieszczanie w pudełku ani pakowanie jeszcze się nie zaczęło.",
        ),
        "ORDER_PACKING": (
            "Przetwarzanie zakończono i zamówienie jest teraz pakowane. Przewoźnik jeszcze go nie odebrał.",
            "Produkty są obecnie wkładane do pudełka i pakowane; przesyłka nie została jeszcze przekazana przewoźnikowi.",
            "Zamówienie weszło już w etap pakowania. Odbiór przez przewoźnika jeszcze nie nastąpił.",
        ),
    },
    "fr": {
        "ORDER_PROCESSING": (
            "Votre commande est actuellement vérifiée et traitée. L'emballage n'a pas encore commencé.",
            "Nous sommes encore en train de traiter votre commande ; les articles ne sont pas encore en cours d'emballage.",
            "La commande reste à l'étape de traitement. La mise en boîte ou l'emballage n'a pas encore débuté.",
        ),
        "ORDER_PACKING": (
            "Le traitement est terminé et votre commande est maintenant en cours d'emballage. Le transporteur ne l'a pas encore collectée.",
            "Les articles sont actuellement mis en boîte et emballés ; le colis n'a pas encore été remis au transporteur.",
            "Votre commande est désormais à l'étape d'emballage. La collecte par le transporteur n'a pas encore eu lieu.",
        ),
    },
    "es": {
        "ORDER_PROCESSING": (
            "Tu pedido se está revisando y procesando. El embalaje todavía no ha comenzado.",
            "Seguimos procesando tu pedido; los artículos todavía no se están empaquetando.",
            "El pedido continúa en la fase de procesamiento. Aún no ha comenzado el embalaje ni la preparación de la caja.",
        ),
        "ORDER_PACKING": (
            "El procesamiento ha terminado y tu pedido se está empaquetando ahora. El transportista todavía no lo ha recogido.",
            "Los artículos se están colocando en la caja y empaquetando; el paquete aún no se ha entregado al transportista.",
            "Tu pedido ya está en la fase de embalaje. La recogida por el transportista todavía no ha ocurrido.",
        ),
    },
}

MERCHANTS = (
    "Silver Fern Market",
    "Amber Dock Shop",
    "Blue Meadow Store",
    "Juniper Lane",
    "Quiet Harbor Retail",
    "Orchid Corner",
)


def expected(event_type: str) -> dict[str, Any]:
    return {"is_commerce": True, "event_type": event_type}


def opposite(event_type: str) -> str:
    return "ORDER_PACKING" if event_type == "ORDER_PROCESSING" else "ORDER_PROCESSING"


def _base_document(idx: int, language: str, event_type: str, phrase_idx: int) -> dict[str, Any]:
    merchant = MERCHANTS[idx % len(MERCHANTS)]
    core = TEXT[language][event_type][phrase_idx]
    return {
        "schemaVersion": "NormalizedEmailDocumentV1",
        "provider": "synthetic-v12-hard-sibling-v2",
        "providerMessageId": f"v12s2-{idx}",
        "providerThreadId": f"v12s2-thread-{language}-{event_type.lower()}-{phrase_idx}",
        "subject": GENERIC_SUBJECT[language],
        "from": [{"name": merchant, "email": "status@synthetic.invalid"}],
        "to": [{"name": "Synthetic Buyer", "email": "buyer@synthetic.invalid"}],
        "cc": [],
        "bcc": [],
        "receivedAt": f"2026-10-{1 + (idx % 20):02d}T09:{idx % 60:02d}:00Z",
        "snippet": GENERIC_SUBJECT[language],
        "bodyText": core,
        "bodyHtml": None,
        "headers": [{"name": "Content-Type", "value": "text/plain; charset=UTF-8"}],
        "folders": ["INBOX"],
        "attachments": [],
        "structuredData": [{
            "schemaType": "Order",
            "source": "JSON_LD",
            "payload": {"orderNumber": f"S2-{880000 + idx}"},
        }],
        "links": [],
        "authentication": {"spf": "pass", "dkim": "pass", "dmarc": "pass"},
        "rawRef": f"synthetic://v12-hard-sibling-v2/{idx}",
        "normalizerVersion": "v12-hard-sibling-v2",
        "traceId": f"v12s2-trace-{idx}",
    }


def _apply_variant(document: dict[str, Any], language: str, event_type: str, phrase_idx: int, variant: str) -> dict[str, Any]:
    doc = json.loads(json.dumps(document, ensure_ascii=False))
    current = TEXT[language][event_type][phrase_idx]
    stale = TEXT[language][opposite(event_type)][phrase_idx]

    if variant == "clean_plain":
        return doc

    if variant == "misleading_subject":
        doc["subject"] = stale
        doc["bodyText"] = current + "\n\n" + FOOTER[language]
        return doc

    if variant == "html_body":
        doc["subject"] = stale
        doc["bodyText"] = current
        doc["bodyHtml"] = f"<html><body><p>{html.escape(current)}</p><hr><p>{html.escape(FOOTER[language])}</p></body></html>"
        doc["headers"] = [{"name": "Content-Type", "value": "text/html; charset=UTF-8"}]
        return doc

    if variant == "stale_snippet":
        doc["snippet"] = stale
        doc["bodyText"] = current + "\n\n" + FOOTER[language]
        return doc

    if variant == "quoted_old_state":
        doc["bodyText"] = current + "\n\n" + OLD_MARKER[language] + "\n> " + stale
        doc["bodyHtml"] = (
            f"<html><body><p>{html.escape(current)}</p><hr>"
            f"<p>{html.escape(OLD_MARKER[language])}</p><blockquote>{html.escape(stale)}</blockquote></body></html>"
        )
        doc["headers"] = [{"name": "Content-Type", "value": "text/html; charset=UTF-8"}]
        return doc

    if variant == "metadata_order_shift":
        # Same semantics, but more harmless metadata and a deliberately different
        # JSON insertion order to train against token-position sensitivity.
        shifted = {
            "schemaVersion": doc["schemaVersion"],
            "provider": doc["provider"],
            "providerMessageId": doc["providerMessageId"],
            "providerThreadId": doc["providerThreadId"],
            "receivedAt": doc["receivedAt"],
            "headers": [
                {"name": "Content-Type", "value": "text/plain; charset=UTF-8"},
                {"name": "X-Synthetic-Route", "value": "mail-gateway-2"},
                {"name": "X-Synthetic-Priority", "value": "normal"},
            ],
            "folders": ["INBOX", "CATEGORY_UPDATES"],
            "authentication": doc["authentication"],
            "from": doc["from"],
            "to": doc["to"],
            "cc": [],
            "bcc": [],
            "structuredData": doc["structuredData"],
            "links": [],
            "attachments": [],
            "subject": stale,
            "snippet": GENERIC_SUBJECT[language],
            "bodyText": current + "\n\n" + FOOTER[language],
            "bodyHtml": None,
            "rawRef": doc["rawRef"],
            "normalizerVersion": doc["normalizerVersion"],
            "traceId": doc["traceId"],
        }
        return shifted

    raise ValueError(f"UNKNOWN_VARIANT:{variant}")


def canonical_jsonl(rows: list[dict[str, Any]]) -> bytes:
    return b"".join(
        (json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        for row in rows
    )


def build_cases() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    idx = 0
    for language in LANGUAGES:
        for event_type in EVENTS:
            for phrase_idx in range(3):
                split = "TRAIN" if phrase_idx < 2 else "VALIDATION"
                semantic_group = f"{language}:{event_type}:{phrase_idx}"
                for variant in VARIANTS:
                    idx += 1
                    base = _base_document(idx, language, event_type, phrase_idx)
                    document = _apply_variant(base, language, event_type, phrase_idx, variant)
                    rows.append({
                        "case_id": f"V12S2-{idx:04d}",
                        "split": split,
                        "expected": expected(event_type),
                        "document": document,
                        "metadata": {
                            "family": "order_processing_vs_packing",
                            "language": language,
                            "semantic_group": semantic_group,
                            "phrase_index": phrase_idx,
                            "representation_variant": variant,
                            "synthetic": True,
                            "deidentified": True,
                            "teacher_provenance": "human_teacher_rule_2026-09-02",
                            "source_rows_copied": False,
                            "train_eligible": split == "TRAIN",
                        },
                    })
    return rows


def validate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if len(rows) != 216:
        raise RuntimeError(f"ROW_COUNT:{len(rows)}!=216")
    ids = [row["case_id"] for row in rows]
    if len(set(ids)) != len(ids):
        raise RuntimeError("DUPLICATE_CASE_ID")

    split_counts = Counter(row["split"] for row in rows)
    if split_counts != Counter({"TRAIN": 144, "VALIDATION": 72}):
        raise RuntimeError(f"SPLIT_COUNTS:{dict(split_counts)}")

    label_split = Counter((row["split"], row["expected"]["event_type"]) for row in rows)
    expected_counts = {
        ("TRAIN", "ORDER_PROCESSING"): 72,
        ("TRAIN", "ORDER_PACKING"): 72,
        ("VALIDATION", "ORDER_PROCESSING"): 36,
        ("VALIDATION", "ORDER_PACKING"): 36,
    }
    if dict(label_split) != expected_counts:
        raise RuntimeError(f"LABEL_SPLIT:{dict(label_split)}")

    # All representation siblings within a semantic group must keep one label.
    group_labels: dict[str, set[str]] = {}
    group_variants: dict[str, set[str]] = {}
    for row in rows:
        meta = row["metadata"]
        group = meta["semantic_group"]
        group_labels.setdefault(group, set()).add(row["expected"]["event_type"])
        group_variants.setdefault(group, set()).add(meta["representation_variant"])
    for group, labels in group_labels.items():
        if len(labels) != 1:
            raise RuntimeError(f"INVARIANCE_LABEL_DRIFT:{group}:{labels}")
        if group_variants[group] != set(VARIANTS):
            raise RuntimeError(f"INVARIANCE_VARIANTS_MISSING:{group}:{group_variants[group]}")

    train_groups = {row["metadata"]["semantic_group"] for row in rows if row["split"] == "TRAIN"}
    val_groups = {row["metadata"]["semantic_group"] for row in rows if row["split"] == "VALIDATION"}
    if train_groups & val_groups:
        raise RuntimeError("SEMANTIC_GROUP_SPLIT_LEAK")

    # No protected/frozen/candidate identifiers or known old synthetic order range.
    blob = canonical_jsonl(rows).decode("utf-8")
    forbidden = (
        "IVH2-",
        "V12C1-",
        "V12-7000",
        "6cc9775867862bec4c90d8037ccd674db4b0308d8e2470c164695fa317a55251",
        "8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352",
    )
    hits = [token for token in forbidden if token in blob]
    if hits:
        raise RuntimeError(f"CONTAMINATION_MARKER:{hits}")

    if "@synthetic.invalid" not in blob:
        raise RuntimeError("SYNTHETIC_DOMAIN_MISSING")

    return {
        "status": "V12_HARD_SIBLINGS_V2_CORPUS_READY",
        "rows": len(rows),
        "train": split_counts["TRAIN"],
        "validation": split_counts["VALIDATION"],
        "languages": list(LANGUAGES),
        "events": list(EVENTS),
        "representation_variants": list(VARIANTS),
        "semantic_group_split_overlap": 0,
        "frozen_or_stage1_row_reuse": False,
        "privacy_gate": "PASS_SYNTHETIC_DEIDENTIFIED",
        "teacher_rule": "current body evidence + explicit next-step negation overrides stale subject/snippet",
    }


def _sft_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "instruction": INSTRUCTION,
        "input": json.dumps(row["document"], ensure_ascii=False, separators=(",", ":")),
        "output": json.dumps(row["expected"], ensure_ascii=False, separators=(",", ":")),
        "case_id": row["case_id"],
        "metadata": row["metadata"],
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build V12 hard sibling + representation-invariance corpus")
    parser.add_argument("project_root")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    out = root / "local-data" / "lora-v12" / "hard-siblings-v2"
    out.mkdir(parents=True, exist_ok=True)

    rows = build_cases()
    metrics = validate(rows)
    corpus_bytes = canonical_jsonl(rows)
    corpus_sha = hashlib.sha256(corpus_bytes).hexdigest()
    metrics["corpus_sha256"] = corpus_sha

    train = [_sft_row(row) for row in rows if row["split"] == "TRAIN"]
    validation = [_sft_row(row) for row in rows if row["split"] == "VALIDATION"]

    (out / "cases.jsonl").write_bytes(corpus_bytes)
    with (out / "train.sft.jsonl").open("w", encoding="utf-8") as handle:
        for row in train:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    with (out / "validation.sft.jsonl").open("w", encoding="utf-8") as handle:
        for row in validation:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    (out / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "CORPUS_SHA256.txt").write_text(corpus_sha + "\n", encoding="utf-8")

    print("# BUYFLOW V12 HARD SIBLINGS V2")
    print(f"status: {metrics['status']}")
    print(f"rows: {metrics['rows']}")
    print(f"train: {metrics['train']}")
    print(f"validation: {metrics['validation']}")
    print(f"languages: {','.join(metrics['languages'])}")
    print(f"events: {','.join(metrics['events'])}")
    print(f"representation_variants: {len(metrics['representation_variants'])}")
    print(f"semantic_group_split_overlap: {metrics['semantic_group_split_overlap']}")
    print(f"frozen_or_stage1_row_reuse: {metrics['frozen_or_stage1_row_reuse']}")
    print(f"privacy_gate: {metrics['privacy_gate']}")
    print(f"corpus_sha256: {corpus_sha}")
    print(f"output_dir: {out}")
    print("training_started: False")


if __name__ == "__main__":
    main()
