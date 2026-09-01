from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from v11_fresh_blind_config import ALLOWED

SEED = 20260901
LANGS = ["hu", "en", "de", "pl", "fr", "es"]
CASES_PER_EVENT = 10
EXPECTED_SHA256 = "8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352"

PHRASES: dict[str, dict[str, str]] = {
    "ORDER_CREATED": {"hu":"Új rendelés érkezett be, a vásárlást rögzítettük.","en":"A new order was placed and recorded.","de":"Eine neue Bestellung wurde aufgegeben und erfasst.","pl":"Nowe zamówienie zostało złożone i zapisane.","fr":"Une nouvelle commande a été passée et enregistrée.","es":"Se realizó y registró un nuevo pedido."},
    "ORDER_PROCESSING": {"hu":"A rendelést ellenőrizzük, még nem kezdődött meg a csomagolás.","en":"The order is being reviewed; packing has not started yet.","de":"Die Bestellung wird geprüft; das Verpacken hat noch nicht begonnen.","pl":"Zamówienie jest weryfikowane; pakowanie jeszcze się nie rozpoczęło.","fr":"La commande est en cours de vérification; l'emballage n'a pas encore commencé.","es":"El pedido está en revisión; el embalaje aún no ha comenzado."},
    "ORDER_PACKING": {"hu":"A raktár már összekészíti és csomagolja a rendelést.","en":"The warehouse is now picking and packing the order.","de":"Das Lager kommissioniert und verpackt die Bestellung jetzt.","pl":"Magazyn kompletuje i pakuje zamówienie.","fr":"L'entrepôt prépare et emballe maintenant la commande.","es":"El almacén está preparando y embalando el pedido."},
    "SHIPMENT_CREATED": {"hu":"A fuvarlevél elkészült, de a csomagot a futár még nem vette át.","en":"The shipping label was created, but the carrier has not received the parcel yet.","de":"Das Versandetikett wurde erstellt, aber der Dienstleister hat das Paket noch nicht übernommen.","pl":"Etykieta wysyłkowa została utworzona, ale przewoźnik nie odebrał jeszcze paczki.","fr":"L'étiquette d'expédition a été créée, mais le transporteur n'a pas encore reçu le colis.","es":"Se creó la etiqueta de envío, pero el transportista aún no ha recibido el paquete."},
    "SHIPPED": {"hu":"A futár átvette a csomagot a feladótól.","en":"The carrier has collected the parcel from the sender.","de":"Der Versanddienstleister hat das Paket beim Absender übernommen.","pl":"Przewoźnik odebrał paczkę od nadawcy.","fr":"Le transporteur a pris en charge le colis chez l'expéditeur.","es":"El transportista recogió el paquete del remitente."},
    "IN_TRANSIT": {"hu":"A csomag a futár hálózatában halad a következő központ felé.","en":"The parcel is moving through the carrier network toward the next hub.","de":"Das Paket bewegt sich im Netzwerk des Versanddienstleisters zum nächsten Zentrum.","pl":"Paczka przemieszcza się w sieci przewoźnika do kolejnego centrum.","fr":"Le colis circule dans le réseau du transporteur vers le prochain centre.","es":"El paquete avanza por la red del transportista hacia el siguiente centro."},
    "OUT_FOR_DELIVERY": {"hu":"A küldemény a kézbesítőnél van, ma viszik a címzetthez.","en":"The parcel is with the delivery driver and is due to be delivered today.","de":"Das Paket ist beim Zusteller und soll heute zugestellt werden.","pl":"Paczka jest u kuriera i ma zostać doręczona dzisiaj.","fr":"Le colis est avec le livreur et doit être livré aujourd'hui.","es":"El paquete está con el repartidor y se entregará hoy."},
    "READY_FOR_PICKUP": {"hu":"A csomag átvehető a kiválasztott automatából vagy ponton.","en":"The parcel is ready for collection at the selected pickup point or locker.","de":"Das Paket kann am ausgewählten Abholpunkt oder Automaten abgeholt werden.","pl":"Paczka jest gotowa do odbioru w wybranym punkcie lub automacie.","fr":"Le colis est prêt à être retiré au point ou casier choisi.","es":"El paquete está listo para recoger en el punto o taquilla seleccionados."},
    "DELIVERED": {"hu":"A kézbesítés sikeresen megtörtént, a címzett átvette a csomagot.","en":"Delivery was completed successfully and the recipient received the parcel.","de":"Die Zustellung wurde erfolgreich abgeschlossen und der Empfänger erhielt das Paket.","pl":"Doręczenie zakończyło się pomyślnie i odbiorca otrzymał paczkę.","fr":"La livraison a été effectuée avec succès et le destinataire a reçu le colis.","es":"La entrega se completó correctamente y el destinatario recibió el paquete."},
    "DELIVERY_FAILED": {"hu":"A kézbesítési kísérlet sikertelen volt, a csomagot nem adták át.","en":"The delivery attempt failed and the parcel was not handed over.","de":"Der Zustellversuch ist fehlgeschlagen und das Paket wurde nicht übergeben.","pl":"Próba doręczenia nie powiodła się i paczka nie została przekazana.","fr":"La tentative de livraison a échoué et le colis n'a pas été remis.","es":"El intento de entrega falló y el paquete no fue entregado."},
    "DELAYED": {"hu":"A szállítás késik, az új várható érkezés későbbi időpontra módosult.","en":"The shipment is delayed and the expected arrival has moved to a later time.","de":"Die Sendung verspätet sich und die erwartete Ankunft wurde nach hinten verschoben.","pl":"Przesyłka jest opóźniona, a przewidywany termin dostawy został przesunięty.","fr":"L'envoi est retardé et l'arrivée prévue a été repoussée.","es":"El envío se retrasa y la llegada prevista se ha aplazado."},
    "CANCELLED": {"hu":"A rendelést törölték, további teljesítés nem történik.","en":"The order was cancelled and will not be fulfilled further.","de":"Die Bestellung wurde storniert und wird nicht weiter bearbeitet.","pl":"Zamówienie anulowano i nie będzie dalej realizowane.","fr":"La commande a été annulée et ne sera plus traitée.","es":"El pedido fue cancelado y no se seguirá procesando."},
    "REFUNDED": {"hu":"A visszatérítést elküldték az eredeti fizetési módra.","en":"The refund was issued to the original payment method.","de":"Die Rückerstattung wurde auf die ursprüngliche Zahlungsart ausgezahlt.","pl":"Zwrot środków został wysłany na pierwotną metodę płatności.","fr":"Le remboursement a été envoyé vers le moyen de paiement initial.","es":"El reembolso se envió al método de pago original."},
    "PAYMENT": {"hu":"A fizetés sikeresen megtörtént és könyvelésre került.","en":"The payment completed successfully and was recorded.","de":"Die Zahlung wurde erfolgreich abgeschlossen und verbucht.","pl":"Płatność zakończyła się pomyślnie i została zaksięgowana.","fr":"Le paiement a été effectué avec succès et enregistré.","es":"El pago se completó correctamente y quedó registrado."},
    "INVOICE": {"hu":"A számla elkészült és elérhető a rendeléshez.","en":"The invoice has been issued and is available for the order.","de":"Die Rechnung wurde ausgestellt und steht für die Bestellung bereit.","pl":"Faktura została wystawiona i jest dostępna dla zamówienia.","fr":"La facture a été émise et est disponible pour la commande.","es":"La factura fue emitida y está disponible para el pedido."},
    "RETURN": {"hu":"A visszaküldési folyamat elindult, de pénzvisszatérítés még nem történt.","en":"The return process has started, but no refund has been issued yet.","de":"Die Rücksendung wurde gestartet, aber es wurde noch keine Erstattung ausgezahlt.","pl":"Proces zwrotu rozpoczął się, ale środki nie zostały jeszcze zwrócone.","fr":"Le processus de retour a commencé, mais aucun remboursement n'a encore été émis.","es":"El proceso de devolución ha comenzado, pero aún no se ha emitido un reembolso."},
    "WARRANTY": {"hu":"A garanciális ügyet rögzítették és vizsgálatra továbbították.","en":"The warranty case was registered and sent for review.","de":"Der Garantiefall wurde erfasst und zur Prüfung weitergeleitet.","pl":"Sprawa gwarancyjna została zarejestrowana i przekazana do weryfikacji.","fr":"Le dossier de garantie a été enregistré et transmis pour examen.","es":"El caso de garantía fue registrado y enviado a revisión."},
    "OTHER": {"hu":"Ez egy általános fiókértesítés vagy ajánlat, nem vásárlási esemény.","en":"This is a general account notice or offer, not a purchase lifecycle event.","de":"Dies ist ein allgemeiner Kontohinweis oder ein Angebot, kein Kauflaufzeit-Ereignis.","pl":"To ogólne powiadomienie o koncie lub oferta, a nie zdarzenie zakupowe.","fr":"Il s'agit d'un avis de compte général ou d'une offre, pas d'un événement d'achat.","es":"Es un aviso general de cuenta u oferta, no un evento del ciclo de compra."},
}

CONFUSER = {
    "ORDER_CREATED":"ORDER_PROCESSING","ORDER_PROCESSING":"ORDER_PACKING","ORDER_PACKING":"SHIPMENT_CREATED",
    "SHIPMENT_CREATED":"SHIPPED","SHIPPED":"IN_TRANSIT","IN_TRANSIT":"OUT_FOR_DELIVERY",
    "OUT_FOR_DELIVERY":"DELIVERED","READY_FOR_PICKUP":"DELIVERED","DELIVERED":"OUT_FOR_DELIVERY",
    "DELIVERY_FAILED":"DELAYED","DELAYED":"DELIVERY_FAILED","CANCELLED":"REFUNDED",
    "REFUNDED":"RETURN","PAYMENT":"INVOICE","INVOICE":"PAYMENT","RETURN":"REFUNDED",
    "WARRANTY":"RETURN","OTHER":"ORDER_CREATED",
}
MERCHANTS = ["North Pine", "Velora Market", "Kite & Co", "Mira Home", "Nova Basket", "Aster Shop"]
CARRIERS = ["ParcelWing", "RapidFox", "LineShip", "ArrowPost"]
TRACKING_EVENTS = {"SHIPMENT_CREATED","SHIPPED","IN_TRANSIT","OUT_FOR_DELIVERY","READY_FOR_PICKUP","DELIVERED","DELIVERY_FAILED","DELAYED"}


def _stable_id(prefix: str, rng: random.Random, digits: int) -> str:
    return prefix + "".join(str(rng.randrange(10)) for _ in range(digits))


def build_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    case_no = 1
    for event_index, event in enumerate(ALLOWED):
        for index in range(CASES_PER_EVENT):
            rng = random.Random(SEED + event_index * 11003 + index * 233)
            lang = LANGS[(index * 2 + event_index) % len(LANGS)]
            merchant = MERCHANTS[(index + 2 * event_index) % len(MERCHANTS)]
            carrier = CARRIERS[(index + event_index) % len(CARRIERS)]
            domain = merchant.lower().replace(" ", "-").replace("&", "and") + ".invalid"
            order_id = _stable_id("R", rng, 9)
            tracking_id = _stable_id("T", rng, 12) if event in TRACKING_EVENTS else None
            phrase = PHRASES[event][lang]
            confuser = PHRASES[CONFUSER[event]][lang]
            mode = index
            subject = phrase
            snippet = phrase
            body_text: str | None = phrase
            body_html: str | None = None

            if event == "OTHER":
                if mode in {1, 5}:
                    subject = PHRASES["ORDER_CREATED"][lang]
                if mode == 3:
                    body_text = "General account message. Current content is in the HTML section."
                    body_html = f"<article><h2>Notice</h2><p>{phrase}</p><small>No purchase was placed.</small></article>"
                elif mode == 7:
                    body_text = f"{phrase}\n\nQuoted old message: {PHRASES['ORDER_CREATED'][lang]}"
            else:
                if mode == 1:
                    subject = confuser
                    body_text = f"CURRENT UPDATE: {phrase}\nPrevious status: {confuser}"
                elif mode == 2:
                    subject = f"Reference {order_id}"
                    body_text = f"{phrase}\nDo not infer the next state: {confuser}"
                elif mode == 3:
                    body_text = "The latest status appears in the visible HTML section."
                    body_html = f"<article><h2>Latest status</h2><p>{phrase}</p><small>{order_id}</small></article>"
                elif mode == 4:
                    subject = f"Order {order_id} update"
                    body_text = f"{phrase}\nIdentifiers below are references only."
                elif mode == 5:
                    body_text = f"{phrase}\n\nFooter: rewards, recommendations, seasonal offers."
                elif mode == 6:
                    snippet = confuser
                    subject = f"Update {order_id}"
                    body_text = f"Latest body: {phrase}"
                elif mode == 7:
                    subject = f"Re: {order_id}"
                    body_text = f"NEW MESSAGE: {phrase}\n\n> quoted historical message: {confuser}"
                elif mode == 8:
                    body_text = f"{phrase}\nReference: {order_id}"
                    body_html = f"<table><tr><td>Status</td><td>{phrase}</td></tr></table>"
                elif mode == 9:
                    body_text = f"{phrase}\nA possible future step has NOT happened: {confuser}"

            structured: list[dict[str, Any]] = []
            if mode in {4, 8, 9} or event in {"INVOICE", "OTHER"}:
                if event != "OTHER":
                    structured.append({"kind":"json_ld","schemaType":"Order","payload":{"orderNumber":order_id,"merchant":{"name":merchant}},"source":"body_html"})
                else:
                    structured.append({"kind":"json_ld","schemaType":"Offer","payload":{"price":"24.90","priceCurrency":"EUR"},"source":"body_html"})
                if tracking_id:
                    structured.append({"kind":"schema_org","schemaType":"ParcelDelivery","payload":{"trackingNumber":tracking_id,"provider":{"name":carrier}},"source":"body_html"})
                if event == "INVOICE":
                    structured.append({"kind":"json_ld","schemaType":"Invoice","payload":{"confirmationNumber":"INV-" + order_id[-5:]},"source":"body_html"})

            links = []
            if tracking_id:
                links.append({"href":f"https://track.invalid/{tracking_id}","text":"Tracking","rel":["tracking"],"source":"body_text"})
            attachments = []
            if event == "INVOICE":
                attachments.append({"id":f"x{case_no}","filename":f"invoice-{case_no}.pdf","contentType":"application/pdf","size":39000,"isInline":False})
            elif event == "WARRANTY" and mode in {4, 8}:
                attachments.append({"id":f"x{case_no}","filename":"warranty-form.pdf","contentType":"application/pdf","size":18000,"isInline":False})

            received = datetime(2026, 9, 1, 15, 0, tzinfo=timezone.utc) + timedelta(minutes=case_no * 3)
            document = {
                "schemaVersion":"1","provider":"gmail","providerMessageId":f"holdout-v2-{case_no:04d}","providerThreadId":f"thread-v2-{event_index:02d}",
                "subject":subject,"from":[{"email":f"notify@{domain}","name":merchant}],"to":[{"email":"holdout@buyflow.invalid","name":"Holdout"}],"cc":[],"bcc":[],
                "receivedAt":received.isoformat().replace("+00:00","Z"),"snippet":snippet,"bodyText":body_text,"bodyHtml":body_html,
                "headers":[{"name":"Authentication-Results","value":f"dkim=pass header.d={domain}; spf=pass; dmarc=pass"}],"folders":["INBOX"],
                "attachments":attachments,"structuredData":structured,"links":links,"authentication":{"dkim":"pass","spf":"pass","dmarc":"pass"},
                "rawRef":None,"normalizerVersion":"email-document-v1/input-view-holdout-v2","traceId":f"view-holdout-v2-{case_no:04d}",
            }
            cases.append({
                "case_id":f"IVH2-{case_no:04d}",
                "expected":{"is_commerce":event != "OTHER","event_type":event},
                "metadata":{"event_type":event,"language":lang,"mode":mode,"synthetic":True,"train_eligible":False,"contains_raw_customer_data":False,"holdout":"input-view-v2"},
                "document":document,
            })
            case_no += 1
    random.Random(SEED).shuffle(cases)
    return cases


def canonical_jsonl(cases: list[dict[str, Any]]) -> bytes:
    return "".join(json.dumps(case, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for case in cases).encode("utf-8")
