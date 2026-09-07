import gc
import json
import random
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoTokenizer, BitsAndBytesConfig, Gemma3ForConditionalGeneration

SEED = 17092026
random.seed(SEED)
ROOT = Path.home() / "BuyFlowTools"
MODEL_DIR = ROOT / "models" / "gemma-3-12b-it"
BASELINE_ADAPTER = ROOT / "adapters" / "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"
CANDIDATE_ADAPTER = ROOT / "adapters" / "buyflow-v17-4-gemma3-12b-qlora-r8-cont2"
OUT_DIR = Path.home() / "Desktop" / "buyflow-v17-4-external-blind-v4"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SYSTEM = "Analyze this commerce email for BuyFlow. Return only JSON with: event_type, perspective, order_id, tracking_id, link_status. Do not invent facts."
USER_PREFIX = "Elemezd ezt az e-mailt BuyFlow szerint. Csak JSON-t adj vissza.\n\n"
FIELDS = ["event_type", "perspective", "order_id", "tracking_id", "link_status"]

# Fresh hard holdout. Hand-authored independently from V17.3/V17.4 builders.
# Blind V3 failures/gold are not used for tuning this set.
CASES = [
    ("b4-001", "Feladó: rendeleseim@webbolt.hu\nTárgy: Rendelés fogadva – HZ-84129\n\nA HZ-84129 rendelésedet rögzítettük. A készletellenőrzés ezután indul.\n\n--- Korábbi automatikus sablon ---\nHa a csomagot átadjuk a futárnak, külön üzenetet küldünk.", dict(event_type="ORDER_CREATED", perspective="buyer", order_id="HZ-84129", tracking_id=None, link_status="linked")),
    ("b4-002", "Feladó: status@urbanstore.hu\nTárgy: Művelet alatt: U-22017\n\nA raktár a U-22017 rendelés tételeit ellenőrzi és csomagolja. Futárfelvétel még nem történt.\nLábléc: Kövesd csomagodat bármikor alkalmazásunkban.", dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="U-22017", tracking_id=None, link_status="linked")),
    ("b4-003", "Feladó: receipt@paygate.example\nTárgy: Payment accepted\n\nMerchant order: KX-77108\nTransaction reference: TXN-5500991\nAmount: 18 490 HUF\nStatus: approved and captured.", dict(event_type="PAYMENT", perspective="buyer", order_id="KX-77108", tracking_id=None, link_status="linked")),
    ("b4-004", "Feladó: documents@eszamla.example\nTárgy: Új bizonylat\n\nA QP-44081 vásárláshoz kiállítottuk a SZ-2026-009814 számlát. A PDF csatolmányban található.", dict(event_type="INVOICE", perspective="buyer", order_id="QP-44081", tracking_id=None, link_status="linked")),
    ("b4-005", "Feladó: dispatch@mountshop.hu\nTárgy: Fuvarcímke elkészült\n\nOrder: MT-66014\nParcel ID: GLS908070601\nAz adatokat 06:12-kor továbbítottuk a GLS felé. A doboz a 3-as komissiózó soron vár, a fuvarozó még nem járt érte.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="MT-66014", tracking_id="GLS908070601", link_status="linked")),
    ("b4-006", "Feladó: warehouse@trendmarket.hu\nTárgy: Kiment a raktárból\n\nRendelés TM-42015 | EO904455661\n16:47-kor a lezárt küldeményt az Express One sofőrje átvette a feladó rámpáján. A raktári birtoklás megszűnt.", dict(event_type="SHIPPED", perspective="buyer", order_id="TM-42015", tracking_id="EO904455661", link_status="linked")),
    ("b4-007", "Feladó: scan@parcelnet.example\nTárgy: Hub departure\n\nTracking: DPD550044331\n22:18 BUD hub departure\n01:06 SZOL hub expected\nThe parcel is moving inside the carrier network.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="DPD550044331", link_status="unresolved")),
    ("b4-008", "Feladó: delivery@futar.example\nTárgy: Ma érkezünk\n\nMPL900114477 csomag\n07:21 – kiadva a 31-es kézbesítési kör futárának. A küldemény a járművön van, tervezett érkezés ma 10–14 óra.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id=None, tracking_id="MPL900114477", link_status="unresolved")),
    ("b4-009", "Feladó: automata@box.example\nTárgy: Rekesz zárva, csomag bent\n\nFOX880014422\nA küldeményt behelyeztük a kiválasztott automatába. Átvételi PIN: 731406. Határidő: 2026.09.10.", dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="FOX880014422", link_status="unresolved")),
    ("b4-010", "Feladó: proof@carrier.example\nTárgy: POD rögzítve\n\nPackage PKT332211009\nÁtadás időpontja: 15:42\nÁtvette: címzett\nA kézbesítési folyamat lezárva.", dict(event_type="DELIVERED", perspective="buyer", order_id=None, tracking_id="PKT332211009", link_status="unresolved")),
    ("b4-011", "Feladó: ugyfelszolgalat@homeshop.hu\nTárgy: HX-7712 rendelés megszüntetve\n\nA HX-7712 megrendelést véglegesen töröltük. A raktár nem adja át fuvarozónak, terhelés nem történik.", dict(event_type="CANCELLED", perspective="buyer", order_id="HX-7712", tracking_id=None, link_status="linked")),
    ("b4-012", "Feladó: finance@webshop.hu\nTárgy: Jóváírás teljesítve\n\nRendelés: RF-90118\nA 24 990 Ft visszatérítést feldolgoztuk és elküldtük az eredeti fizetési módra. Refund status: completed.", dict(event_type="REFUNDED", perspective="buyer", order_id="RF-90118", tracking_id=None, link_status="linked")),
    ("b4-013", "Feladó: returns@fashion.hu\nTárgy: Visszáru átvéve\n\nOrder RT-11803\nA visszaküldött dobozt a visszáru-raktár ma 09:31-kor fizikailag átvette; minőségellenőrzés következik.", dict(event_type="RETURN", perspective="buyer", order_id="RT-11803", tracking_id=None, link_status="linked")),
    ("b4-014", "Feladó: hello@dealmail.hu\nTárgy: Csomagnyi kedvezmény\n\nHétvégi villámakció! Kuponkód: GLS-DELIVERED-25. Ez kedvezménykód, nem nyomkövetési azonosító. 25% minden táskára.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b4-015", "Feladó: account@shop.hu\nTárgy: Fiókbiztonsági figyelmeztetés\n\nÚj belépést észleltünk Edge böngészőből. Ha nem te voltál, módosíts jelszót. Rendelés- vagy csomagállapot nem változott.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b4-016", "Feladó: pickup-planning@carrier.example\nTárgy: Keddi begyűjtési ablak\n\nTisztelt Partner! A holnapi rendszeres felvétel 13:00–15:00 között várható. Ez az Ön által feladandó vevői csomagok begyűjtési időablaka, nem egy konkrét vásárlói küldemény státusza.", dict(event_type="OTHER", perspective="merchant_outbound", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b4-017", "Feladó: label@store.example\nTárgy: Tracking assigned\n\nTracking number: UPS880077661\nLabel printed at 08:02. Carrier collection scan: none. Parcel remains at sender premises.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id=None, tracking_id="UPS880077661", link_status="unresolved")),
    ("b4-018", "Feladó: origin@carrier.example\nTárgy: Origin pickup confirmed\n\nSDY665544110\n10:36 – parcel physically collected from sender. First depot arrival has not happened yet.", dict(event_type="SHIPPED", perspective="buyer", order_id=None, tracking_id="SDY665544110", link_status="unresolved")),
    ("b4-019", "Feladó: tracking@carrier.example\nTárgy: Továbbítás\n\nBuyFlow kapcsolat: rendelés BF-19044 ↔ tracking GLS440088221.\n03:11-kor a küldemény elhagyta a győri depót Budapest felé.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id="BF-19044", tracking_id="GLS440088221", link_status="linked")),
    ("b4-020", "Feladó: route@carrier.example\nTárgy: Utolsó mérföld\n\nBuyFlow kapcsolat: BF-19045 / GLS440088222\nA helyi depó 07:04-kor átadta a csomagot a mai címkörzet kézbesítőjének. A futár úton van vele.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id="BF-19045", tracking_id="GLS440088222", link_status="linked")),
    ("b4-021", "Feladó: shop@kucko.hu\nTárgy: KC-5580 – előkészítés\n\nJelenlegi állapot: a rendelést összekészítjük, két tétel már becsomagolva.\n\n> Tegnapi üzenet:\n> Köszönjük, a KC-5580 rendelést rögzítettük.", dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="KC-5580", tracking_id=None, link_status="linked")),
    ("b4-022", "Feladó: carrier@network.example\nTárgy: Sikertelen címzési kísérlet\n\nDPD771100442\n12:26 kézbesítési kísérlet sikertelen. 13:05 visszaérkezett a helyi depóba, új kiszállítási nap szervezés alatt.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="DPD771100442", link_status="unresolved")),
    ("b4-023", "Feladó: lockerroute@parcel.example\nTárgy: Úton a boxhoz\n\nFOX335577991 jelenleg a regionális depóból az automatát kiszolgáló járaton mozog. Még nincs rekeszben, átvételi kód még nem érvényes.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="FOX335577991", link_status="unresolved")),
    ("b4-024", "Feladó: packing@bolt.example\nTárgy: Doboz kész\n\nRendelés: PACK-8007\nA küldeményt lezártuk, címke a dobozon. A napi fuvarozói felvétel 17:00-kor lesz; jelenleg még nálunk van.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="PACK-8007", tracking_id=None, link_status="linked")),
    ("b4-025", "Feladó: pickupscan@carrier.example\nTárgy: Átvételi scan\n\nEO771144002\n18:06 sender pickup\n18:09 rakodás befejezve\nA csomag elindult az origin depó felé.", dict(event_type="SHIPPED", perspective="buyer", order_id=None, tracking_id="EO771144002", link_status="unresolved")),
    ("b4-026", "Feladó: hub@carrier.example\nTárgy: Központi mozgás\n\nEO771144003\n00:51 hub arrival\n02:14 sorted\n03:02 linehaul departure\nNincs kézbesítő járműhöz rendelve.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="EO771144003", link_status="unresolved")),
    ("b4-027", "Feladó: lastmile@carrier.example\nTárgy: Route 18\n\nEO771144004\n08:07 loaded to delivery vehicle / route 18\nEstimated delivery: today before 17:00.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id=None, tracking_id="EO771144004", link_status="unresolved")),
    ("b4-028", "Feladó: point@carrier.example\nTárgy: Partnerponti átvétel\n\nEO771144005\nA csomagot a partnerpont készletre vette. Átvételhez a 6 jegyű kód és fényképes igazolvány szükséges. Már átvehető.", dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="EO771144005", link_status="unresolved")),
    ("b4-029", "Feladó: feedback@carrier.example\nTárgy: Értékeld a kézbesítést\n\nRendelés: FB-771\nTracking: MPL900771155\nA múlt héten lezárt kézbesítésről kérünk 1–5 csillagos értékelést. Ez kérdőív, nincs új státusz.", dict(event_type="OTHER", perspective="non_purchase", order_id="FB-771", tracking_id="MPL900771155", link_status="linked")),
    ("b4-030", "Feladó: preferences@parcel.example\nTárgy: Értesítési csatorna módosítva\n\nGLS660033119\nMostantól push helyett e-mailt kapsz. A küldemény állapota változatlan; ez csak beállításmódosítás.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id="GLS660033119", link_status="not_applicable")),
    ("b4-031", "Feladó: marketplace@platform.example\nTárgy: Szállítás előkészítve\n\nPlatform order: MP-88201\nSeller order: SELL-19011\nTracking: PKT551177009\nA partner eladó fuvarcímkét generált. A futár még nem vette át a terméket.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="MP-88201", tracking_id="PKT551177009", link_status="linked")),
    ("b4-032", "Feladó: marketplace@platform.example\nTárgy: Partner átadta a csomagot\n\nPlatform order: MP-88202\nSeller ref: SELL-19012\nTracking PKT551177010\nA fuvarozó 11:48-kor fizikailag átvette a partner raktárában.", dict(event_type="SHIPPED", perspective="buyer", order_id="MP-88202", tracking_id="PKT551177010", link_status="linked")),
    ("b4-033", "Feladó: pay@provider.example\nTárgy: Sikeres kártyás fizetés\n\nPayment reference: P-99001177\nMerchant: Example Store\nÖsszeg: 9 990 Ft\nA tranzakció sikeres, de a kereskedő rendelési azonosítója nem szerepel ebben az üzenetben.", dict(event_type="PAYMENT", perspective="buyer", order_id=None, tracking_id=None, link_status="unresolved")),
    ("b4-034", "Feladó: invoice@billing.example\nTárgy: E-számla kiállítva\n\nInvoice: INV-2026-88014\nVevői bizonylat elkészült. Rendelésszámot ez az értesítés nem tartalmaz.", dict(event_type="INVOICE", perspective="buyer", order_id=None, tracking_id=None, link_status="unresolved")),
    ("b4-035", "Feladó: service@shop.example\nTárgy: A-771 és B-882 ügy\n\nAz A-771 rendelés változatlan. A B-882 rendelést viszont most végleg töröltük, szállítás nem lesz.", dict(event_type="CANCELLED", perspective="buyer", order_id="B-882", tracking_id=None, link_status="linked")),
    ("b4-036", "Feladó: returns@shop.example\nTárgy: Visszatérítési kérelem fogadva – RR-4402\n\nA RR-4402 rendelésre benyújtott visszatérítési kérelmet rögzítettük. Még vizsgáljuk; pénzt nem utaltunk vissza és jóváírás nem történt.", dict(event_type="OTHER", perspective="buyer", order_id="RR-4402", tracking_id=None, link_status="linked")),
    ("b4-037", "Feladó: returnportal@shop.example\nTárgy: Visszaküldési címke elkészült – RET-5503\n\nA RET-5503 rendeléshez létrehoztuk a visszáru címkét. A terméket még nem adtad fel, a raktár nem vette át.", dict(event_type="OTHER", perspective="buyer", order_id="RET-5503", tracking_id=None, link_status="linked")),
    ("b4-038", "Feladó: carrier-b2b@parcel.example\nTárgy: Vevői csomag kézbesítve\n\nPartner rendelés: SHOP-77881\nTracking: DPD990011442\nAz Ön webáruházából feladott küldeményt a címzett ma 14:10-kor átvette.", dict(event_type="DELIVERED", perspective="merchant_outbound", order_id="SHOP-77881", tracking_id="DPD990011442", link_status="linked")),
    ("b4-039", "Feladó: collections@carrier.example\nTárgy: Napi partnerfelvétel megerősítve\n\nHolnap 9–11 között 14 darab, ügyfeleknek szánt csomagot veszünk fel az Ön raktárában. Pickup batch: PU-20260908-14.", dict(event_type="OTHER", perspective="merchant_outbound", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b4-040", "Feladó: b2b-status@carrier.example\nTárgy: Feladói átvétel megtörtént\n\nPartner order: B2B-44019\nTracking: GLS771144229\nA futár az Ön telephelyén a konkrét vevői küldeményt 16:22-kor átvette és elszállította.", dict(event_type="SHIPPED", perspective="merchant_outbound", order_id="B2B-44019", tracking_id="GLS771144229", link_status="linked")),
    ("b4-041", "Feladó: updates@shop.example\nTárgy: Hírlevél – szállítási tippek\n\nHogyan érkezik gyorsabban a csomagod? Olvasd el útmutatónkat. Példa követési szám: DPD123456789. Ez oktatási minta, nem aktív küldemény.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b4-042", "Feladó: legal@shop.example\nTárgy: Adatkezelési tájékoztató frissült\n\nA dokumentum verziója: ORD-2026-09. Ez dokumentumverzió, nem rendelési azonosító. Nincs vásárlási esemény.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b4-043", "From: order-confirm@store.example\nSubject: We got your order\n\nOrder number: EN-41077\nYour purchase was accepted. Warehouse processing has not started yet and no shipment exists.", dict(event_type="ORDER_CREATED", perspective="buyer", order_id="EN-41077", tracking_id=None, link_status="linked")),
    ("b4-044", "From: warehouse@store.example\nSubject: Packing in progress\n\nOrder EN-41078 is being picked and packed. No carrier handoff or label has occurred yet.", dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="EN-41078", tracking_id=None, link_status="linked")),
    ("b4-045", "From: shipping@store.example\nSubject: Shipping label registered\n\nOrder EN-41079\nTracking UPS220011889\nElectronic pre-advice accepted by UPS. The parcel is still on the merchant shelf awaiting collection.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="EN-41079", tracking_id="UPS220011889", link_status="linked")),
    ("b4-046", "From: origin@carrier.example\nSubject: Collected from sender\n\nTracking UPS220011890\nThe driver collected the physical parcel from the merchant at 17:02. It has not reached the first hub yet.", dict(event_type="SHIPPED", perspective="buyer", order_id=None, tracking_id="UPS220011890", link_status="unresolved")),
    ("b4-047", "From: network@carrier.example\nSubject: In network\n\nTracking UPS220011891\nDeparted Vienna hub 02:40, inbound scan expected Budapest 06:15. Not assigned to a delivery route.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="UPS220011891", link_status="unresolved")),
    ("b4-048", "From: local@carrier.example\nSubject: Out with courier today\n\nTracking UPS220011892\nLoaded onto the local delivery van at 07:33. Scheduled for delivery today.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id=None, tracking_id="UPS220011892", link_status="unresolved")),
    ("b4-049", "From: pickup@parcel.example\nSubject: Ready at pickup point\n\nTracking PKT880022114\nThe parcel has been checked into the pickup location and can now be collected with code 991420.", dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="PKT880022114", link_status="unresolved")),
    ("b4-050", "From: pod@carrier.example\nSubject: Delivered\n\nTracking PKT880022115\nDelivered to recipient at 13:57. Proof of delivery recorded. No further delivery attempt is planned.", dict(event_type="DELIVERED", perspective="buyer", order_id=None, tracking_id="PKT880022115", link_status="unresolved")),
    ("b4-051", "From: support@store.example\nSubject: Order cancelled\n\nOrder EN-41080 has been cancelled permanently. It will not be packed or shipped.", dict(event_type="CANCELLED", perspective="buyer", order_id="EN-41080", tracking_id=None, link_status="linked")),
    ("b4-052", "From: refunds@store.example\nSubject: Refund completed\n\nOrder EN-41081\nThe refund was completed to the original card. Amount 42.00 EUR.", dict(event_type="REFUNDED", perspective="buyer", order_id="EN-41081", tracking_id=None, link_status="linked")),
    ("b4-053", "From: returns@store.example\nSubject: Returned parcel received\n\nOrder EN-41082\nThe warehouse physically received your returned parcel this morning. Inspection is pending.", dict(event_type="RETURN", perspective="buyer", order_id="EN-41082", tracking_id=None, link_status="linked")),
    ("b4-054", "Feladó: finance@shop.example\nTárgy: Jóváírás lezárva – RR-9021\n\nA RR-9021 rendelés teljes összegét ma visszautaltuk.\n\n--- Előző üzenet ---\nA rendelést tegnap töröltük, a refund még feldolgozásra várt.", dict(event_type="REFUNDED", perspective="buyer", order_id="RR-9021", tracking_id=None, link_status="linked")),
    ("b4-055", "Feladó: courier@parcel.example\nTárgy: Ma kézbesítjük – GLS901144776\n\n07:48 – a küldemény a kézbesítő autóra került.\n\n> Tegnapi állapot: elektronikus címke létrehozva, csomag a feladónál.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id=None, tracking_id="GLS901144776", link_status="unresolved")),
    ("b4-056", "Feladó: shipping@store.example\nTárgy: Szállítási adat létrehozva\n\nOrder: SZ-77190\nTracking: MPL551188440\nA fuvarozói címke elkészült; a csomag még a feladó raktárában.\n\nMarketing lábléc: Gyors kézbesítés, garantált öröm – már több mint 1 millió delivered csomag!", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="SZ-77190", tracking_id="MPL551188440", link_status="linked")),
    ("b4-057", "Feladó: pod@parcel.example\nTárgy: Átadás megtörtént\n\nTracking FOX660022118\n16:26 – címzett átvette.\n\n> 08:10 – csomag kiadva a mai kézbesítő járatra.", dict(event_type="DELIVERED", perspective="buyer", order_id=None, tracking_id="FOX660022118", link_status="unresolved")),
    ("b4-058", "Feladó: confirmation@shop.example\nTárgy: Rendelés V-8801 fogadva\n\nA V-8801 rendelés létrejött. Kedvezménykódod: TRACK-GLS-778899. A kedvezménykód nem csomagszám, szállítás még nincs.", dict(event_type="ORDER_CREATED", perspective="buyer", order_id="V-8801", tracking_id=None, link_status="linked")),
    ("b4-059", "Feladó: shipping@shop.example\nTárgy: Új csomagszám – W-7712\n\nRendelés: W-7712\nRégi tracking GLS110022330 – érvénytelenítve, ne használd.\nÚj tracking GLS110022331 – címke most létrehozva. A futár még nem vette át a csomagot.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="W-7712", tracking_id="GLS110022331", link_status="linked")),
    ("b4-060", "Feladó: service@shop.example\nTárgy: Rendelés B-912 állapota\n\nKapcsolódó korábbi rendelés: A-811 – már lezárva.\nAktuális rendelés: B-912. A B-912 csomagolása folyamatban, futárnak még nem adtuk át.", dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="B-912", tracking_id=None, link_status="linked")),
]


def norm(v):
    if not isinstance(v, dict):
        return {k: None for k in FIELDS}
    return {k: v.get(k) for k in FIELDS}


def extract_json(text):
    t = str(text or "").strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    if "```" in t:
        for p in t.split("```"):
            p = p.strip()
            if p.lower().startswith("json"):
                p = p[4:].strip()
            try:
                return json.loads(p)
            except Exception:
                pass
    a, b = t.find("{"), t.rfind("}")
    if a >= 0 and b > a:
        return json.loads(t[a:b+1])
    raise ValueError("invalid_json")


def load_model(adapter_dir):
    qconfig = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    base = Gemma3ForConditionalGeneration.from_pretrained(
        str(MODEL_DIR),
        quantization_config=qconfig,
        device_map={"": 0},
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="eager",
        local_files_only=True,
    )
    model = PeftModel.from_pretrained(base, str(adapter_dir), is_trainable=False, local_files_only=True)
    model.eval()
    return model


def classify(model, tokenizer, email_text):
    user = USER_PREFIX + email_text
    msgs = [{"role": "user", "content": SYSTEM + "\n\n" + user}]
    rendered = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(rendered, return_tensors="pt").to("cuda")
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=160,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    gen = out[0, inputs["input_ids"].shape[1]:]
    text = tokenizer.decode(gen, skip_special_tokens=True)
    return norm(extract_json(text))


def score(preds):
    fc = {f: 0 for f in FIELDS}
    exact = 0
    errors = 0
    link_hard_total = 0
    link_hard_correct = 0
    for case, pred in zip(CASES, preds):
        gold = norm(case[2])
        if gold["link_status"] in ("unresolved", "not_applicable"):
            link_hard_total += 1
        if pred is None:
            errors += 1
            continue
        all_ok = True
        for f in FIELDS:
            if pred[f] == gold[f]:
                fc[f] += 1
            else:
                all_ok = False
        if all_ok:
            exact += 1
            if gold["link_status"] in ("unresolved", "not_applicable"):
                link_hard_correct += 1
    n = len(CASES)
    pct = lambda x, d=n: round(x / max(1, d) * 100, 2)
    return {
        "cases": n,
        "exact": {"correct": exact, "pct": pct(exact)},
        "fields": {f: {"correct": fc[f], "pct": pct(fc[f])} for f in FIELDS},
        "link_hard_exact": {"correct": link_hard_correct, "total": link_hard_total, "pct": pct(link_hard_correct, link_hard_total)},
        "errors": errors,
    }


def run_adapter(name, adapter_dir, tokenizer):
    print(f"\nLoading {name} adapter...")
    model = load_model(adapter_dir)
    print(f"{name} LOAD: PASS")
    preds = []
    for i, (_cid, email_text, _gold) in enumerate(CASES, 1):
        print(f"[{name} {i:02d}/{len(CASES)}] inference ... ", end="", flush=True)
        try:
            preds.append(classify(model, tokenizer, email_text))
            print("OK")
        except Exception as e:
            preds.append(None)
            print(f"ERROR {e}")
    summary = score(preds)
    del model
    gc.collect()
    torch.cuda.empty_cache()
    return summary


def show(label, s):
    print(f"\n{label}")
    print(f"EXACT: {s['exact']['correct']}/{s['cases']} = {s['exact']['pct']}%")
    for f in FIELDS:
        x = s['fields'][f]
        print(f"{f}: {x['correct']}/{s['cases']} = {x['pct']}%")
    lh = s['link_hard_exact']
    print(f"link-hard EXACT: {lh['correct']}/{lh['total']} = {lh['pct']}%")
    print(f"Errors: {s['errors']}")


def main():
    if not torch.cuda.is_available():
        raise RuntimeError("ROCm GPU not visible")
    for p in (MODEL_DIR, BASELINE_ADAPTER, CANDIDATE_ADAPTER):
        if not p.exists():
            raise RuntimeError(f"Missing: {p}")

    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("==============================================================")
    print("BUYFLOW V17.4 EXTERNAL BLIND V4 - V17.3 vs V17.4")
    print(f"Cases: {len(CASES)} | fresh HARD holdout | aggregate-only")
    print("Prompt: MINIMAL | no taxonomy/rule list")
    print("Focus: lifecycle boundaries + link_status + quoted/noisy emails")
    print("Per-case gold/failures: HIDDEN")
    print("Blind V3: NOT READ / NOT MODIFIED")
    print("Production: OFF")
    print("==============================================================")

    baseline = run_adapter("V17_3_BASELINE", BASELINE_ADAPTER, tokenizer)
    candidate = run_adapter("V17_4_CANDIDATE", CANDIDATE_ADAPTER, tokenizer)

    print("\n==================== BLIND V4 RESULT =========================")
    show("V17.3 baseline (previous Blind V3 exact 85%)", baseline)
    show("V17.4 candidate (5000-row continuation)", candidate)

    print("\n==================== DELTA ===================================")
    print(f"EXACT: {baseline['exact']['pct']:.2f}% -> {candidate['exact']['pct']:.2f}% | delta={candidate['exact']['pct']-baseline['exact']['pct']:+.2f} pp")
    for f in FIELDS:
        a = baseline['fields'][f]['pct']
        b = candidate['fields'][f]['pct']
        print(f"{f}: {a:.2f}% -> {b:.2f}% | delta={b-a:+.2f} pp")
    a = baseline['link_hard_exact']['pct']
    b = candidate['link_hard_exact']['pct']
    print(f"link-hard EXACT: {a:.2f}% -> {b:.2f}% | delta={b-a:+.2f} pp")
    print("Gold/failure details: HIDDEN")
    print("Production: OFF")
    print("==============================================================")

    summary = {
        "benchmark": "buyflow-v17-4-external-blind-v4",
        "cases": len(CASES),
        "prompt": "minimal",
        "hard_holdout": True,
        "blind_v3_touched": False,
        "baseline_v17_3": baseline,
        "candidate_v17_4": candidate,
        "production": "OFF",
    }
    out = OUT_DIR / "summary.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Summary: {out}")


if __name__ == "__main__":
    main()
