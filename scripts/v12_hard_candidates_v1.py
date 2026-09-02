from __future__ import annotations

import hashlib
import html
import json
from typing import Any

SEED = 20260901
LANGUAGES = ("hu", "en", "de", "pl", "fr", "es")

FAMILIES = (
    ("order_processing_vs_packing", "ORDER_PROCESSING", "ORDER_PACKING"),
    ("shipment_created_vs_shipped", "SHIPMENT_CREATED", "SHIPPED"),
    ("shipped_vs_in_transit", "SHIPPED", "IN_TRANSIT"),
    ("out_for_delivery_vs_delivered", "OUT_FOR_DELIVERY", "DELIVERED"),
    ("return_vs_refunded", "RETURN", "REFUNDED"),
    ("payment_vs_invoice", "PAYMENT", "INVOICE"),
)

TEXT: dict[str, dict[str, str]] = {
    "hu": {
        "ORDER_PROCESSING": "A rendelés feldolgozás alatt van. A csomagolás még nem kezdődött el.",
        "ORDER_PACKING": "A rendelés csomagolása folyamatban van. A futárnak még nem adtuk át.",
        "SHIPMENT_CREATED": "A szállítási címke elkészült és az adatokat továbbítottuk a futárnak. A futár még nem vette át a csomagot.",
        "SHIPPED": "A futár fizikailag átvette a csomagot. A küldemény elindult, de még nincs depó- vagy válogatóközponti scan.",
        "IN_TRANSIT": "A csomagot egy válogatóközpontban beszkennelték, és a futár hálózatán belül továbbhalad.",
        "OUT_FOR_DELIVERY": "A csomag ma kézbesítésre indult a futárral. Még nem kézbesítették a címzettnek.",
        "DELIVERED": "A csomagot sikeresen kézbesítették a címzettnek.",
        "RETURN": "A visszaküldést elfogadtuk, a termék visszaküldhető. Visszatérítés még nem történt.",
        "REFUNDED": "A vételár visszatérítését teljesítettük az eredeti fizetési módra.",
        "PAYMENT": "A fizetés sikeresen megtörtént. Ez fizetési visszaigazolás, nem kiállított számla.",
        "INVOICE": "A számlát kiállítottuk, a dokumentum elérhető. Ez nem fizetési visszaigazolás.",
    },
    "en": {
        "ORDER_PROCESSING": "Your order is being processed. Packing has not started yet.",
        "ORDER_PACKING": "Your order is currently being packed. It has not been handed to the carrier yet.",
        "SHIPMENT_CREATED": "A shipping label was created and the shipment data was sent to the carrier. The carrier has not collected the parcel yet.",
        "SHIPPED": "The carrier physically collected the parcel. It has left the sender, but there is no depot or sorting-hub scan yet.",
        "IN_TRANSIT": "The parcel was scanned at a sorting hub and is moving through the carrier network.",
        "OUT_FOR_DELIVERY": "The parcel is out with the courier for delivery today. It has not been delivered yet.",
        "DELIVERED": "The parcel was successfully delivered to the recipient.",
        "RETURN": "The return was accepted and the item can be sent back. No refund has been completed yet.",
        "REFUNDED": "The purchase amount has been refunded to the original payment method.",
        "PAYMENT": "Your payment was completed successfully. This is a payment confirmation, not an issued invoice.",
        "INVOICE": "Your invoice has been issued and the document is available. This is not a payment confirmation.",
    },
    "de": {
        "ORDER_PROCESSING": "Ihre Bestellung wird bearbeitet. Mit dem Verpacken wurde noch nicht begonnen.",
        "ORDER_PACKING": "Ihre Bestellung wird gerade verpackt. Sie wurde dem Paketdienst noch nicht übergeben.",
        "SHIPMENT_CREATED": "Ein Versandetikett wurde erstellt und die Sendungsdaten wurden an den Paketdienst übermittelt. Das Paket wurde noch nicht abgeholt.",
        "SHIPPED": "Der Paketdienst hat das Paket physisch übernommen. Es hat den Absender verlassen, aber es gibt noch keinen Scan im Depot oder Sortierzentrum.",
        "IN_TRANSIT": "Das Paket wurde in einem Sortierzentrum gescannt und bewegt sich durch das Netzwerk des Paketdienstes.",
        "OUT_FOR_DELIVERY": "Das Paket befindet sich heute beim Zusteller zur Auslieferung. Es wurde noch nicht zugestellt.",
        "DELIVERED": "Das Paket wurde dem Empfänger erfolgreich zugestellt.",
        "RETURN": "Die Rücksendung wurde akzeptiert und die Ware kann zurückgeschickt werden. Eine Erstattung wurde noch nicht ausgeführt.",
        "REFUNDED": "Der Kaufbetrag wurde auf die ursprüngliche Zahlungsmethode zurückerstattet.",
        "PAYMENT": "Die Zahlung wurde erfolgreich abgeschlossen. Dies ist eine Zahlungsbestätigung und keine ausgestellte Rechnung.",
        "INVOICE": "Die Rechnung wurde ausgestellt und das Dokument ist verfügbar. Dies ist keine Zahlungsbestätigung.",
    },
    "pl": {
        "ORDER_PROCESSING": "Zamówienie jest przetwarzane. Pakowanie jeszcze się nie rozpoczęło.",
        "ORDER_PACKING": "Zamówienie jest obecnie pakowane. Nie zostało jeszcze przekazane przewoźnikowi.",
        "SHIPMENT_CREATED": "Utworzono etykietę wysyłkową i przekazano dane przesyłki przewoźnikowi. Przewoźnik jeszcze nie odebrał paczki.",
        "SHIPPED": "Przewoźnik fizycznie odebrał paczkę. Opuściła nadawcę, ale nie ma jeszcze skanu z sortowni ani oddziału.",
        "IN_TRANSIT": "Paczka została zeskanowana w sortowni i przemieszcza się w sieci przewoźnika.",
        "OUT_FOR_DELIVERY": "Paczka jest dziś u kuriera w doręczeniu. Nie została jeszcze dostarczona.",
        "DELIVERED": "Paczka została pomyślnie doręczona odbiorcy.",
        "RETURN": "Zwrot został zaakceptowany i towar można odesłać. Zwrot pieniędzy nie został jeszcze wykonany.",
        "REFUNDED": "Kwota zakupu została zwrócona na pierwotną metodę płatności.",
        "PAYMENT": "Płatność została pomyślnie zrealizowana. To potwierdzenie płatności, a nie wystawiona faktura.",
        "INVOICE": "Faktura została wystawiona i dokument jest dostępny. To nie jest potwierdzenie płatności.",
    },
    "fr": {
        "ORDER_PROCESSING": "Votre commande est en cours de traitement. L'emballage n'a pas encore commencé.",
        "ORDER_PACKING": "Votre commande est en cours d'emballage. Elle n'a pas encore été remise au transporteur.",
        "SHIPMENT_CREATED": "Une étiquette d'expédition a été créée et les données ont été transmises au transporteur. Le colis n'a pas encore été collecté.",
        "SHIPPED": "Le transporteur a physiquement pris en charge le colis. Il a quitté l'expéditeur, mais aucun scan de dépôt ou de centre de tri n'a encore eu lieu.",
        "IN_TRANSIT": "Le colis a été scanné dans un centre de tri et circule dans le réseau du transporteur.",
        "OUT_FOR_DELIVERY": "Le colis est avec le livreur pour une livraison aujourd'hui. Il n'a pas encore été livré.",
        "DELIVERED": "Le colis a été livré avec succès au destinataire.",
        "RETURN": "Le retour a été accepté et l'article peut être renvoyé. Aucun remboursement n'a encore été effectué.",
        "REFUNDED": "Le montant de l'achat a été remboursé sur le moyen de paiement d'origine.",
        "PAYMENT": "Le paiement a été effectué avec succès. Ceci est une confirmation de paiement, pas une facture émise.",
        "INVOICE": "La facture a été émise et le document est disponible. Ceci n'est pas une confirmation de paiement.",
    },
    "es": {
        "ORDER_PROCESSING": "Tu pedido se está procesando. El embalaje todavía no ha comenzado.",
        "ORDER_PACKING": "Tu pedido se está embalando. Todavía no se ha entregado al transportista.",
        "SHIPMENT_CREATED": "Se creó una etiqueta de envío y los datos se enviaron al transportista. El transportista aún no ha recogido el paquete.",
        "SHIPPED": "El transportista recogió físicamente el paquete. Ya salió del remitente, pero todavía no hay escaneo en depósito o centro de clasificación.",
        "IN_TRANSIT": "El paquete fue escaneado en un centro de clasificación y está avanzando por la red del transportista.",
        "OUT_FOR_DELIVERY": "El paquete está hoy con el repartidor para su entrega. Todavía no ha sido entregado.",
        "DELIVERED": "El paquete fue entregado correctamente al destinatario.",
        "RETURN": "La devolución fue aceptada y el artículo puede enviarse de vuelta. Todavía no se ha completado ningún reembolso.",
        "REFUNDED": "El importe de la compra fue reembolsado al método de pago original.",
        "PAYMENT": "El pago se completó correctamente. Esto es una confirmación de pago, no una factura emitida.",
        "INVOICE": "La factura fue emitida y el documento está disponible. Esto no es una confirmación de pago.",
    },
}

GENERIC_SUBJECT = {
    "hu": "Frissítés a rendelésedről",
    "en": "Update about your order",
    "de": "Aktualisierung zu Ihrer Bestellung",
    "pl": "Aktualizacja zamówienia",
    "fr": "Mise à jour de votre commande",
    "es": "Actualización de tu pedido",
}

FOOTER = {
    "hu": "Köszönjük a vásárlást. Ez az üzenet automatikusan készült.",
    "en": "Thank you for your purchase. This message was generated automatically.",
    "de": "Vielen Dank für Ihren Einkauf. Diese Nachricht wurde automatisch erstellt.",
    "pl": "Dziękujemy za zakupy. Ta wiadomość została wygenerowana automatycznie.",
    "fr": "Merci pour votre achat. Ce message a été généré automatiquement.",
    "es": "Gracias por tu compra. Este mensaje se generó automáticamente.",
}

MERCHANTS = ("Northstar Market", "Cedar Lane Shop", "Atlas Corner", "Moonbird Store", "Copper Pine", "Riverstone Retail")
CARRIERS = ("ParcelNorth", "SwiftRoute", "BlueTrack", "MetroParcel")


def _expected(event_type: str) -> dict[str, Any]:
    return {"is_commerce": event_type != "OTHER", "event_type": event_type}


def _structured(event_type: str, idx: int) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = [{
        "schemaType": "Order",
        "source": "JSON_LD",
        "payload": {"orderNumber": f"V12-{700000 + idx}"},
    }]
    if event_type in {"SHIPMENT_CREATED", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"}:
        data.append({
            "schemaType": "ParcelDelivery",
            "source": "JSON_LD",
            "payload": {"trackingNumber": f"TRK{91000000 + idx}", "carrier": CARRIERS[idx % len(CARRIERS)]},
        })
    return data


def build_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    idx = 0
    for family_idx, (family, left, right) in enumerate(FAMILIES):
        for language in LANGUAGES:
            for side_idx, event_type in enumerate((left, right)):
                opposite = right if event_type == left else left
                for variant in range(2):
                    idx += 1
                    merchant = MERCHANTS[(idx + family_idx) % len(MERCHANTS)]
                    current_text = TEXT[language][event_type]
                    stale_text = TEXT[language][opposite]
                    subject = GENERIC_SUBJECT[language] if variant == 0 else stale_text
                    body = current_text if variant == 0 else f"{current_text}\n\n{FOOTER[language]}"
                    body_html = None if variant == 0 else f"<html><body><p>{html.escape(current_text)}</p><hr><p>{html.escape(FOOTER[language])}</p></body></html>"
                    attachment = []
                    if event_type == "INVOICE":
                        attachment = [{"id": f"att-{idx}", "filename": f"invoice-{idx}.pdf", "contentType": "application/pdf", "size": 24000 + idx, "isInline": False}]
                    links = []
                    if event_type in {"SHIPMENT_CREATED", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"}:
                        links = [{"text": "tracking", "href": f"https://tracking.synthetic.invalid/{91000000 + idx}", "rel": None, "source": "body"}]
                    document = {
                        "schemaVersion": "NormalizedEmailDocumentV1",
                        "provider": "synthetic-v12-candidate",
                        "providerMessageId": f"v12c1-{idx}",
                        "providerThreadId": f"thread-{family_idx}-{language}-{side_idx}",
                        "subject": subject,
                        "from": [{"name": merchant, "email": "updates@synthetic.invalid"}],
                        "to": [{"name": "Synthetic Buyer", "email": "buyer@synthetic.invalid"}],
                        "cc": [],
                        "bcc": [],
                        "receivedAt": f"2026-09-{1 + (idx % 20):02d}T12:{idx % 60:02d}:00Z",
                        "snippet": GENERIC_SUBJECT[language],
                        "bodyText": body,
                        "bodyHtml": body_html,
                        "headers": [{"name": "Content-Type", "value": "text/html; charset=UTF-8" if body_html else "text/plain; charset=UTF-8"}],
                        "folders": ["INBOX"],
                        "attachments": attachment,
                        "structuredData": _structured(event_type, idx),
                        "links": links,
                        "authentication": {"spf": "pass", "dkim": "pass", "dmarc": "pass"},
                        "rawRef": f"synthetic://v12-candidate/{idx}",
                        "normalizerVersion": "v12-candidate-v1",
                        "traceId": f"v12c1-trace-{idx}",
                    }
                    cases.append({
                        "case_id": f"V12C1-{idx:04d}",
                        "expected": _expected(event_type),
                        "document": document,
                        "metadata": {
                            "family": family,
                            "language": language,
                            "variant": variant,
                            "synthetic": True,
                            "deidentified": True,
                            "seed": SEED,
                            "teacher_status": "PENDING",
                            "train_eligible": False,
                            "source_frozen_holdout_row": False,
                        },
                    })
    if len(cases) != 144:
        raise RuntimeError(f"V12_CANDIDATE_COUNT:{len(cases)}")
    return cases


def canonical_jsonl(cases: list[dict[str, Any]]) -> bytes:
    return b"".join((json.dumps(case, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8") for case in cases)


def corpus_sha256(cases: list[dict[str, Any]]) -> str:
    return hashlib.sha256(canonical_jsonl(cases)).hexdigest()
