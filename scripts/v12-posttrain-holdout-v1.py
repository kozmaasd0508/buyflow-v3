from __future__ import annotations

import hashlib
import html
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from v11_fresh_blind_config import ALLOWED, INSTRUCTION

LANGUAGES = ("hu", "en", "de", "pl", "fr", "es")
VARIANTS = (
    "clean_plain",
    "stale_subject",
    "html_only",
    "stale_snippet",
    "quoted_history",
    "metadata_noise",
)
EVENTS = tuple(ALLOWED)
EXPECTED_ROWS = 108
GENERATOR_VERSION = "v12-posttrain-holdout-v1"

GENERIC_SUBJECT = {
    "hu": "Frissítés az értesítéseidről",
    "en": "Update to your notifications",
    "de": "Aktualisierung Ihrer Benachrichtigungen",
    "pl": "Aktualizacja powiadomień",
    "fr": "Mise à jour de vos notifications",
    "es": "Actualización de tus notificaciones",
}

HISTORY_MARKER = {
    "hu": "Korábbi idézett üzenet, csak előzmény — nem a jelenlegi állapot:",
    "en": "Quoted previous message, historical context only — not the current state:",
    "de": "Zitierte frühere Nachricht, nur Verlauf — nicht der aktuelle Status:",
    "pl": "Cytowana wcześniejsza wiadomość, tylko historia — nie bieżący status:",
    "fr": "Message précédent cité, historique uniquement — pas l’état actuel :",
    "es": "Mensaje anterior citado, solo historial — no es el estado actual:",
}

FOOTER = {
    "hu": "Ez automatikus értesítés. Az azonosítók önmagukban nem jelentenek állapotot.",
    "en": "This is an automated notification. Identifiers alone do not state a lifecycle status.",
    "de": "Dies ist eine automatische Benachrichtigung. Kennungen allein beschreiben keinen Status.",
    "pl": "To automatyczne powiadomienie. Same identyfikatory nie określają statusu.",
    "fr": "Ceci est une notification automatique. Les identifiants seuls ne décrivent pas un statut.",
    "es": "Este es un aviso automático. Los identificadores por sí solos no indican un estado.",
}

# Fresh wording written specifically for this post-training holdout. These strings
# are not copied from V11/V12 training, hard-sibling or protected holdout rows.
TEXT: dict[str, dict[str, str]] = {
    "hu": {
        "ORDER_CREATED": "A rendelésedet sikeresen rögzítettük és elfogadtuk. A feldolgozás még nem kezdődött el.",
        "ORDER_PROCESSING": "A rendelésed adatait és tételeit jelenleg feldolgozzuk. Csomagolás még nem indult.",
        "ORDER_PACKING": "A rendelés feldolgozása kész, a termékeket most csomagoljuk. Futárnak még nem adtuk át.",
        "SHIPMENT_CREATED": "A küldeményhez elkészült a fuvarcímke és az előértesítés. A csomagot a futár még nem vette át.",
        "SHIPPED": "A csomagot ma ténylegesen átadtuk a futárszolgálatnak. Hálózati továbbítási szkennelés még nincs.",
        "IN_TRANSIT": "A küldemény már a futár hálózatában halad a cél felé. Kézbesítésre még nem indult el.",
        "OUT_FOR_DELIVERY": "A futár ma magával vitte a csomagot a kézbesítési körre. A csomag még nincs kézbesítve.",
        "READY_FOR_PICKUP": "A csomag megérkezett az átvételi pontra és most átvehető. A címzett még nem vette át.",
        "DELIVERED": "A csomagot sikeresen átadtuk a címzettnek, a kézbesítés befejeződött.",
        "DELIVERY_FAILED": "A mai kézbesítési kísérlet sikertelen volt, a csomagot nem sikerült átadni. Új kísérlet várható.",
        "DELAYED": "A küldemény szállítása késik a tervezetthez képest, de nincs törölve és kézbesítési kudarc sem történt.",
        "CANCELLED": "A rendelést végleg töröltük, ezért azt nem fogjuk feldolgozni vagy kiszállítani.",
        "REFUNDED": "A visszatérítést végrehajtottuk, az összeg visszakerült az eredeti fizetési módra.",
        "PAYMENT": "A rendeléshez tartozó fizetés sikeresen beérkezett. Számlát ez az értesítés nem állít ki.",
        "INVOICE": "A rendeléshez kiállítottuk a számlát, amely most elérhető. Ez nem fizetési visszaigazolás.",
        "RETURN": "A visszaküldött terméket megkaptuk és a visszáru beérkezését rögzítettük. Visszatérítés még nem történt.",
        "WARRANTY": "A garanciális ügyet rögzítettük, a termék garanciális vizsgálata vagy javítása folyamatban van.",
        "OTHER": "Megjelent az új heti hírlevelünk terméktippekkel és általános ajánlatokkal. Ez nem egy konkrét vásárlás állapotértesítése.",
    },
    "en": {
        "ORDER_CREATED": "We successfully recorded and accepted your order. Processing has not started yet.",
        "ORDER_PROCESSING": "We are currently reviewing and processing the items in your order. Packing has not begun.",
        "ORDER_PACKING": "Order processing is complete and the items are being packed now. Nothing has been handed to the carrier yet.",
        "SHIPMENT_CREATED": "A shipping label and carrier pre-advice have been created. The carrier has not received the parcel yet.",
        "SHIPPED": "We physically handed the parcel to the carrier today. There is no network transit scan yet.",
        "IN_TRANSIT": "The parcel is moving through the carrier network toward its destination. It is not out for delivery yet.",
        "OUT_FOR_DELIVERY": "The courier has taken the parcel on today’s delivery route. It has not been delivered yet.",
        "READY_FOR_PICKUP": "The parcel has arrived at the pickup point and is available for collection. The recipient has not collected it yet.",
        "DELIVERED": "The parcel was successfully handed to the recipient and delivery is complete.",
        "DELIVERY_FAILED": "Today’s delivery attempt was unsuccessful and the parcel was not handed over. Another attempt is expected.",
        "DELAYED": "The shipment is running behind schedule, but it has not been cancelled and no delivery attempt has failed.",
        "CANCELLED": "The order has been permanently cancelled and will not be processed or shipped.",
        "REFUNDED": "The refund has been completed and the money was returned to the original payment method.",
        "PAYMENT": "Payment for the order was received successfully. This notification does not issue an invoice.",
        "INVOICE": "An invoice for the order has been issued and is now available. This is not a payment confirmation.",
        "RETURN": "We received the returned item and recorded the return arrival. A refund has not been issued yet.",
        "WARRANTY": "The warranty case has been registered and the product is under warranty inspection or repair.",
        "OTHER": "Our new weekly newsletter is available with product tips and general offers. This is not a status update for a specific purchase.",
    },
    "de": {
        "ORDER_CREATED": "Wir haben Ihre Bestellung erfolgreich erfasst und angenommen. Die Bearbeitung hat noch nicht begonnen.",
        "ORDER_PROCESSING": "Wir prüfen und bearbeiten derzeit die Positionen Ihrer Bestellung. Mit dem Verpacken wurde noch nicht begonnen.",
        "ORDER_PACKING": "Die Bearbeitung ist abgeschlossen und die Artikel werden jetzt verpackt. An den Paketdienst wurde noch nichts übergeben.",
        "SHIPMENT_CREATED": "Versandetikett und Vorankündigung wurden erstellt. Der Paketdienst hat das Paket noch nicht übernommen.",
        "SHIPPED": "Wir haben das Paket heute tatsächlich an den Paketdienst übergeben. Ein Scan im Transportnetz liegt noch nicht vor.",
        "IN_TRANSIT": "Das Paket bewegt sich bereits durch das Transportnetz zum Ziel. Es befindet sich noch nicht in Zustellung.",
        "OUT_FOR_DELIVERY": "Der Zusteller hat das Paket heute auf seine Zustelltour mitgenommen. Es wurde noch nicht zugestellt.",
        "READY_FOR_PICKUP": "Das Paket ist an der Abholstelle angekommen und kann jetzt abgeholt werden. Es wurde noch nicht abgeholt.",
        "DELIVERED": "Das Paket wurde erfolgreich an den Empfänger übergeben und die Zustellung ist abgeschlossen.",
        "DELIVERY_FAILED": "Der heutige Zustellversuch war erfolglos und das Paket konnte nicht übergeben werden. Ein weiterer Versuch ist vorgesehen.",
        "DELAYED": "Die Sendung verspätet sich gegenüber dem Plan, wurde aber nicht storniert und es gab keinen fehlgeschlagenen Zustellversuch.",
        "CANCELLED": "Die Bestellung wurde endgültig storniert und wird weder bearbeitet noch versendet.",
        "REFUNDED": "Die Erstattung wurde abgeschlossen und der Betrag auf die ursprüngliche Zahlungsart zurückgebucht.",
        "PAYMENT": "Die Zahlung für die Bestellung ist erfolgreich eingegangen. Diese Nachricht stellt keine Rechnung aus.",
        "INVOICE": "Für die Bestellung wurde eine Rechnung ausgestellt und sie ist jetzt verfügbar. Dies ist keine Zahlungsbestätigung.",
        "RETURN": "Wir haben die zurückgesandte Ware erhalten und den Eingang der Rücksendung erfasst. Eine Erstattung erfolgte noch nicht.",
        "WARRANTY": "Der Garantiefall wurde registriert und das Produkt befindet sich in Garantieprüfung oder Reparatur.",
        "OTHER": "Unser neuer Wochennewsletter enthält Produkttipps und allgemeine Angebote. Dies ist keine Statusmeldung zu einem konkreten Kauf.",
    },
    "pl": {
        "ORDER_CREATED": "Zamówienie zostało pomyślnie zapisane i przyjęte. Jego przetwarzanie jeszcze się nie rozpoczęło.",
        "ORDER_PROCESSING": "Obecnie sprawdzamy i przetwarzamy pozycje zamówienia. Pakowanie jeszcze się nie rozpoczęło.",
        "ORDER_PACKING": "Przetwarzanie zamówienia zakończono i produkty są teraz pakowane. Przewoźnik jeszcze ich nie otrzymał.",
        "SHIPMENT_CREATED": "Utworzono etykietę wysyłkową i awizację dla przewoźnika. Przewoźnik nie odebrał jeszcze paczki.",
        "SHIPPED": "Dzisiaj fizycznie przekazaliśmy paczkę przewoźnikowi. Nie ma jeszcze skanu z sieci transportowej.",
        "IN_TRANSIT": "Paczka przemieszcza się już w sieci przewoźnika w kierunku celu. Nie została jeszcze wydana do doręczenia.",
        "OUT_FOR_DELIVERY": "Kurier zabrał dziś paczkę na trasę doręczeniową. Paczka nie została jeszcze doręczona.",
        "READY_FOR_PICKUP": "Paczka dotarła do punktu odbioru i jest gotowa do odebrania. Odbiorca jeszcze jej nie odebrał.",
        "DELIVERED": "Paczka została pomyślnie przekazana odbiorcy i doręczenie zostało zakończone.",
        "DELIVERY_FAILED": "Dzisiejsza próba doręczenia nie powiodła się i paczki nie przekazano odbiorcy. Planowana jest kolejna próba.",
        "DELAYED": "Przesyłka jest opóźniona względem planu, ale nie została anulowana i nie było nieudanej próby doręczenia.",
        "CANCELLED": "Zamówienie zostało ostatecznie anulowane i nie będzie przetwarzane ani wysyłane.",
        "REFUNDED": "Zwrot środków został zakończony, a pieniądze wróciły na pierwotną metodę płatności.",
        "PAYMENT": "Płatność za zamówienie została pomyślnie otrzymana. To powiadomienie nie wystawia faktury.",
        "INVOICE": "Dla zamówienia wystawiono fakturę i jest ona teraz dostępna. To nie jest potwierdzenie płatności.",
        "RETURN": "Otrzymaliśmy zwrócony produkt i zarejestrowaliśmy przyjęcie zwrotu. Zwrot środków jeszcze nie nastąpił.",
        "WARRANTY": "Zgłoszenie gwarancyjne zostało zarejestrowane, a produkt jest w trakcie kontroli lub naprawy gwarancyjnej.",
        "OTHER": "Nasz nowy cotygodniowy newsletter zawiera porady produktowe i ogólne oferty. To nie jest aktualizacja konkretnego zakupu.",
    },
    "fr": {
        "ORDER_CREATED": "Votre commande a été enregistrée et acceptée avec succès. Son traitement n’a pas encore commencé.",
        "ORDER_PROCESSING": "Nous vérifions et traitons actuellement les articles de votre commande. L’emballage n’a pas encore commencé.",
        "ORDER_PACKING": "Le traitement est terminé et les articles sont maintenant emballés. Rien n’a encore été remis au transporteur.",
        "SHIPMENT_CREATED": "Une étiquette d’expédition et une pré-notification transporteur ont été créées. Le transporteur n’a pas encore reçu le colis.",
        "SHIPPED": "Nous avons physiquement remis le colis au transporteur aujourd’hui. Il n’y a pas encore de scan dans le réseau de transport.",
        "IN_TRANSIT": "Le colis circule déjà dans le réseau du transporteur vers sa destination. Il n’est pas encore en cours de livraison.",
        "OUT_FOR_DELIVERY": "Le livreur a emporté le colis sur sa tournée de livraison aujourd’hui. Le colis n’a pas encore été livré.",
        "READY_FOR_PICKUP": "Le colis est arrivé au point de retrait et peut maintenant être récupéré. Le destinataire ne l’a pas encore retiré.",
        "DELIVERED": "Le colis a été remis avec succès au destinataire et la livraison est terminée.",
        "DELIVERY_FAILED": "La tentative de livraison d’aujourd’hui a échoué et le colis n’a pas pu être remis. Une nouvelle tentative est prévue.",
        "DELAYED": "L’expédition est en retard sur le planning, mais elle n’est pas annulée et aucune tentative de livraison n’a échoué.",
        "CANCELLED": "La commande a été définitivement annulée et ne sera ni traitée ni expédiée.",
        "REFUNDED": "Le remboursement est terminé et l’argent a été renvoyé vers le moyen de paiement d’origine.",
        "PAYMENT": "Le paiement de la commande a bien été reçu. Cette notification n’émet pas de facture.",
        "INVOICE": "Une facture a été émise pour la commande et elle est maintenant disponible. Ce n’est pas une confirmation de paiement.",
        "RETURN": "Nous avons reçu l’article retourné et enregistré l’arrivée du retour. Aucun remboursement n’a encore été effectué.",
        "WARRANTY": "Le dossier de garantie a été enregistré et le produit est en cours de contrôle ou de réparation sous garantie.",
        "OTHER": "Notre nouvelle newsletter hebdomadaire contient des conseils produits et des offres générales. Ce n’est pas le suivi d’un achat précis.",
    },
    "es": {
        "ORDER_CREATED": "Tu pedido se registró y aceptó correctamente. El procesamiento todavía no ha comenzado.",
        "ORDER_PROCESSING": "Estamos revisando y procesando los artículos de tu pedido. El empaquetado todavía no ha empezado.",
        "ORDER_PACKING": "El procesamiento terminó y los artículos se están empaquetando ahora. Todavía no se ha entregado nada al transportista.",
        "SHIPMENT_CREATED": "Se han creado la etiqueta de envío y el preaviso al transportista. El transportista todavía no ha recibido el paquete.",
        "SHIPPED": "Hoy entregamos físicamente el paquete al transportista. Todavía no existe un escaneo dentro de la red de transporte.",
        "IN_TRANSIT": "El paquete ya se mueve por la red del transportista hacia su destino. Todavía no ha salido a reparto.",
        "OUT_FOR_DELIVERY": "El repartidor ha llevado hoy el paquete en su ruta de entrega. El paquete todavía no ha sido entregado.",
        "READY_FOR_PICKUP": "El paquete llegó al punto de recogida y ya está disponible. El destinatario todavía no lo ha recogido.",
        "DELIVERED": "El paquete se entregó correctamente al destinatario y la entrega ha finalizado.",
        "DELIVERY_FAILED": "El intento de entrega de hoy no tuvo éxito y el paquete no pudo entregarse. Se espera otro intento.",
        "DELAYED": "El envío lleva retraso respecto al plan, pero no está cancelado y no ha ocurrido un intento de entrega fallido.",
        "CANCELLED": "El pedido ha sido cancelado definitivamente y no será procesado ni enviado.",
        "REFUNDED": "El reembolso se completó y el dinero volvió al método de pago original.",
        "PAYMENT": "El pago del pedido se recibió correctamente. Esta notificación no emite una factura.",
        "INVOICE": "Se ha emitido una factura para el pedido y ya está disponible. Esto no es una confirmación de pago.",
        "RETURN": "Hemos recibido el artículo devuelto y registrado la llegada de la devolución. Todavía no se ha emitido un reembolso.",
        "WARRANTY": "El caso de garantía quedó registrado y el producto está en revisión o reparación bajo garantía.",
        "OTHER": "Nuestro nuevo boletín semanal contiene consejos de productos y ofertas generales. No es una actualización de una compra concreta.",
    },
}

DISTRACTOR_EVENT = {
    "ORDER_CREATED": "ORDER_PACKING",
    "ORDER_PROCESSING": "ORDER_PACKING",
    "ORDER_PACKING": "ORDER_PROCESSING",
    "SHIPMENT_CREATED": "SHIPPED",
    "SHIPPED": "IN_TRANSIT",
    "IN_TRANSIT": "DELIVERED",
    "OUT_FOR_DELIVERY": "DELIVERED",
    "READY_FOR_PICKUP": "DELIVERED",
    "DELIVERED": "OUT_FOR_DELIVERY",
    "DELIVERY_FAILED": "DELIVERED",
    "DELAYED": "DELIVERED",
    "CANCELLED": "ORDER_PROCESSING",
    "REFUNDED": "RETURN",
    "PAYMENT": "INVOICE",
    "INVOICE": "PAYMENT",
    "RETURN": "REFUNDED",
    "WARRANTY": "RETURN",
    "OTHER": "ORDER_CREATED",
}

MERCHANTS = (
    "North Pine Goods",
    "Copper River Store",
    "Lumen Field Market",
    "Cedar Moon Retail",
    "Bright Harbor Shop",
    "Stone Fern Commerce",
)


def expected(event_type: str) -> dict[str, Any]:
    return {"is_commerce": event_type != "OTHER", "event_type": event_type}


def base_document(index: int, language: str, event_type: str) -> dict[str, Any]:
    commerce = event_type != "OTHER"
    doc: dict[str, Any] = {
        "schemaVersion": "NormalizedEmailDocumentV1",
        "provider": "synthetic-v12-posttrain-holdout-v1",
        "providerMessageId": f"v12h1-{index:04d}",
        "providerThreadId": f"v12h1-thread-{language}-{event_type.lower()}-{index:04d}",
        "subject": GENERIC_SUBJECT[language],
        "from": [{"name": MERCHANTS[index % len(MERCHANTS)], "email": "notify@posttrain-holdout.invalid"}],
        "to": [{"name": "Synthetic Buyer", "email": "buyer@posttrain-holdout.invalid"}],
        "cc": [],
        "bcc": [],
        "receivedAt": f"2026-11-{1 + (index % 24):02d}T{8 + (index % 10):02d}:{index % 60:02d}:00Z",
        "snippet": GENERIC_SUBJECT[language],
        "bodyText": TEXT[language][event_type],
        "bodyHtml": None,
        "headers": [{"name": "Content-Type", "value": "text/plain; charset=UTF-8"}],
        "folders": ["INBOX"],
        "attachments": [],
        "structuredData": [],
        "links": [],
        "authentication": {"spf": "pass", "dkim": "pass", "dmarc": "pass"},
        "rawRef": f"synthetic://v12-posttrain-holdout-v1/{index:04d}",
        "normalizerVersion": GENERATOR_VERSION,
        "traceId": f"v12h1-trace-{index:04d}",
    }
    if commerce:
        doc["structuredData"] = [{
            "schemaType": "Order",
            "source": "JSON_LD",
            "payload": {"orderNumber": f"H1-{930000 + index}"},
        }]
        if event_type in {
            "SHIPMENT_CREATED", "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY",
            "READY_FOR_PICKUP", "DELIVERED", "DELIVERY_FAILED", "DELAYED",
        }:
            doc["structuredData"].append({
                "schemaType": "ParcelDelivery",
                "source": "JSON_LD",
                "payload": {"trackingNumber": f"TRK-H1-{740000 + index}"},
            })
    return doc


def apply_variant(document: dict[str, Any], language: str, event_type: str, variant: str) -> dict[str, Any]:
    doc = json.loads(json.dumps(document, ensure_ascii=False))
    current = TEXT[language][event_type]
    stale = TEXT[language][DISTRACTOR_EVENT[event_type]]

    if variant == "clean_plain":
        doc["bodyText"] = current + "\n\n" + FOOTER[language]
        return doc

    if variant == "stale_subject":
        doc["subject"] = stale
        doc["bodyText"] = current + "\n\n" + FOOTER[language]
        return doc

    if variant == "html_only":
        doc["subject"] = GENERIC_SUBJECT[language]
        doc["bodyText"] = None
        doc["bodyHtml"] = (
            "<html><body><main><p>" + html.escape(current) + "</p></main>"
            "<footer><small>" + html.escape(FOOTER[language]) + "</small></footer></body></html>"
        )
        doc["headers"] = [{"name": "Content-Type", "value": "text/html; charset=UTF-8"}]
        return doc

    if variant == "stale_snippet":
        doc["snippet"] = stale
        doc["bodyText"] = current + "\n\n" + FOOTER[language]
        return doc

    if variant == "quoted_history":
        doc["bodyText"] = current + "\n\n" + HISTORY_MARKER[language] + "\n> " + stale
        doc["bodyHtml"] = (
            "<html><body><p>" + html.escape(current) + "</p><hr><p>" +
            html.escape(HISTORY_MARKER[language]) + "</p><blockquote>" + html.escape(stale) +
            "</blockquote></body></html>"
        )
        doc["headers"] = [{"name": "Content-Type", "value": "multipart/alternative"}]
        return doc

    if variant == "metadata_noise":
        return {
            "schemaVersion": doc["schemaVersion"],
            "providerMessageId": doc["providerMessageId"],
            "receivedAt": doc["receivedAt"],
            "headers": [
                {"name": "Content-Type", "value": "text/plain; charset=UTF-8"},
                {"name": "X-Route", "value": "edge-07"},
                {"name": "X-Priority", "value": "normal"},
                {"name": "X-Template-Revision", "value": "42"},
            ],
            "authentication": doc["authentication"],
            "folders": ["INBOX", "CATEGORY_UPDATES"],
            "provider": doc["provider"],
            "providerThreadId": doc["providerThreadId"],
            "from": doc["from"],
            "to": doc["to"],
            "cc": [],
            "bcc": [],
            "structuredData": doc["structuredData"],
            "attachments": [{
                "id": f"meta-{doc['providerMessageId']}",
                "filename": "terms.txt",
                "contentType": "text/plain",
                "size": 128,
                "isInline": False,
            }],
            "links": [{"url": "https://example.invalid/account", "host": "example.invalid"}],
            "subject": GENERIC_SUBJECT[language],
            "snippet": GENERIC_SUBJECT[language],
            "bodyText": current + "\n\n" + FOOTER[language],
            "bodyHtml": None,
            "rawRef": doc["rawRef"],
            "normalizerVersion": doc["normalizerVersion"],
            "traceId": doc["traceId"],
        }

    raise RuntimeError(f"UNKNOWN_VARIANT:{variant}")


def build_cases() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    index = 0
    for event_index, event_type in enumerate(EVENTS):
        for language_index, language in enumerate(LANGUAGES):
            index += 1
            variant = VARIANTS[(event_index + language_index) % len(VARIANTS)]
            document = apply_variant(base_document(index, language, event_type), language, event_type, variant)
            rows.append({
                "case_id": f"V12H1-{index:04d}",
                "split": "UNTOUCHED_HOLDOUT",
                "expected": expected(event_type),
                "document": document,
                "metadata": {
                    "generator": GENERATOR_VERSION,
                    "event_type": event_type,
                    "language": language,
                    "representation_variant": variant,
                    "synthetic": True,
                    "deidentified": True,
                    "post_training_created": True,
                    "source_rows_copied": False,
                    "train_eligible": False,
                    "tuning_eligible": False,
                },
            })
    return rows


def canonical_jsonl(rows: list[dict[str, Any]]) -> bytes:
    return b"".join(
        (json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        for row in rows
    )


def validate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if len(rows) != EXPECTED_ROWS:
        raise RuntimeError(f"ROW_COUNT:{len(rows)}!={EXPECTED_ROWS}")
    ids = [row["case_id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise RuntimeError("DUPLICATE_CASE_ID")
    if set(EVENTS) != set(ALLOWED) or len(EVENTS) != 18:
        raise RuntimeError("EVENT_SET_NOT_18")
    event_counts = Counter(row["expected"]["event_type"] for row in rows)
    language_counts = Counter(row["metadata"]["language"] for row in rows)
    variant_counts = Counter(row["metadata"]["representation_variant"] for row in rows)
    event_language = Counter((row["expected"]["event_type"], row["metadata"]["language"]) for row in rows)
    event_variant = Counter((row["expected"]["event_type"], row["metadata"]["representation_variant"]) for row in rows)
    if any(event_counts[event] != 6 for event in EVENTS):
        raise RuntimeError(f"EVENT_BALANCE:{dict(event_counts)}")
    if any(language_counts[language] != 18 for language in LANGUAGES):
        raise RuntimeError(f"LANGUAGE_BALANCE:{dict(language_counts)}")
    if any(variant_counts[variant] != 18 for variant in VARIANTS):
        raise RuntimeError(f"VARIANT_BALANCE:{dict(variant_counts)}")
    if any(event_language[(event, language)] != 1 for event in EVENTS for language in LANGUAGES):
        raise RuntimeError("EVENT_LANGUAGE_MATRIX_NOT_COMPLETE")
    if any(event_variant[(event, variant)] != 1 for event in EVENTS for variant in VARIANTS):
        raise RuntimeError("EVENT_VARIANT_MATRIX_NOT_COMPLETE")
    if any(row["metadata"]["train_eligible"] or row["metadata"]["tuning_eligible"] for row in rows):
        raise RuntimeError("HOLDOUT_ROW_MARKED_TRAIN_OR_TUNING_ELIGIBLE")
    if any(row["split"] != "UNTOUCHED_HOLDOUT" for row in rows):
        raise RuntimeError("HOLDOUT_SPLIT_MISMATCH")
    return {
        "rows": len(rows),
        "event_counts": dict(sorted(event_counts.items())),
        "language_counts": dict(sorted(language_counts.items())),
        "variant_counts": dict(sorted(variant_counts.items())),
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Create and freeze fresh post-training V12 untouched holdout")
    parser.add_argument("project_root")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    out = root / "local-data" / "lora-v12" / "posttrain-holdout-v1"
    cases_path = out / "cases.jsonl"
    sha_path = out / "HOLDOUT_SHA256.txt"
    manifest_path = out / "manifest.json"

    rows = build_cases()
    stats = validate(rows)
    payload = canonical_jsonl(rows)
    sha = hashlib.sha256(payload).hexdigest()

    # Fail closed if a previously frozen holdout exists with different bytes.
    if cases_path.exists() or sha_path.exists() or manifest_path.exists():
        if not cases_path.is_file() or not sha_path.is_file() or not manifest_path.is_file():
            raise RuntimeError(f"PARTIAL_EXISTING_HOLDOUT:{out}")
        existing = cases_path.read_bytes()
        existing_sha = hashlib.sha256(existing).hexdigest()
        recorded_sha = sha_path.read_text(encoding="utf-8").strip()
        if existing != payload or existing_sha != sha or recorded_sha != sha:
            raise RuntimeError(f"FROZEN_HOLDOUT_CONFLICT:{existing_sha}:{recorded_sha}:{sha}")
        print("status: V12_POSTTRAIN_HOLDOUT_V1_ALREADY_FROZEN")
        print(f"holdout_sha256: {sha}")
        print(f"rows: {stats['rows']}")
        print(f"holdout_dir: {out}")
        return

    out.mkdir(parents=True, exist_ok=False)
    cases_path.write_bytes(payload)
    sha_path.write_text(sha + "\n", encoding="utf-8")
    manifest = {
        "status": "V12_POSTTRAIN_HOLDOUT_V1_FROZEN",
        "generator_version": GENERATOR_VERSION,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "created_after_v12_training": True,
        "holdout_sha256": sha,
        "rows": stats["rows"],
        "events": 18,
        "rows_per_event": 6,
        "languages": list(LANGUAGES),
        "representation_variants": list(VARIANTS),
        "event_counts": stats["event_counts"],
        "language_counts": stats["language_counts"],
        "variant_counts": stats["variant_counts"],
        "synthetic": True,
        "deidentified": True,
        "source_rows_copied": False,
        "training_eligible": False,
        "tuning_eligible": False,
        "model_loaded": False,
        "v11_scored": False,
        "v12_scored": False,
        "fresh_blind_read": False,
        "input_view_holdout_read": False,
        "frozen108_read": False,
        "blind50_read": False,
        "prior_training_corpus_read": False,
        "prior_hard_sibling_rows_read": False,
        "instruction": INSTRUCTION,
        "purpose": "One-shot untouched post-training generalization gate. Freeze before any V11/V12 inference. Never train or tune on these rows.",
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if hashlib.sha256(cases_path.read_bytes()).hexdigest() != sha:
        raise RuntimeError("POSTWRITE_SHA_MISMATCH")

    print("# BUYFLOW V12 POSTTRAIN UNTOUCHED HOLDOUT V1")
    print("status: V12_POSTTRAIN_HOLDOUT_V1_FROZEN")
    print(f"holdout_sha256: {sha}")
    print(f"rows: {stats['rows']}")
    print("events: 18")
    print("rows_per_event: 6")
    print("languages: hu,en,de,pl,fr,es")
    print("representation_variants: clean_plain,stale_subject,html_only,stale_snippet,quoted_history,metadata_noise")
    print("event_language_matrix: COMPLETE")
    print("event_variant_matrix: COMPLETE")
    print("synthetic_deidentified: True")
    print("source_rows_copied: False")
    print("training_eligible: False")
    print("tuning_eligible: False")
    print("model_loaded: False")
    print("v11_scored: False")
    print("v12_scored: False")
    print("protected_holdouts_read: False")
    print("prior_training_corpus_read: False")
    print("prior_hard_sibling_rows_read: False")
    print(f"cases_file: {cases_path}")
    print(f"manifest_file: {manifest_path}")
    print("NEXT: do not edit this corpus; score only after preserving this SHA.")


if __name__ == "__main__":
    main()
