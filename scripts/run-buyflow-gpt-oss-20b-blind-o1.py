import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

MODEL = "gpt-oss:20b"
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
OUT_DIR = Path.home() / "Desktop" / "buyflow-gpt-oss-20b-blind-o1"
OUT_DIR.mkdir(parents=True, exist_ok=True)

EVENTS = [
    "ORDER_CREATED", "ORDER_PROCESSING", "PAYMENT", "INVOICE", "SHIPMENT_CREATED",
    "SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "READY_FOR_PICKUP", "DELIVERED",
    "CANCELLED", "REFUNDED", "RETURN", "OTHER",
]
PERSPECTIVES = ["buyer", "merchant_outbound", "non_purchase"]
LINKS = ["linked", "unresolved", "not_applicable"]
FIELDS = ["event_type", "perspective", "order_id", "tracking_id", "link_status"]

SCHEMA = {
    "type": "object",
    "properties": {
        "event_type": {"type": "string", "enum": EVENTS},
        "perspective": {"type": "string", "enum": PERSPECTIVES},
        "order_id": {"type": ["string", "null"]},
        "tracking_id": {"type": ["string", "null"]},
        "link_status": {"type": "string", "enum": LINKS},
    },
    "required": FIELDS,
    "additionalProperties": False,
}

SYSTEM = """You classify commerce emails for BuyFlow. Return exactly one JSON object matching the provided schema.
Use only the allowed enum values. Never invent IDs or facts.

BuyFlow semantics:
- perspective=buyer: the mailbox owner is on the customer/buyer side of this purchase event, even when the sender is a merchant, warehouse, payment provider, invoice provider, or carrier.
- perspective=merchant_outbound: use only when the mailbox owner is explicitly the seller/merchant sending parcels to their own customers.
- perspective=non_purchase: marketing, security, survey, preference, or other non-purchase messages.
- linked: an exact order_id is present, or an explicit verified order-to-tracking relation is present.
- unresolved: this is a real purchase lifecycle event but no exact purchase link is available or the candidates are ambiguous.
- not_applicable: no purchase lifecycle linking is required for the message.
- SHIPMENT_CREATED: label/pre-advice/tracking created, but carrier has NOT physically collected the parcel.
- SHIPPED: carrier physically collected the parcel from sender; no later carrier-network movement is the current event.
- IN_TRANSIT: parcel is moving/processed inside the carrier network, including return to a depot after a failed delivery attempt.
- OUT_FOR_DELIVERY: parcel is assigned to the courier/vehicle for today's delivery route.
- READY_FOR_PICKUP: parcel is physically at locker/pickup point and available for collection.
- DELIVERED: recipient handoff completed.
- REFUNDED: money was actually sent back/completed.
- RETURN: returned parcel was physically received by merchant/returns warehouse.
- A refund request or a return-label creation alone is not REFUNDED/RETURN; use OTHER if no settled lifecycle event occurred.
Prefer the current message state over quoted/older history."""

# Fresh O1 set, independent of Blind V4/V5. Aggregate-only on first use.
CASES = [
    ("o1-001", "Feladó: order@northshop.hu\nTárgy: Megrendelés fogadva – NS-48120\n\nA NS-48120 rendelést rögzítettük. A raktári feldolgozás ezután kezdődik.", dict(event_type="ORDER_CREATED", perspective="buyer", order_id="NS-48120", tracking_id=None, link_status="linked")),
    ("o1-002", "Feladó: packing@techstore.hu\nTárgy: TS-8841 összekészítés alatt\n\nA TS-8841 rendelés tételeit csomagoljuk. A futár még nem érkezett meg, fuvarcímke sincs lezárva.", dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="TS-8841", tracking_id=None, link_status="linked")),
    ("o1-003", "Feladó: receipt@pay.example\nTárgy: Payment captured\n\nMerchant order: P-77109\nTransaction: TX-902211\nThe card payment was approved and captured successfully.", dict(event_type="PAYMENT", perspective="buyer", order_id="P-77109", tracking_id=None, link_status="linked")),
    ("o1-004", "Feladó: notify@bankpay.example\nTárgy: Sikeres fizetés\n\nTranzakció: 99117720\nÖsszeg: 12 490 Ft\nA fizetés sikeresen teljesült. Rendelési azonosító nem szerepel ebben az értesítésben.", dict(event_type="PAYMENT", perspective="buyer", order_id=None, tracking_id=None, link_status="unresolved")),
    ("o1-005", "Feladó: invoice@billing.example\nTárgy: Számla elkészült – AL-55018\n\nRendelés: AL-55018\nSzámlaszám: INV-2026-88712\nAz elektronikus számlát kiállítottuk.", dict(event_type="INVOICE", perspective="buyer", order_id="AL-55018", tracking_id=None, link_status="linked")),
    ("o1-006", "Feladó: no-reply@eszamla.example\nTárgy: Új e-számla\n\nBizonylat: SZ-2609-4418\nAz e-számla elkészült. A levél nem tartalmaz rendelési azonosítót.", dict(event_type="INVOICE", perspective="buyer", order_id=None, tracking_id=None, link_status="unresolved")),
    ("o1-007", "Feladó: shipping@homestore.hu\nTárgy: Csomagszám létrehozva\n\nRendelés HS-33208\nTracking GLS554400821\nA címkét kinyomtattuk 11:08-kor. A GLS még nem vette át a dobozt, az a feladói raktárban van.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="HS-33208", tracking_id="GLS554400821", link_status="linked")),
    ("o1-008", "Feladó: label@parcel.example\nTárgy: Shipping data received\n\nTracking UPS770011223\nElectronic shipment data received. No physical pickup scan yet; parcel remains with sender.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id=None, tracking_id="UPS770011223", link_status="unresolved")),
    ("o1-009", "Feladó: dispatch@urbanmarket.hu\nTárgy: A futár átvette – UM-7714\n\nRendelés UM-7714\nCsomag EO663300117\n17:22-kor az Express One futára fizikailag átvette a lezárt csomagot a feladó telephelyén.", dict(event_type="SHIPPED", perspective="buyer", order_id="UM-7714", tracking_id="EO663300117", link_status="linked")),
    ("o1-010", "Feladó: origin@carrier.example\nTárgy: Sender pickup completed\n\nDPD881122440\nThe driver collected the parcel from the sender at 14:36. First hub scan has not happened yet.", dict(event_type="SHIPPED", perspective="buyer", order_id=None, tracking_id="DPD881122440", link_status="unresolved")),
    ("o1-011", "Feladó: hub@carrier.example\nTárgy: Linehaul movement\n\nTracking SDY440099221\n00:42 hub arrival\n02:19 sorted\n03:07 departed toward the next regional depot.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="SDY440099221", link_status="unresolved")),
    ("o1-012", "Feladó: route@delivery.example\nTárgy: Ma kézbesítjük – BF-30991\n\nRendelés BF-30991\nTracking MPL990044118\n07:18-kor a csomagot a mai 24-es kézbesítési kör futárjához és járművéhez rendelték. Érkezés ma várható.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id="BF-30991", tracking_id="MPL990044118", link_status="linked")),
    ("o1-013", "Feladó: locker@parcel.example\nTárgy: Átvehető a csomag\n\nFOX771122004\nA csomagot elhelyeztük a 114-es automatában. PIN: 660281. Mostantól átvehető.", dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="FOX771122004", link_status="unresolved")),
    ("o1-014", "Feladó: pod@carrier.example\nTárgy: Kézbesítés lezárva – KD-8802\n\nRendelés KD-8802\nTracking PKT110077452\nÁtadás: 16:03\nÁtvette: címzett. A kézbesítés sikeresen lezárult.", dict(event_type="DELIVERED", perspective="buyer", order_id="KD-8802", tracking_id="PKT110077452", link_status="linked")),
    ("o1-015", "Feladó: service@bookshop.hu\nTárgy: BS-4407 törölve\n\nA BS-4407 rendelést véglegesen töröltük. Nem kerül csomagolásra vagy szállításra.", dict(event_type="CANCELLED", perspective="buyer", order_id="BS-4407", tracking_id=None, link_status="linked")),
    ("o1-016", "Feladó: finance@fashion.hu\nTárgy: Refund completed – RF-66120\n\nOrder RF-66120\nA 31 990 Ft visszatérítést elküldtük az eredeti bankkártyára. Refund status: completed.", dict(event_type="REFUNDED", perspective="buyer", order_id="RF-66120", tracking_id=None, link_status="linked")),
    ("o1-017", "Feladó: returns@shop.example\nTárgy: Visszáru beérkezett – RT-77108\n\nRendelés RT-77108\nA visszaküldött csomagot a visszáru-raktár fizikailag átvette ma 09:18-kor.", dict(event_type="RETURN", perspective="buyer", order_id="RT-77108", tracking_id=None, link_status="linked")),
    ("o1-018", "Feladó: deals@promo.hu\nTárgy: 20% kedvezmény hétvégén\n\nKupon: DPD-881122440-SALE\nEz promóciós kuponkód, nem csomagszám. Vásárolj most 20% kedvezménnyel!", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("o1-019", "Feladó: feedback@carrier.example\nTárgy: Értékeld a múlt heti kézbesítést\n\nRendelés SV-771\nTracking MPL220044551\nKérjük, értékeld 1–5 csillaggal a már lezárt kézbesítést. Nincs új csomagállapot.", dict(event_type="OTHER", perspective="non_purchase", order_id="SV-771", tracking_id="MPL220044551", link_status="linked")),
    ("o1-020", "Feladó: settings@parcel.example\nTárgy: Push értesítések bekapcsolva\n\nTracking GLS009988771\nMostantól push értesítést küldünk e-mail helyett. Ez csak értesítési beállítás, a csomag állapota nem változott.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id="GLS009988771", link_status="not_applicable")),
    ("o1-021", "Feladó: pickup@carrier.example\nTárgy: Partneri begyűjtés holnap\n\nTisztelt Webshop Partner! Holnap 13–15 óra között érkezünk az Ön telephelyére az Ön webshopja által a vevőinek feladandó csomagok rendszeres begyűjtésére. Ez nem egy konkrét vásárlói küldemény státusza.", dict(event_type="OTHER", perspective="merchant_outbound", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("o1-022", "Feladó: carrier@b2b.example\nTárgy: Vevői csomag átvéve – SHOP-4108\n\nAz Ön webshopjának vevői rendelése: SHOP-4108\nTracking GLS771144880\nA futár 15:41-kor fizikailag átvette az Ön által a vásárlójának feladott csomagot.", dict(event_type="SHIPPED", perspective="merchant_outbound", order_id="SHOP-4108", tracking_id="GLS771144880", link_status="linked")),
    ("o1-023", "Feladó: order@kitchen.hu\nTárgy: KH-9904 feldolgozás alatt\n\nJelenlegi állapot: a KH-9904 rendelést összekészítjük, futárfelvétel még nem történt.\n\n> Korábbi automatikus szöveg:\n> Ha átadjuk a futárnak, külön értesítést küldünk.", dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="KH-9904", tracking_id=None, link_status="linked")),
    ("o1-024", "Feladó: exception@carrier.example\nTárgy: Új kézbesítési nap szervezés alatt\n\nTracking DPD770044119\n11:22 sikertelen kézbesítési kísérlet. 12:08 a küldemény visszaérkezett a helyi depóba; új kézbesítési nap szervezés alatt.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="DPD770044119", link_status="unresolved")),
    ("o1-025", "Feladó: shipping@watchshop.hu\nTárgy: Csomagszám módosítva – WS-5531\n\nRendelés WS-5531\nRégi tracking: GLS100200300 – érvénytelenítve\nÚj tracking: GLS100200399 – ez a jelenlegi aktív csomagszám. A csomag még a feladónál van, pickup scan nincs.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="WS-5531", tracking_id="GLS100200399", link_status="linked")),
    ("o1-026", "Feladó: tracking@carrier.example\nTárgy: Csomag továbbítás alatt\n\nLehetséges rendelések: AB-4401 vagy AB-4402; nincs igazolt hozzárendelés.\nTracking EO551199002\n02:44-kor a csomag elhagyta a budapesti depót a következő központ felé.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="EO551199002", link_status="unresolved")),
    ("o1-027", "Feladó: support@store.hu\nTárgy: Visszatérítési kérelmed megérkezett – RR-7740\n\nRendelés RR-7740\nA visszatérítési kérelmet rögzítettük. Pénzmozgás még nem történt, a kérelmet ellenőrizzük.", dict(event_type="OTHER", perspective="buyer", order_id="RR-7740", tracking_id=None, link_status="linked")),
    ("o1-028", "Feladó: returns@store.hu\nTárgy: Visszaküldési címke elkészült – RET-8821\n\nRendelés RET-8821\nA visszaküldési címkét elkészítettük. A terméket még nem adtad fel, és a visszáru-raktár nem vett át csomagot.", dict(event_type="OTHER", perspective="buyer", order_id="RET-8821", tracking_id=None, link_status="linked")),
    ("o1-029", "Feladó: dispatch@electronics.hu\nTárgy: Új csomagszám – EL-22019\n\nRendelés EL-22019\nTracking UPS331100882\nA fuvarlevél létrejött és az adatokat továbbítottuk a UPS-nek. A futár fizikai átvétele még nem történt meg.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="EL-22019", tracking_id="UPS331100882", link_status="linked")),
    ("o1-030", "Feladó: security@market.hu\nTárgy: Biztonsági értesítés\n\nÚj bejelentkezést észleltünk. Súgópélda a tudásbázisból: 'tracking format: UPS123456789'. Ez csak dokumentációs példa, nincs rendelés vagy küldeményállapot-változás.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
]


def norm(x):
    if not isinstance(x, dict):
        return None
    return {f: x.get(f) for f in FIELDS}


def call_ollama(email_text):
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Classify this email for BuyFlow:\n\n" + email_text},
        ],
        "stream": False,
        "format": SCHEMA,
        "options": {"temperature": 0, "num_predict": 128},
        "keep_alive": "10m",
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ollama HTTP {e.code}: {body}") from e
    content = data.get("message", {}).get("content", "")
    if not content:
        raise RuntimeError(f"Empty Ollama content: {data}")
    return norm(json.loads(content))


def unload():
    payload = {"model": MODEL, "keep_alive": 0}
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except Exception:
        pass


def main():
    print("==============================================================")
    print("BUYFLOW GPT-OSS-20B BLIND O1")
    print(f"Model: {MODEL} | cases={len(CASES)} | fresh holdout")
    print("Runtime: Ollama structured JSON schema + closed BuyFlow enums")
    print("Scoring: aggregate-only; per-case gold/failures HIDDEN")
    print("Blind V4/V5: NOT USED")
    print("Training: NONE | Production: OFF")
    print("==============================================================")

    preds = []
    errors = 0
    started = time.time()
    try:
        for i, (_cid, email_text, _gold) in enumerate(CASES, 1):
            print(f"[{i:02d}/{len(CASES)}] inference ... ", end="", flush=True)
            try:
                p = call_ollama(email_text)
                preds.append(p)
                print("OK")
            except Exception as e:
                preds.append(None)
                errors += 1
                print(f"ERROR: {e}")
    finally:
        unload()

    field_correct = {f: 0 for f in FIELDS}
    exact = 0
    hard_link_total = 0
    hard_link_exact = 0
    for (_cid, _email, gold), pred in zip(CASES, preds):
        if gold["link_status"] in ("unresolved", "not_applicable"):
            hard_link_total += 1
        if pred is None:
            continue
        all_ok = True
        for f in FIELDS:
            if pred[f] == gold[f]:
                field_correct[f] += 1
            else:
                all_ok = False
        if all_ok:
            exact += 1
            if gold["link_status"] in ("unresolved", "not_applicable"):
                hard_link_exact += 1

    n = len(CASES)
    pct = lambda x, d=n: round(100.0 * x / max(1, d), 2)
    summary = {
        "benchmark": "buyflow-gpt-oss-20b-blind-o1",
        "model": MODEL,
        "cases": n,
        "structured_schema": True,
        "closed_enums": True,
        "exact": {"correct": exact, "pct": pct(exact)},
        "fields": {f: {"correct": field_correct[f], "pct": pct(field_correct[f])} for f in FIELDS},
        "link_hard_exact": {"correct": hard_link_exact, "total": hard_link_total, "pct": pct(hard_link_exact, hard_link_total)},
        "errors": errors,
        "elapsed_seconds": round(time.time() - started, 1),
        "blind_v4_used": False,
        "blind_v5_used": False,
        "training": "NONE",
        "production": "OFF",
    }
    out = OUT_DIR / "summary.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n==================== RESULT ==================================")
    print(f"EXACT: {exact}/{n} = {pct(exact)}%")
    for f in FIELDS:
        print(f"{f}: {field_correct[f]}/{n} = {pct(field_correct[f])}%")
    print(f"link-hard EXACT: {hard_link_exact}/{hard_link_total} = {pct(hard_link_exact, hard_link_total)}%")
    print(f"Errors: {errors}")
    print(f"Elapsed: {summary['elapsed_seconds']/60:.1f} min")
    print("Gold/failure details: HIDDEN")
    print("Blind V4/V5: NOT USED")
    print("Production: OFF")
    print("==============================================================")
    print(f"Summary: {out}")


if __name__ == "__main__":
    main()
