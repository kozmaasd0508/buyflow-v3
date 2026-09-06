import gc
import json
import random
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoTokenizer, BitsAndBytesConfig, Gemma3ForConditionalGeneration

SEED = 17062026
random.seed(SEED)
ROOT = Path.home() / "BuyFlowTools"
MODEL_DIR = ROOT / "models" / "gemma-3-12b-it"
OLD_ADAPTER = ROOT / "adapters" / "buyflow-v17-gemma3-12b-qlora-r8-v3"
NEW_ADAPTER = ROOT / "adapters" / "buyflow-v17-3-gemma3-12b-qlora-r8-cont1"
OUT_DIR = Path.home() / "Desktop" / "buyflow-v17-3-external-blind-v3"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SYSTEM = "Analyze this commerce email for BuyFlow. Return only JSON with: event_type, perspective, order_id, tracking_id, link_status. Do not invent facts."
USER_PREFIX = "Elemezd ezt az e-mailt BuyFlow szerint. Csak JSON-t adj vissza.\n\n"

# Fresh holdout: manually authored phrasings and structures not copied from the V17/V17.3 training builders.
CASES = [
    ("b3-001", "Feladó: webshop@bolt.hu\nTárgy: Rendelésed megérkezett\n\nKöszönjük! A #A-10491 megrendelést rögzítettük. A csomagot még nem készítettük össze.",
     dict(event_type="ORDER_CREATED", perspective="buyer", order_id="A-10491", tracking_id=None, link_status="linked")),
    ("b3-002", "Feladó: orders@shop.eu\nTárgy: Feldolgozás alatt\n\nA B7782 rendelés raktári ellenőrzése folyamatban. A futárhoz még nem került átadásra.",
     dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="B7782", tracking_id=None, link_status="linked")),
    ("b3-003", "Feladó: noreply@barion.com\nTárgy: Sikeres tranzakció\n\nKereskedő: MintaBolt\nRendelés: MB-4410\nA 12 990 Ft bankkártyás fizetés sikeres.",
     dict(event_type="PAYMENT", perspective="buyer", order_id="MB-4410", tracking_id=None, link_status="linked")),
    ("b3-004", "Feladó: invoice@billing.example\nTárgy: Számla készült\n\nA C-7731 rendeléshez tartozó INV-2026-771 számlát kiállítottuk.",
     dict(event_type="INVOICE", perspective="buyer", order_id="C-7731", tracking_id=None, link_status="linked")),
    ("b3-005", "Feladó: shipping@store.hu\nTárgy: Csomagszám létrehozva\n\nRendelés: O-5501\nNyomkövetés: GLS100200300\nA GLS megkapta a küldemény elektronikus adatait. A doboz továbbra is a raktárunkban van.",
     dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="O-5501", tracking_id="GLS100200300", link_status="linked")),
    ("b3-006", "Feladó: shipping@store.hu\nTárgy: Átadtuk a futárnak\n\nRendelés: O-5502\nNyomkövetés: EO100200301\nA lezárt csomagot ma 14:22-kor fizikailag átvette az Express One gépkocsivezetője.",
     dict(event_type="SHIPPED", perspective="buyer", order_id="O-5502", tracking_id="EO100200301", link_status="linked")),
    ("b3-007", "Feladó: status@parcel.hu\nTárgy: Mozgásban a küldemény\n\nCsomagszám: DPD88119922\nA küldemény elhagyta a budapesti elosztóközpontot és a szolnoki depó felé tart.",
     dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="DPD88119922", link_status="unresolved")),
    ("b3-008", "Feladó: futar@carrier.hu\nTárgy: Ma visszük\n\nCsomagszám: MPL55667788\nA küldeményt a helyi kézbesítő átvette, a mai járatán van.",
     dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id=None, tracking_id="MPL55667788", link_status="unresolved")),
    ("b3-009", "Feladó: locker@parcel.hu\nTárgy: Átvehető\n\nFOX99112233 csomagod bekerült a 17-es rekeszbe. Nyitókód: 418299.",
     dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="FOX99112233", link_status="unresolved")),
    ("b3-010", "Feladó: tracking@carrier.hu\nTárgy: Kézbesítés lezárva\n\nPKT55443322 küldeményt 16:03-kor a címzett átvette.",
     dict(event_type="DELIVERED", perspective="buyer", order_id=None, tracking_id="PKT55443322", link_status="unresolved")),
    ("b3-011", "Feladó: service@shop.hu\nTárgy: Rendelés törlése\n\nA K-9081 megrendelést végleg töröltük, kiszállítás nem történik.",
     dict(event_type="CANCELLED", perspective="buyer", order_id="K-9081", tracking_id=None, link_status="linked")),
    ("b3-012", "Feladó: payments@shop.hu\nTárgy: Visszautalás kész\n\nRendelés: RF-3001\nA teljes összeget visszaküldtük az eredeti bankkártyára.",
     dict(event_type="REFUNDED", perspective="buyer", order_id="RF-3001", tracking_id=None, link_status="linked")),
    ("b3-013", "Feladó: returns@shop.hu\nTárgy: Visszáru beérkezett\n\nRendelés: RET-81\nA visszaküldött termék ma beérkezett a raktárunkba, ellenőrzése következik.",
     dict(event_type="RETURN", perspective="buyer", order_id="RET-81", tracking_id=None, link_status="linked")),
    ("b3-014", "Feladó: news@shop.hu\nTárgy: Hétvégi akció\n\nCsak vasárnapig 20% kedvezmény. Kupon: GLS123456789. Ez promóciós kód.",
     dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b3-015", "Feladó: security@shop.hu\nTárgy: Új belépés\n\nEgy új Windows eszköz jelentkezett be a fiókodba 18:44-kor.",
     dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b3-016", "Feladó: pickup@carrier.hu\nTárgy: Holnapi partnerfelvétel\n\nTisztelt Webáruház! Holnap 10 és 12 óra között érkezünk az Ön vevőinek feladandó csomagokért.",
     dict(event_type="OTHER", perspective="merchant_outbound", order_id=None, tracking_id=None, link_status="not_applicable")),
    ("b3-017", "Feladó: shipping@shop.hu\nTárgy: Fuvarlevél elkészült\n\nTracking: UPS700800900\nA fuvarlevelet létrehoztuk, de a csomagot a UPS még nem vette át.",
     dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id=None, tracking_id="UPS700800900", link_status="unresolved")),
    ("b3-018", "Feladó: tracking@carrier.hu\nTárgy: Küldemény átvéve a feladótól\n\nTracking: SDY77112233\nA futár 09:18-kor átvette a lezárt csomagot a feladói telephelyen.",
     dict(event_type="SHIPPED", perspective="buyer", order_id=None, tracking_id="SDY77112233", link_status="unresolved")),
    ("b3-019", "Feladó: tracking@carrier.hu\nTárgy: Állapotfrissítés\n\nIsmert BuyFlow kapcsolat: X-190 rendelés trackingje GLS44112233.\nA csomag a győri központból a budapesti központba továbbítva.",
     dict(event_type="IN_TRANSIT", perspective="buyer", order_id="X-190", tracking_id="GLS44112233", link_status="linked")),
    ("b3-020", "Feladó: tracking@carrier.hu\nTárgy: Kiszállítás folyamatban\n\nIsmert BuyFlow kapcsolat: X-191 rendelés trackingje GLS44112234.\nA helyi futár ma reggel berakta a csomagot a kézbesítő autóba.",
     dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id="X-191", tracking_id="GLS44112234", link_status="linked")),
    ("b3-021", "Feladó: shop@market.hu\nTárgy: Rendelés feldolgozása\n\nRendelés: Q-111\nÖsszekészítés zajlik.\n\n--- Korábbi üzenet ---\nA rendelést tegnap rögzítettük.",
     dict(event_type="ORDER_PROCESSING", perspective="buyer", order_id="Q-111", tracking_id=None, link_status="linked")),
    ("b3-022", "Feladó: tracking@carrier.hu\nTárgy: Kézbesítés\n\nCsomag: DPD90112233\nA mai kézbesítés sikertelen volt, a csomag visszakerült a depóba és új időpontot egyeztetünk.",
     dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="DPD90112233", link_status="unresolved")),
    ("b3-023", "Feladó: locker@carrier.hu\nTárgy: Még nem vehető át\n\nCsomag: FOX70001122\nA küldemény úton van az automatához. Átvételi kódot csak behelyezés után küldünk.",
     dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="FOX70001122", link_status="unresolved")),
    ("b3-024", "Feladó: shop@bolt.hu\nTárgy: Csomagolás kész\n\nRendelés: P-332\nA csomag lezárva és címkézve várja a futárt. Átadás még nem történt.",
     dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="P-332", tracking_id=None, link_status="linked")),
    ("b3-025", "Feladó: carrier@parcel.hu\nTárgy: Elindult\n\nCsomag: EO44556677\nA küldeményt a feladótól felvettük és beszállítottuk az induló depóba.",
     dict(event_type="SHIPPED", perspective="buyer", order_id=None, tracking_id="EO44556677", link_status="unresolved")),
    ("b3-026", "Feladó: carrier@parcel.hu\nTárgy: Feldolgozóközpont\n\nCsomag: EO44556678\n02:14 érkezés a központba, 04:07 továbbítás a következő elosztóba.",
     dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="EO44556678", link_status="unresolved")),
    ("b3-027", "Feladó: carrier@parcel.hu\nTárgy: Kézbesítőnél\n\nCsomag: EO44556679\n07:32 - átadva a címkörzet kézbesítőjének. Tervezett kézbesítés: ma.",
     dict(event_type="OUT_FOR_DELIVERY", perspective="buyer", order_id=None, tracking_id="EO44556679", link_status="unresolved")),
    ("b3-028", "Feladó: carrier@parcel.hu\nTárgy: Csomagpont\n\nCsomag: EO44556680\nA partnerpont átvette a küldeményt, személyi igazolvánnyal már átvehető.",
     dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="EO44556680", link_status="unresolved")),
    ("b3-029", "Feladó: survey@carrier.hu\nTárgy: Véleményed számít\n\nIsmert BuyFlow kapcsolat: R-991 rendelés trackingje MPL77889911.\nMennyire voltál elégedett a múlt heti kézbesítéssel?",
     dict(event_type="OTHER", perspective="non_purchase", order_id="R-991", tracking_id="MPL77889911", link_status="linked")),
    ("b3-030", "Feladó: preferences@carrier.hu\nTárgy: Értesítések\n\nTracking: GLS55001122\nMostantól SMS helyett e-mailben kéred az értesítéseket. A csomag állapota nem változott.",
     dict(event_type="OTHER", perspective="non_purchase", order_id=None, tracking_id="GLS55001122", link_status="not_applicable")),
    ("b3-031", "Feladó: marketplace@platform.hu\nTárgy: Partner eladó csomagot készít\n\nPlatform rendelés: MKT-551\nEladói rendelés: S-778\nA partner létrehozta a szállítási címkét. Tracking: PKT10009988. A futár még nem vette át.",
     dict(event_type="SHIPMENT_CREATED", perspective="buyer", order_id="MKT-551", tracking_id="PKT10009988", link_status="linked")),
    ("b3-032", "Feladó: marketplace@platform.hu\nTárgy: Partner eladó feladta\n\nPlatform rendelés: MKT-552\nEladói rendelés: S-779\nTracking: PKT10009989\nA partner átadta a küldeményt a fuvarozónak.",
     dict(event_type="SHIPPED", perspective="buyer", order_id="MKT-552", tracking_id="PKT10009989", link_status="linked")),
    ("b3-033", "Feladó: status@carrier.hu\nTárgy: Frissítés\n\nTracking: GLS600700800\nLehetséges rendelések: A-1 vagy A-2. Nincs igazolt hozzárendelés. A csomag a depóhálózatban halad.",
     dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="GLS600700800", link_status="unresolved")),
    ("b3-034", "Feladó: orders@bolt.hu\nTárgy: Megrendelésed\n\nRendelés: Z-100\nA rendelést rögzítettük.\n\nA levél láblécében szereplő EO99887766 technikai referencia, nem csomagszám.",
     dict(event_type="ORDER_CREATED", perspective="buyer", order_id="Z-100", tracking_id=None, link_status="linked")),
    ("b3-035", "Feladó: invoice@billing.hu\nTárgy: Dokumentum\n\nRendelés: Z-101\nSzámla: INV-551199\nA számla elkészült.\n\nKorábbi állapot: a rendelést rögzítették.",
     dict(event_type="INVOICE", perspective="buyer", order_id="Z-101", tracking_id=None, link_status="linked")),
    ("b3-036", "Feladó: shop@bolt.hu\nTárgy: Visszatérítési igény fogadva\n\nRendelés: Z-102\nKérésedet megkaptuk, de az összeget még nem utaltuk vissza.",
     dict(event_type="RETURN", perspective="buyer", order_id="Z-102", tracking_id=None, link_status="linked")),
    ("b3-037", "Feladó: shop@bolt.hu\nTárgy: Visszatérítés teljesítve\n\nRendelés: Z-103\nA banki jóváírást elindítottuk és a visszatérítés lezárult.",
     dict(event_type="REFUNDED", perspective="buyer", order_id="Z-103", tracking_id=None, link_status="linked")),
    ("b3-038", "Feladó: carrier@parcel.hu\nTárgy: Sikertelen kézbesítés\n\nCsomag: DPD77331122\nA címzett nem volt elérhető. A küldeményt visszaszállítjuk a helyi depóba.",
     dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="DPD77331122", link_status="unresolved")),
    ("b3-039", "Feladó: carrier@parcel.hu\nTárgy: Átvételi pont felé\n\nCsomag: FOX11223344\nA csomag úton van a kiválasztott automatába, de még nincs behelyezve.",
     dict(event_type="IN_TRANSIT", perspective="buyer", order_id=None, tracking_id="FOX11223344", link_status="unresolved")),
    ("b3-040", "Feladó: carrier@parcel.hu\nTárgy: Automatában\n\nCsomag: FOX11223345\nA küldeményt 18:01-kor behelyeztük az automatába, 3 napig átvehető.",
     dict(event_type="READY_FOR_PICKUP", perspective="buyer", order_id=None, tracking_id="FOX11223345", link_status="unresolved")),
]

FIELDS = ["event_type", "perspective", "order_id", "tracking_id", "link_status"]

def norm(v):
    return {k: (v.get(k) if isinstance(v, dict) else None) for k in FIELDS}

def extract_json(text):
    t = str(text or "").strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    if "```" in t:
        parts = t.split("```")
        for p in parts:
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
    qconfig = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
    base = Gemma3ForConditionalGeneration.from_pretrained(str(MODEL_DIR), quantization_config=qconfig, device_map={"":0}, torch_dtype=torch.bfloat16, low_cpu_mem_usage=True, attn_implementation="eager", local_files_only=True)
    model = PeftModel.from_pretrained(base, str(adapter_dir), is_trainable=False)
    model.eval()
    return model

def classify(model, tokenizer, email_text):
    user = USER_PREFIX + email_text
    msgs = [{"role":"user", "content": SYSTEM + "\n\n" + user}]
    rendered = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(rendered, return_tensors="pt").to("cuda")
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=160, do_sample=False, pad_token_id=tokenizer.eos_token_id)
    gen = out[0, inputs["input_ids"].shape[1]:]
    text = tokenizer.decode(gen, skip_special_tokens=True)
    return norm(extract_json(text))

def score(preds):
    fc = {f:0 for f in FIELDS}
    exact = 0
    errors = 0
    for case, pred in zip(CASES, preds):
        gold = norm(case[2])
        if pred is None:
            errors += 1
            continue
        all_ok = True
        for f in FIELDS:
            if pred[f] == gold[f]: fc[f] += 1
            else: all_ok = False
        if all_ok: exact += 1
    n = len(CASES)
    pct = lambda x: round(x/n*100, 2)
    return {"cases":n, "exact":{"correct":exact,"pct":pct(exact)}, "fields":{f:{"correct":fc[f],"pct":pct(fc[f])} for f in FIELDS}, "errors":errors}

def run_adapter(name, adapter_dir, tokenizer):
    print(f"\nLoading {name} adapter...")
    model = load_model(adapter_dir)
    print(f"{name} LOAD: PASS")
    preds=[]
    for i,(cid,email_text,_gold) in enumerate(CASES,1):
        print(f"[{name} {i:02d}/{len(CASES)}] inference ... ", end="", flush=True)
        try:
            preds.append(classify(model, tokenizer, email_text)); print("OK")
        except Exception as e:
            preds.append(None); print(f"ERROR {e}")
    summary = score(preds)
    del model
    gc.collect(); torch.cuda.empty_cache()
    return summary

def main():
    if not torch.cuda.is_available(): raise RuntimeError("ROCm GPU not visible")
    for p in (MODEL_DIR, OLD_ADAPTER, NEW_ADAPTER):
        if not p.exists(): raise RuntimeError(f"Missing: {p}")
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    if tokenizer.pad_token_id is None: tokenizer.pad_token = tokenizer.eos_token

    print("==============================================================")
    print("BUYFLOW V17.3 EXTERNAL BLIND V3 - OLD vs NEW ADAPTER")
    print(f"Cases: {len(CASES)} | fresh holdout | aggregate-only")
    print("Prompt: MINIMAL | no taxonomy/rule list")
    print("Per-case gold/failures: HIDDEN")
    print("Production: OFF")
    print("==============================================================")

    old_s = run_adapter("OLD_V17", OLD_ADAPTER, tokenizer)
    new_s = run_adapter("NEW_V17_3", NEW_ADAPTER, tokenizer)

    def show(label,s):
        print(f"\n{label}")
        print(f"EXACT: {s['exact']['correct']}/{s['cases']} = {s['exact']['pct']}%")
        for f in FIELDS:
            x=s['fields'][f]; print(f"{f}: {x['correct']}/{s['cases']} = {x['pct']}%")
        print(f"Errors: {s['errors']}")

    print("\n==================== BLIND V3 RESULT =========================")
    show("OLD V17 (240-row trained adapter)", old_s)
    show("NEW V17.3 (3000-row continuation)", new_s)
    print("\n==================== DELTA ===================================")
    print(f"EXACT: {old_s['exact']['pct']:.2f}% -> {new_s['exact']['pct']:.2f}% | delta={new_s['exact']['pct']-old_s['exact']['pct']:+.2f} pp")
    for f in FIELDS:
        a=old_s['fields'][f]['pct']; b=new_s['fields'][f]['pct']
        print(f"{f}: {a:.2f}% -> {b:.2f}% | delta={b-a:+.2f} pp")
    print("Gold/failure details: HIDDEN")
    print("Production: OFF")
    print("==============================================================")

    summary={"benchmark":"buyflow-v17-3-external-blind-v3", "prompt":"minimal", "old_v17":old_s, "new_v17_3":new_s}
    (OUT_DIR/"summary.json").write_text(json.dumps(summary,indent=2)+"\n",encoding="utf-8")
    print(f"Summary: {OUT_DIR/'summary.json'}")

if __name__ == "__main__":
    main()
