#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import random
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any


MODEL_ID = os.environ.get("BUYFLOW_LORA_MODEL_ID", "Qwen/Qwen3-8B")
SEED = 20260831
CASES_PER_EVENT = 10
MAX_PROMPT_TOKENS = 700
MAX_NEW_TOKENS = 48
EXPECTED_FIXTURE_SHA256 = "5a03856c3a5962860224a809eb9c4f45d28190e2618b534dfc9c4880ac0e9582"
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

PHRASES: dict[str, dict[str, str]] = {
    "ORDER_CREATED": {
        "hu": "A vásárlási kérelmet rögzítettük, és új rendelésként bekerült a rendszerbe.",
        "en": "We logged this purchase as a new order in our system.",
        "de": "Der Einkauf wurde als neue Bestellung in unserem System erfasst.",
        "pl": "Zakup został zapisany w systemie jako nowe zamówienie.",
        "fr": "Cet achat a été enregistré dans notre système comme une nouvelle commande.",
        "es": "La compra ha quedado registrada en el sistema como un pedido nuevo.",
    },
    "ORDER_PROCESSING": {
        "hu": "A rendelés nyitva van, jelenleg az adatok és a készlet ellenőrzése zajlik.",
        "en": "The order remains open while stock and order details are being checked.",
        "de": "Die Bestellung ist offen; Bestand und Bestelldaten werden derzeit geprüft.",
        "pl": "Zamówienie jest otwarte; trwa weryfikacja danych i dostępności towaru.",
        "fr": "La commande reste ouverte pendant la vérification du stock et des informations.",
        "es": "El pedido sigue abierto mientras se comprueban existencias y datos.",
    },
    "ORDER_PACKING": {
        "hu": "A raktár összekészíti és dobozolja a rendelést; fuvarozói átvétel még nem történt.",
        "en": "The warehouse is boxing the order; no carrier pickup has happened yet.",
        "de": "Das Lager verpackt die Bestellung; eine Abholung durch den Versanddienstleister gab es noch nicht.",
        "pl": "Magazyn pakuje zamówienie; przewoźnik jeszcze go nie odebrał.",
        "fr": "L'entrepôt emballe la commande; le transporteur ne l'a pas encore collectée.",
        "es": "El almacén está empaquetando el pedido; el transportista aún no lo ha recogido.",
    },
    "SHIPMENT_CREATED": {
        "hu": "A szállítási címke elkészült, de a futár még nem szkennelte át fizikailag a csomagot.",
        "en": "A shipping label now exists, but the carrier has not physically scanned the parcel yet.",
        "de": "Das Versandlabel wurde erstellt, aber der Dienstleister hat das Paket noch nicht physisch gescannt.",
        "pl": "Etykieta wysyłkowa została utworzona, ale przewoźnik nie zeskanował jeszcze fizycznie paczki.",
        "fr": "L'étiquette d'expédition existe, mais le transporteur n'a pas encore scanné physiquement le colis.",
        "es": "La etiqueta de envío ya existe, pero el transportista aún no ha escaneado físicamente el paquete.",
    },
    "SHIPPED": {
        "hu": "A feladási ponton megtörtént az első fizikai átvételi szkennelés a futár hálózatában.",
        "en": "The carrier recorded the first physical acceptance scan at origin.",
        "de": "Am Ausgangspunkt wurde der erste physische Annahmescan des Versanddienstleisters erfasst.",
        "pl": "Przewoźnik zarejestrował pierwszy fizyczny skan przyjęcia w punkcie nadania.",
        "fr": "Le transporteur a enregistré le premier scan physique de prise en charge au départ.",
        "es": "El transportista registró el primer escaneo físico de aceptación en origen.",
    },
    "IN_TRANSIT": {
        "hu": "A küldemény elhagyta az elosztóközpontot, és a következő logisztikai állomás felé halad.",
        "en": "The parcel departed a sorting facility and is moving to the next network location.",
        "de": "Das Paket hat ein Sortierzentrum verlassen und ist auf dem Weg zum nächsten Netzknoten.",
        "pl": "Paczka opuściła sortownię i jedzie do kolejnego punktu sieci logistycznej.",
        "fr": "Le colis a quitté un centre de tri et se dirige vers l'étape logistique suivante.",
        "es": "El paquete salió de un centro de clasificación y avanza al siguiente punto de la red.",
    },
    "OUT_FOR_DELIVERY": {
        "hu": "A csomagot felrakták a kézbesítő járműre; a futár a címzett felé tart vele.",
        "en": "The parcel is loaded on the delivery vehicle and the courier is heading to the recipient.",
        "de": "Das Paket wurde in das Zustellfahrzeug geladen; der Fahrer ist zum Empfänger unterwegs.",
        "pl": "Paczka jest w samochodzie doręczyciela, który jedzie do odbiorcy.",
        "fr": "Le colis est chargé dans le véhicule de livraison et le livreur se dirige vers le destinataire.",
        "es": "El paquete va en el vehículo de reparto y el mensajero se dirige al destinatario.",
    },
    "READY_FOR_PICKUP": {
        "hu": "Az átvételi PIN aktiválódott; a csomag már a kiválasztott automatában vár.",
        "en": "The pickup PIN is active and the parcel is waiting inside the selected locker.",
        "de": "Die Abhol-PIN ist aktiv; das Paket liegt bereits im ausgewählten Automaten.",
        "pl": "Kod odbioru jest aktywny, a paczka czeka już w wybranym automacie.",
        "fr": "Le code de retrait est actif et le colis attend déjà dans la consigne choisie.",
        "es": "El PIN de recogida está activo y el paquete ya espera en la taquilla seleccionada.",
    },
    "DELIVERED": {
        "hu": "A címzett átvételét rögzítettük; a kézbesítés lezárult.",
        "en": "Recipient acceptance was recorded and the delivery is closed.",
        "de": "Die Annahme durch den Empfänger wurde erfasst; die Zustellung ist abgeschlossen.",
        "pl": "Odbiór przez adresata został potwierdzony; doręczenie jest zakończone.",
        "fr": "La réception par le destinataire a été enregistrée; la livraison est terminée.",
        "es": "Se registró la recepción por el destinatario y la entrega ha finalizado.",
    },
    "DELIVERY_FAILED": {
        "hu": "A mai kézbesítési kísérlet sikertelen volt, ezért új kézbesítési lépés szükséges.",
        "en": "Today's delivery attempt failed and another delivery action is required.",
        "de": "Der heutige Zustellversuch ist fehlgeschlagen; ein weiterer Zustellschritt ist erforderlich.",
        "pl": "Dzisiejsza próba doręczenia nie powiodła się i potrzebne jest kolejne działanie.",
        "fr": "La tentative de livraison d'aujourd'hui a échoué; une nouvelle action est nécessaire.",
        "es": "El intento de entrega de hoy falló y será necesaria otra actuación de reparto.",
    },
    "DELAYED": {
        "hu": "A szállítás csúszik, a várható érkezési idő késővbe módosult, de új kézbesítési kísérlet még nem törtérnt.",
        "en": "Transit is running late and the ETA moved later; no new delivery attempt has occurred.",
        "de": "Der Transport verspätet sich und die ETA wurde nach hinten verschoben; ein neuer Zustellversuch fand noch nicht statt.",
        "pl": "Transport jest opóź�iony i termin przesunięto; nie bzło jeszcze kolejnej próby doręczenia.",
        "fr": "Le transport est en retard et l'heure estimée a été repousqée; aucune nouvelle tentative n'a u lieu.",
        "es": "El transporte lleva retraso y la hora estimada se ha aplazado; aún no hub