import argparse
import gc
import importlib.util
import json
from collections import Counter, defaultdict
from pathlib import Path

import torch


def load_benchmark(path: Path):
    spec = importlib.util.spec_from_file_location("buyflow_blind_v4_benchmark", str(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load benchmark script: {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def exact_ok(fields, gold, pred):
    return pred is not None and all(pred.get(f) == gold.get(f) for f in fields)


def bad_fields(fields, gold, pred):
    if pred is None:
        return list(fields)
    return [f for f in fields if pred.get(f) != gold.get(f)]


def subject_of(text: str):
    for line in text.splitlines():
        s = line.strip()
        low = s.lower()
        if low.startswith("tárgy:") or low.startswith("targy:") or low.startswith("subject:"):
            return s.split(":", 1)[1].strip()
    return "(nincs tárgy)"


def compact(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def run_predictions(mod, name, adapter_dir, tokenizer):
    print(f"\nLoading {name} adapter...")
    model = mod.load_model(adapter_dir)
    print(f"{name} LOAD: PASS")
    preds = []
    total = len(mod.CASES)
    for i, (_cid, email_text, _gold) in enumerate(mod.CASES, 1):
        print(f"[{name} {i:02d}/{total}] inference ... ", end="", flush=True)
        try:
            preds.append(mod.classify(model, tokenizer, email_text))
            print("OK")
        except Exception as exc:
            preds.append(None)
            print(f"ERROR {exc}")
    del model
    gc.collect()
    torch.cuda.empty_cache()
    return preds


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--benchmark-script", required=True)
    args = parser.parse_args()

    benchmark_path = Path(args.benchmark_script)
    if not benchmark_path.exists():
        raise RuntimeError(f"Missing benchmark script: {benchmark_path}")

    mod = load_benchmark(benchmark_path)
    fields = list(mod.FIELDS)

    if not torch.cuda.is_available():
        raise RuntimeError("ROCm GPU not visible")
    for p in (mod.MODEL_DIR, mod.BASELINE_ADAPTER, mod.CANDIDATE_ADAPTER):
        if not Path(p).exists():
            raise RuntimeError(f"Missing: {p}")

    tokenizer = mod.AutoTokenizer.from_pretrained(str(mod.MODEL_DIR), local_files_only=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("==============================================================")
    print("BUYFLOW BLIND V4 - CLOSED BENCHMARK DIAGNOSTIC")
    print(f"Cases: {len(mod.CASES)} | gold/failures may now be inspected")
    print("Purpose: diagnosis only. NO TRAINING. Blind V5 untouched.")
    print("Production: OFF")
    print("==============================================================")

    baseline_preds = run_predictions(mod, "V17_3_BASELINE", mod.BASELINE_ADAPTER, tokenizer)
    candidate_preds = run_predictions(mod, "V17_4_CANDIDATE", mod.CANDIDATE_ADAPTER, tokenizer)

    baseline_score = mod.score(baseline_preds)
    candidate_score = mod.score(candidate_preds)

    rows = []
    field_bad_base = Counter()
    field_bad_cand = Counter()
    event_conf_base = Counter()
    event_conf_cand = Counter()
    perspective_conf_base = Counter()
    perspective_conf_cand = Counter()
    link_conf_base = Counter()
    link_conf_cand = Counter()
    event_totals = Counter()
    event_exact_base = Counter()
    event_exact_cand = Counter()

    fixed = []
    regressed = []
    both_wrong = []
    both_exact = []
    unsafe_overlink_base = []
    unsafe_overlink_cand = []
    hallucinated_id_base = []
    hallucinated_id_cand = []
    dropped_id_base = []
    dropped_id_cand = []

    for case, bp, cp in zip(mod.CASES, baseline_preds, candidate_preds):
        cid, text, raw_gold = case
        gold = mod.norm(raw_gold)
        b = bp
        c = cp
        be = exact_ok(fields, gold, b)
        ce = exact_ok(fields, gold, c)
        bbad = bad_fields(fields, gold, b)
        cbad = bad_fields(fields, gold, c)

        event_totals[gold["event_type"]] += 1
        if be:
            event_exact_base[gold["event_type"]] += 1
        if ce:
            event_exact_cand[gold["event_type"]] += 1

        for f in bbad:
            field_bad_base[f] += 1
        for f in cbad:
            field_bad_cand[f] += 1

        if b is not None:
            if b["event_type"] != gold["event_type"]:
                event_conf_base[(gold["event_type"], b["event_type"])] += 1
            if b["perspective"] != gold["perspective"]:
                perspective_conf_base[(gold["perspective"], b["perspective"])] += 1
            if b["link_status"] != gold["link_status"]:
                link_conf_base[(gold["link_status"], b["link_status"])] += 1
        if c is not None:
            if c["event_type"] != gold["event_type"]:
                event_conf_cand[(gold["event_type"], c["event_type"])] += 1
            if c["perspective"] != gold["perspective"]:
                perspective_conf_cand[(gold["perspective"], c["perspective"])] += 1
            if c["link_status"] != gold["link_status"]:
                link_conf_cand[(gold["link_status"], c["link_status"])] += 1

        if not be and ce:
            fixed.append(cid)
            change = "FIXED_BY_V17_4"
        elif be and not ce:
            regressed.append(cid)
            change = "REGRESSED_IN_V17_4"
        elif not be and not ce:
            both_wrong.append(cid)
            change = "BOTH_WRONG"
        else:
            both_exact.append(cid)
            change = "BOTH_EXACT"

        if gold["link_status"] != "linked":
            if b is not None and b["link_status"] == "linked":
                unsafe_overlink_base.append(cid)
            if c is not None and c["link_status"] == "linked":
                unsafe_overlink_cand.append(cid)

        for f in ("order_id", "tracking_id"):
            if gold[f] is None:
                if b is not None and b[f] is not None:
                    hallucinated_id_base.append(f"{cid}:{f}")
                if c is not None and c[f] is not None:
                    hallucinated_id_cand.append(f"{cid}:{f}")
            else:
                if b is not None and b[f] is None:
                    dropped_id_base.append(f"{cid}:{f}")
                if c is not None and c[f] is None:
                    dropped_id_cand.append(f"{cid}:{f}")

        rows.append({
            "case_id": cid,
            "subject": subject_of(text),
            "gold": gold,
            "v17_3": b,
            "v17_4": c,
            "v17_3_exact": be,
            "v17_4_exact": ce,
            "v17_3_bad_fields": bbad,
            "v17_4_bad_fields": cbad,
            "change": change,
        })

    print("\n==================== EXECUTIVE DIAGNOSIS =====================")
    print(f"V17.3 exact: {baseline_score['exact']['correct']}/{baseline_score['cases']} = {baseline_score['exact']['pct']}%")
    print(f"V17.4 exact: {candidate_score['exact']['correct']}/{candidate_score['cases']} = {candidate_score['exact']['pct']}%")
    print(f"Fixed by V17.4:     {len(fixed)} -> {', '.join(fixed) if fixed else '-'}")
    print(f"Regressed in V17.4: {len(regressed)} -> {', '.join(regressed) if regressed else '-'}")
    print(f"Both wrong:         {len(both_wrong)} -> {', '.join(both_wrong) if both_wrong else '-'}")

    print("\nField failures (lower is better):")
    for f in fields:
        print(f"  {f:12s} V17.3={field_bad_base[f]:2d} | V17.4={field_bad_cand[f]:2d} | delta={field_bad_cand[f]-field_bad_base[f]:+d}")

    def show_counter(title, counter):
        print(f"\n{title}")
        if not counter:
            print("  none")
            return
        for (gold_v, pred_v), n in counter.most_common():
            print(f"  {gold_v} -> {pred_v}: {n}")

    show_counter("V17.3 event confusions", event_conf_base)
    show_counter("V17.4 event confusions", event_conf_cand)
    show_counter("V17.3 perspective confusions", perspective_conf_base)
    show_counter("V17.4 perspective confusions", perspective_conf_cand)
    show_counter("V17.3 link_status confusions", link_conf_base)
    show_counter("V17.4 link_status confusions", link_conf_cand)

    print("\nExact accuracy by GOLD event family:")
    for event in sorted(event_totals):
        total = event_totals[event]
        b = event_exact_base[event]
        c = event_exact_cand[event]
        print(f"  {event:18s} n={total:2d} | V17.3={b:2d}/{total} | V17.4={c:2d}/{total}")

    print("\nCritical linking / ID safety:")
    print(f"  V17.3 over-link (gold != linked, pred linked): {len(unsafe_overlink_base)} -> {', '.join(unsafe_overlink_base) if unsafe_overlink_base else '-'}")
    print(f"  V17.4 over-link (gold != linked, pred linked): {len(unsafe_overlink_cand)} -> {', '.join(unsafe_overlink_cand) if unsafe_overlink_cand else '-'}")
    print(f"  V17.3 hallucinated IDs: {len(hallucinated_id_base)} -> {', '.join(hallucinated_id_base) if hallucinated_id_base else '-'}")
    print(f"  V17.4 hallucinated IDs: {len(hallucinated_id_cand)} -> {', '.join(hallucinated_id_cand) if hallucinated_id_cand else '-'}")
    print(f"  V17.3 dropped IDs: {len(dropped_id_base)} -> {', '.join(dropped_id_base) if dropped_id_base else '-'}")
    print(f"  V17.4 dropped IDs: {len(dropped_id_cand)} -> {', '.join(dropped_id_cand) if dropped_id_cand else '-'}")

    print("\n==================== V17.4 FAILURE DETAILS ===================")
    for row in rows:
        if row["v17_4_exact"]:
            continue
        print(f"\n[{row['case_id']}] {row['subject']} | {row['change']}")
        print(f"  GOLD : {compact(row['gold'])}")
        print(f"  V17.3: {compact(row['v17_3']) if row['v17_3'] is not None else 'ERROR'}")
        print(f"  V17.4: {compact(row['v17_4']) if row['v17_4'] is not None else 'ERROR'}")
        print(f"  BAD  : {', '.join(row['v17_4_bad_fields'])}")

    out_dir = Path(mod.OUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "diagnostic-v4-closed.json"
    payload = {
        "benchmark": "buyflow-v17-4-external-blind-v4",
        "status": "CLOSED_SPENT_DIAGNOSTIC_ALLOWED",
        "training_performed": False,
        "blind_v5_touched": False,
        "production": "OFF",
        "baseline_score": baseline_score,
        "candidate_score": candidate_score,
        "fixed_by_v17_4": fixed,
        "regressed_in_v17_4": regressed,
        "both_wrong": both_wrong,
        "field_failures": {
            "v17_3": dict(field_bad_base),
            "v17_4": dict(field_bad_cand),
        },
        "critical": {
            "v17_3_overlink": unsafe_overlink_base,
            "v17_4_overlink": unsafe_overlink_cand,
            "v17_3_hallucinated_ids": hallucinated_id_base,
            "v17_4_hallucinated_ids": hallucinated_id_cand,
            "v17_3_dropped_ids": dropped_id_base,
            "v17_4_dropped_ids": dropped_id_cand,
        },
        "cases": rows,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n==============================================================")
    print("BLIND V4 DIAGNOSTIC: COMPLETE")
    print(f"Detailed report: {out}")
    print("Training: NOT STARTED")
    print("Blind V5: UNTOUCHED")
    print("Production: OFF")
    print("==============================================================")


if __name__ == "__main__":
    main()
