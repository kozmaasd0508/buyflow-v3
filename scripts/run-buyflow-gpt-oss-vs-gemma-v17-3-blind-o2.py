import gc
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoTokenizer, BitsAndBytesConfig, Gemma3ForConditionalGeneration

ROOT = Path.home() / "BuyFlowTools"
MODEL_DIR = ROOT / "models" / "gemma-3-12b-it"
GEMMA_ADAPTER = ROOT / "adapters" / "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"
OUT_DIR = Path.home() / "Desktop" / "buyflow-blind-o2-gptoss-vs-gemma-v17-3"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
GPT_OSS_MODEL = "gpt-oss:20b"

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

SYSTEM = """Classify this commerce email for BuyFlow. Return exactly one JSON object with event_type, perspective, order_id, tracking_id, link_status. Do not invent facts.
Allowed event_type: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
Allowed perspective: buyer, merchant_outbound, non_purchase.
Allowed link_status: linked, unresolved, not_applicable.
Semantics:
- buyer = mailbox owner is the customer side, even if sender is merchant, warehouse, payment provider, invoice provider or carrier.
- merchant_outbound = mailbox owner is explicitly the seller sending parcels to its own customers.
- non_purchase = marketing, security, survey, preference or other non-purchase content.
- linked = exact order id is present for this event, or an explicit verified order-to-tracking relation exists.
- unresolved = real purchase lifecycle event but no exact purchase link is available, or multiple purchase candidates remain.
- not_applicable = no purchase lifecycle linking is required.
- SHIPMENT_CREATED = label/pre-advice/tracking created but carrier has not physically collected the parcel.
- SHIPPED = carrier physically collected the parcel from sender; no later network movement is the current state.
- IN_TRANSIT = parcel is moving/processed inside carrier network; a failed delivery followed by return to depot is IN_TRANSIT.
- OUT_FOR_DELIVERY = assigned to local courier/vehicle for today's route.
- READY_FOR_PICKUP = physically at locker/pickup point and available for collection.
- DELIVERED = recipient handoff completed.
- REFUNDED = money was actually returned/completed.
- RETURN = returned parcel was physically received by merchant/returns warehouse.
- Refund request, refund processing started, or return-label creation alone are not REFUNDED/RETURN; use OTHER when no settled lifecycle event occurred.
- Prefer current message state over quoted/older history.
- Ignore example IDs, coupon-like codes, document numbers and transaction IDs unless the email explicitly identifies them as order/tracking IDs.
"""

# Fresh Blind O2. Hand-authored independently of O1, Blind V4 and future Blind V5.
CASES = [
    ("o2-001", "Feladó: orders@bluehome.hu\nTárgy: Rendelésed megérkezett – BH-73106\n\nA BH-73106 megrendelést sikeresen rögzítettük. A készletellenőrzés és összekészítés csak ezután indul.", dict(event_type="ORDER_CREATED", perspective="buyer", order_id="BH-73106", tracking_id=None, link_status="linked")),
    ("o2-002", "Feladó: warehouse@fitshop.hu\nTárgy: FS-20218 csomagolás alatt\n\nA FS-20218 rendelés termékeit a raktár összekészíti. Fuvarcímke még nincs, a futár nem vette át.", dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="FS-20218", tracking_id=None, link_status="linked")),
    ("o2-003", "Feladó: payment@paygate.example\nTárgy: Card payment settled\n\nOrder reference: PG-66041\nTransaction: TRX-889100\nThe card charge was approved and captured.", dict(event_type="PAYMENT", perspective="buyer", order_id="PG-66041", tracking_id=None, link_status="linked")),
    ("o2-004", "Feladó: notify@cardpay.example\nTárgy: Fizetés sikeres\n\nTranzakció azonosító: 552901772\nÖsszeg: 8 490 Ft\nA fizetés teljesült. A levél nem tartalmaz rendelési azonosítót.", dict(event_type="PAYMENT", perspective="buyer", order_id=None, tracking_id=None, link_status="unresolved")),
    ("o2-005", "Feladó: invoice@docs.example\nTárgy: E-számla kiállítva – EL-91802\n\nRendelés: EL-91802\nSzámlaszám: INV-2026-091802\nAz elektronikus számlát elkészítettük és csatoltuk.", dict(event_type="INVOICE", perspective="buyer", order_id="EL-91802", tracking_id=None, link_status="linked")),
    ("o2-006", "Feladó: billing@eszamla.example\nTárgy: Új számla érkezett\n\nBizonylat: SZ-441820\nAz e-számla elkészült. Rendelési hivatkozás nem található ebben az üzenetben.", dict(event_type="INVOICE", perspective="buyer", order_id=None, tracking_id=None, link_status="unresolved")),
    ("o2-007", "Feladó: shipping@greenstore.hu\nTárgy: Fuvarcímke létrehozva – GS-44017\n\nRendelés GS-44017\nTracking GLS620044118\nA címke elkészült, az adatokat továbbítottuk. A doboz még a feladó raktárában van, pickup scan nincs.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="GS-44017", tracking_id="GLS620044118", link_status="linked")),
    ("o2-008", "Feladó: prealert@carrier.example\nTárgy: Shipment information received\n\nTracking UPS881104421\nElectronic pre-advice received. The parcel has not been collected from sender yet.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id=None, tracking_id="UPS881104421", link_status="unresolved")),
    ("o2-009", "Feladó: dispatch@urbanbox.hu\nTárgy: Futárnak átadva – UB-77109\n\nRendelés UB-77109\nCsomag EO510077144\n15:52-kor az Express One sofőrje fizikailag átvette a lezárt csomagot a feladótól. Depó scan még nincs.", dict(event_type="SHIPPED", perspective="buyer", order_id="UB-77109", tracking_id="EO510077144", link_status="linked")),
    ("o2-010", "Feladó: origin@parcel.example\nTárgy: Sender collection completed\n\nDPD441177002\nThe driver physically collected the parcel from the merchant at 13:18. No hub movement recorded yet.", dict(event_type="SHIPPED", perspective="buyer", order_id=None, tracking_id="DPD441177002", link_status="unresolved")),
    ("o2-011", "Feladó: network@carrier.example\nTárgy: Hub transfer\n\nBuyFlow kapcsolat: rendelés BF-62091 / tracking SDY883311220\n01:22 hub arrival\n03:07 sorted\n04:11 departed to the next regional hub.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id="BF-62091", tracking_id="SDY883311220", link_status="linked")),
    ("o2-012", "Feladó: tracking@delivery.example\nTárgy: Továbbítás alatt\n\nTracking MPL771144220\nA küldemény a budapesti központból a szolnoki depó felé halad. Kézbesítő futárhoz még nincs rendelve.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="MPL771144220", link_status="unresolved")),
    ("o2-013", "Feladó: lastmile@carrier.example\nTárgy: Ma kézbesítjük – DX-88012\n\nRendelés DX-88012\nTracking GLS441188550\n07:36-kor a csomagot a mai 12-es kézbesítési kör járművére rakták. Érkezés ma várható.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id="DX-88012", tracking_id="GLS441188550", link_status="linked")),
    ("o2-014", "Feladó: route@parcel.example\nTárgy: Out for delivery\n\nFOX552200118\nLoaded to local courier vehicle at 08:04. Delivery expected today before 18:00.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id=None, tracking_id="FOX552200118", link_status="unresolved")),
    ("o2-015", "Feladó: locker@box.example\nTárgy: Csomagod átvehető – LK-6601\n\nRendelés LK-6601\nTracking FOX990071122\nA csomagot a 214-es automatába helyeztük. PIN: 190842. Mostantól átvehető.", dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id="LK-6601", tracking_id="FOX990071122", link_status="linked")),
    ("o2-016", "Feladó: point@parcel.example\nTárgy: Ready for collection\n\nPKT331188004\nThe parcel is now physically at the pickup point. Collection code is active.", dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="PKT331188004", link_status="unresolved")),
    ("o2-017", "Feladó: pod@carrier.example\nTárgy: Kézbesítve – DL-90881\n\nRendelés DL-90881\nTracking DPD551122667\nÁtadás: 14:28\nÁtvette: címzett. A kézbesítés lezárult.", dict(event_type="DELIVERED", perspective="buyer", order_id="DL-90881", tracking_id="DPD551122667", link_status="linked")),
    ("o2-018", "Feladó: delivery@carrier.example\nTárgy: Delivery completed\n\nUPS550066771\nRecipient handoff completed at 16:02. Proof of delivery recorded.", dict(event_type="DELIVERED", perspective="buyer", order_id=None, tracking_id="UPS550066771", link_status="unresolved")),
    ("o2-019", "Feladó: service@homemarket.hu\nTárgy: HM-4409 rendelés törölve\n\nA HM-4409 rendelést végleg töröltük. Nem kerül csomagolásra és nem adjuk át futárnak.", dict(event_type="CANCELLED", perspective="buyer", order_id="HM-4409", tracking_id=None, link_status="linked")),
    ("o2-020", "Feladó: refund@fashion.example\nTárgy: Visszatérítés teljesítve – RF-77331\n\nOrder RF-77331\nA 19 990 Ft összeget visszaküldtük az eredeti bankkártyára. Refund status: completed.", dict(event_type="REFUNDED", perspective="buyer", order_id="RF-77331", tracking_id=None, link_status="linked")),
    ("o2-021", "Feladó: returns@shop.example\nTárgy: Visszáru beérkezett – RT-22091\n\nRendelés RT-22091\nA visszaküldött csomagot a visszáru-raktár ma 10:14-kor fizikailag átvette. Ellenőrzés következik.", dict(event_type="RETURN", perspective="buyer", order_id="RT-22091", tracking_id=None, link_status="linked")),
    ("o2-022", "Feladó: service@shop.example\nTárgy: Visszatérítési kérelmed fogadva – RR-6602\n\nRendelés RR-6602\nA refund kérelmet rögzítettük. Pénzmozgás még nem történt, elbírálás folyamatban.", dict(event_type="OTHER", perspective="buyer", order_id="RR-6602", tracking_id=None, link_status="linked")),
    ("o2-023", "Feladó: returns@fashion.example\nTárgy: Visszaküldési címke elkészült – RL-8804\n\nRendelés RL-8804\nReturn label: RET-550044\nA terméket még nem adtad fel, a visszáru-raktár nem vett át semmit.", dict(event_type="OTHER", perspective="buyer", order_id="RL-8804", tracking_id=None, link_status="linked")),
    ("o2-024", "Feladó: promo@deals.hu\nTárgy: Ingyenes szállítás hétvégén\n\nKupon: GLS441188550-FREE\nEz promóciós kupon, nem csomagszám. Rendelj vasárnap éjfélig!", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("o2-025", "Feladó: security@market.hu\nTárgy: Biztonsági értesítés\n\nÚj bejelentkezést észleltünk. Súgópélda: tracking formátum DPD123456789. Ez dokumentációs példa, nincs vásárlási esemény.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("o2-026", "Feladó: feedback@carrier.example\nTárgy: Értékeld a múlt heti kézbesítést\n\nRendelés FB-441\nTracking MPL620077155\nKérjük értékeld a már lezárt kézbesítést. Ez kérdőív, nincs új csomagállapot.", dict(event_type="OTHER", perspective="non_purchase", order_id="FB-441", tracking_id="MPL620077155", link_status="linked")),
    ("o2-027", "Feladó: preferences@parcel.example\nTárgy: Értesítési mód módosítva\n\nTracking GLS770022119\nMostantól SMS helyett push értesítést küldünk. Ez csak beállításmódosítás, a küldemény állapota nem változott.", dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id="GLS770022119", link_status="not_applicable")),
    ("o2-028", "Feladó: pickup@carrier.example\nTárgy: Partneri begyűjtés kedden\n\nTisztelt Webshop Partner! Kedden 12–14 óra között érkezünk az Ön telephelyére az Ön által vevőinek feladandó csomagok rendszeres begyűjtésére. Nem konkrét vásárlói küldemény státusza.", dict(event_type="OTHER", perspective="merchant_outbound", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("o2-029", "Feladó: b2b@carrier.example\nTárgy: Vevői csomag átvéve – SHOP-7208\n\nAz Ön webshopjának vevői rendelése: SHOP-7208\nTracking EO771199440\nA futár 16:11-kor fizikailag átvette az Ön által a vásárlójának feladott csomagot.", dict(event_type="SHIPPED", perspective="merchant_outbound", order_id="SHOP-7208", tracking_id="EO771199440", link_status="linked")),
    ("o2-030", "Feladó: pod@b2bcarrier.example\nTárgy: Vevő átvette – SHOP-7209\n\nAz Ön webshopjának vevői rendelése: SHOP-7209\nTracking GLS771199441\nA címzett 15:33-kor átvette az Ön által feladott csomagot. Kézbesítés lezárva.", dict(event_type="DELIVERED", perspective="merchant_outbound", order_id="SHOP-7209", tracking_id="GLS771199441", link_status="linked")),
    ("o2-031", "Feladó: status@kitchen.hu\nTárgy: KH-3319 jelenlegi állapota\n\nJelenleg a KH-3319 rendelést csomagoljuk, futárfelvétel még nem történt.\n\n> Korábbi automatikus levél:\n> Köszönjük, a KH-3319 rendelést rögzítettük.", dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="KH-3319", tracking_id=None, link_status="linked")),
    ("o2-032", "Feladó: dispatch@outdoor.hu\nTárgy: Futár átvette – OD-9918\n\nRendelés OD-9918\nTracking UPS440077119\nA UPS futára ma 17:04-kor fizikailag átvette a csomagot.\n\n> Tegnapi értesítés:\n> A fuvarcímke elkészült, csomag még a raktárban.", dict(event_type="SHIPPED", perspective="buyer", order_id="OD-9918", tracking_id="UPS440077119", link_status="linked")),
    ("o2-033", "Feladó: finance@store.example\nTárgy: Refund completed – RC-1108\n\nRendelés RC-1108\nMai állapot: az összeget visszaküldtük a kártyára.\n\n> Korábbi üzenet:\n> Refund request received, processing not started.", dict(event_type="REFUNDED", perspective="buyer", order_id="RC-1108", tracking_id=None, link_status="linked")),
    ("o2-034", "Feladó: exception@carrier.example\nTárgy: Új kézbesítés szervezés alatt\n\nTracking DPD880011442\n11:40 sikertelen kézbesítés. 12:31 a csomag visszaérkezett a helyi depóba; új kézbesítési nap szervezés alatt.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="DPD880011442", link_status="unresolved")),
    ("o2-035", "Feladó: lockerroute@parcel.example\nTárgy: Úton az automatához\n\nFOX441155990\nA küldemény a regionális depóból az automatát kiszolgáló járaton mozog. Még nincs rekeszben és nincs aktív átvételi kód.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="FOX441155990", link_status="unresolved")),
    ("o2-036", "Feladó: label@electronics.hu\nTárgy: Tracking assigned – ET-22019\n\nRendelés ET-22019\nTracking UPS331155882\nA fuvarlevél létrejött, az adatokat továbbítottuk. A futár fizikai átvétele még nem történt meg.", dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="ET-22019", tracking_id="UPS331155882", link_status="linked")),
    ("o2-037", "Feladó: origin@carrier.example\nTárgy: Pickup scan\n\nEO881144002\n18:06 sender pickup completed. The parcel left the merchant premises and is heading toward origin depot; depot arrival scan not yet recorded.", dict(event_type="SHIPPED", perspective="buyer", order_id=None, tracking_id="EO881144002", link_status="unresolved")),
    ("o2-038", "Feladó: hub@carrier.example\nTárgy: Központi mozgás\n\nEO881144003\n00:51 hub arrival\n02:14 sorted\n03:02 linehaul departure\nNincs helyi kézbesítő járműhöz rendelve.", dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="EO881144003", link_status="unresolved")),
    ("o2-039", "Feladó: lastmile@carrier.example\nTárgy: Route 22\n\nEO881144004\n08:07 loaded to delivery vehicle / route 22. Estimated delivery: today before 17:00.", dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id=None, tracking_id="EO881144004", link_status="unresolved")),
    ("o2-040", "Feladó: point@carrier.example\nTárgy: Partnerponti átvétel\n\nEO881144005\nA csomagot a partnerpont készletre vette. Átvételi kód aktív, a küldemény már átvehető.", dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="EO881144005", link_status="unresolved")),
]


def normalize(x):
    if not isinstance(x, dict):
        raise ValueError("not_object")
    return {f: x.get(f) for f in FIELDS}


def parse_json_text(text):
    text = (text or "").strip()
    if not text:
        raise ValueError("empty_content")
    try:
        return normalize(json.loads(text))
    except Exception:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            return normalize(json.loads(text[a:b+1]))
        raise


def call_gpt_oss(email_text):
    payload = {
        "model": GPT_OSS_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Email:\n\n" + email_text},
        ],
        "stream": False,
        "format": SCHEMA,
        "think": "low",
        "options": {"temperature": 0, "num_predict": 512},
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
        raise RuntimeError(f"Empty Ollama content; done_reason={data.get('done_reason')} thinking_chars={len(data.get('message', {}).get('thinking', ''))}")
    return parse_json_text(content)


def unload_ollama():
    try:
        payload = {"model": GPT_OSS_MODEL, "keep_alive": 0}
        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/generate",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=30).read()
    except Exception:
        pass
    try:
        subprocess.run(["ollama", "stop", GPT_OSS_MODEL], capture_output=True, timeout=30)
    except Exception:
        pass


def load_gemma():
    qconfig = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    base = Gemma3ForConditionalGeneration.from_pretrained(
        str(MODEL_DIR),
        quantization_config=qconfig,
        device_map={"": 0},
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=True,
        attn_implementation="eager",
        local_files_only=True,
    )
    model = PeftModel.from_pretrained(base, str(GEMMA_ADAPTER), is_trainable=False)
    model.eval()
    return tokenizer, model


def call_gemma(tokenizer, model, email_text):
    prompt = SYSTEM + "\n\nEmail:\n\n" + email_text
    rendered = tokenizer.apply_chat_template(
        [{"role": "user", "content": prompt}],
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer(rendered, return_tensors="pt")
    inputs = {k: v.to("cuda") for k, v in inputs.items()}
    n = inputs["input_ids"].shape[1]
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=192,
            do_sample=False,
            use_cache=True,
            pad_token_id=tokenizer.pad_token_id,
        )
    text = tokenizer.decode(out[0][n:], skip_special_tokens=True)
    del inputs, out
    return parse_json_text(text)


def score(preds):
    field_correct = {f: 0 for f in FIELDS}
    exact = 0
    errors = 0
    hard_total = 0
    hard_exact = 0
    for (_cid, _email, gold), pred in zip(CASES, preds):
        if gold["link_status"] in ("unresolved", "not_applicable"):
            hard_total += 1
        if pred is None:
            errors += 1
            continue
        ok = True
        for f in FIELDS:
            if pred.get(f) == gold[f]:
                field_correct[f] += 1
            else:
                ok = False
        if ok:
            exact += 1
            if gold["link_status"] in ("unresolved", "not_applicable"):
                hard_exact += 1
    n = len(CASES)
    pct = lambda x, d=n: round(100.0 * x / max(1, d), 2)
    return {
        "exact": {"correct": exact, "pct": pct(exact)},
        "fields": {f: {"correct": field_correct[f], "pct": pct(field_correct[f])} for f in FIELDS},
        "link_hard_exact": {"correct": hard_exact, "total": hard_total, "pct": pct(hard_exact, hard_total)},
        "errors": errors,
    }


def print_score(name, s):
    n = len(CASES)
    print(f"\n{name}")
    print(f"EXACT: {s['exact']['correct']}/{n} = {s['exact']['pct']}%")
    for f in FIELDS:
        x = s['fields'][f]
        print(f"{f}: {x['correct']}/{n} = {x['pct']}%")
    h = s['link_hard_exact']
    print(f"link-hard EXACT: {h['correct']}/{h['total']} = {h['pct']}%")
    print(f"Errors: {s['errors']}")


def main():
    print("==============================================================")
    print("BUYFLOW FRESH BLIND O2 - GPT-OSS 20B vs GEMMA V17.3")
    print(f"Cases: {len(CASES)} | same fresh cases for both models | aggregate-only")
    print("GPT-OSS: schema-constrained | think=low | num_predict=512")
    print("Gemma V17.3: same BuyFlow instruction | deterministic generation")
    print("O1 / Blind V4 / Blind V5: NOT USED")
    print("Per-case gold/failures: HIDDEN")
    print("Training: NONE | Production: OFF")
    print("==============================================================")

    for p in (MODEL_DIR, GEMMA_ADAPTER):
        if not p.exists():
            raise RuntimeError(f"Required local path missing: {p}")

    started = time.time()
    gpt_preds = []
    print("\nRunning GPT-OSS 20B...")
    try:
        for i, (_cid, email_text, _gold) in enumerate(CASES, 1):
            print(f"[GPT-OSS {i:02d}/{len(CASES)}] inference ... ", end="", flush=True)
            try:
                gpt_preds.append(call_gpt_oss(email_text))
                print("OK")
            except Exception as e:
                gpt_preds.append(None)
                print(f"ERROR: {e}")
    finally:
        unload_ollama()

    gpt_score = score(gpt_preds)
    print("\nOllama model unloaded. Preparing Gemma V17.3...")
    time.sleep(2)
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    tokenizer, gemma = load_gemma()
    print("GEMMA V17.3 LOAD: PASS")
    gemma_preds = []
    for i, (_cid, email_text, _gold) in enumerate(CASES, 1):
        print(f"[GEMMA {i:02d}/{len(CASES)}] inference ... ", end="", flush=True)
        try:
            gemma_preds.append(call_gemma(tokenizer, gemma, email_text))
            print("OK")
        except Exception as e:
            gemma_preds.append(None)
            print(f"ERROR: {e}")

    gemma_score = score(gemma_preds)

    print("\n==================== BLIND O2 RESULT =========================")
    print_score("GPT-OSS 20B (untrained for BuyFlow)", gpt_score)
    print_score("GEMMA V17.3 (BuyFlow-trained)", gemma_score)

    def delta(path1, path2):
        return round(path1 - path2, 2)

    print("\n==================== DELTA GPT-OSS - GEMMA ===================")
    print(f"EXACT delta: {delta(gpt_score['exact']['pct'], gemma_score['exact']['pct']):+.2f} pp")
    for f in FIELDS:
        print(f"{f} delta: {delta(gpt_score['fields'][f]['pct'], gemma_score['fields'][f]['pct']):+.2f} pp")
    print(f"link-hard EXACT delta: {delta(gpt_score['link_hard_exact']['pct'], gemma_score['link_hard_exact']['pct']):+.2f} pp")
    print("Gold/failure details: HIDDEN")
    print("O1 / Blind V4 / Blind V5: NOT USED")
    print("Production: OFF")
    print("==============================================================")

    summary = {
        "benchmark": "buyflow-fresh-blind-o2-gptoss-vs-gemma-v17-3",
        "cases": len(CASES),
        "gpt_oss": gpt_score,
        "gemma_v17_3": gemma_score,
        "elapsed_seconds": round(time.time() - started, 1),
        "o1_used": False,
        "blind_v4_used": False,
        "blind_v5_used": False,
        "production": "OFF",
    }
    out = OUT_DIR / "summary.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Summary: {out}")


if __name__ == "__main__":
    main()
