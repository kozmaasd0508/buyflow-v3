import ast
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

O2_COMMIT = "0268e0806b6e8f7cf819401f3fea958c110a67a7"
O2_URL = f"https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/{O2_COMMIT}/scripts/run-buyflow-gpt-oss-vs-gemma-v17-3-blind-o2.py"
API_URL = "https://api.openai.com/v1/responses"
MODEL = "gpt-5.6-sol"
OUT_DIR = Path.home() / "Desktop" / "buyflow-o2-gpt-5-6-sol-api"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8")


def load_o2_contract():
    src = fetch_text(O2_URL)
    tree = ast.parse(src)
    wanted = {"EVENTS", "PERSPECTIVES", "LINKS", "FIELDS", "SCHEMA", "SYSTEM", "CASES"}
    ns = {"dict": dict}
    selected = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            names = {t.id for t in node.targets if isinstance(t, ast.Name)}
            if names & wanted:
                selected.append(node)
    mod = ast.Module(body=selected, type_ignores=[])
    exec(compile(mod, "<pinned-o2-contract>", "exec"), {"__builtins__": {}, "dict": dict}, ns)
    missing = wanted - set(ns)
    if missing:
        raise RuntimeError(f"Could not recover pinned O2 contract: {sorted(missing)}")
    return ns


def extract_output_text(data: dict) -> str:
    direct = data.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    parts = []
    for item in data.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for c in item.get("content", []) or []:
            if c.get("type") == "output_text" and isinstance(c.get("text"), str):
                parts.append(c["text"])
    return "".join(parts).strip()


def normalize(x, fields):
    if not isinstance(x, dict):
        raise ValueError("not_object")
    return {f: x.get(f) for f in fields}


def call_sol(api_key: str, system: str, schema: dict, fields, email_text: str):
    payload = {
        "model": MODEL,
        "instructions": system,
        "input": "Email:\n\n" + email_text,
        "reasoning": {"effort": "low"},
        "text": {
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "buyflow_email_classification",
                "strict": True,
                "schema": schema,
            },
        },
        "max_output_tokens": 512,
        "store": False,
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP {e.code}: {body}") from e
    text = extract_output_text(data)
    if not text:
        raise RuntimeError(f"No output_text; status={data.get('status')} error={data.get('error')}")
    pred = normalize(json.loads(text), fields)
    return pred, data.get("usage") or {}, data.get("model") or MODEL


def score(cases, preds, fields):
    field_correct = {f: 0 for f in fields}
    exact = 0
    errors = 0
    hard_total = 0
    hard_exact = 0
    for (_cid, _email, gold), pred in zip(cases, preds):
        hard = gold["link_status"] in ("unresolved", "not_applicable")
        if hard:
            hard_total += 1
        if pred is None:
            errors += 1
            continue
        ok = True
        for f in fields:
            if pred.get(f) == gold[f]:
                field_correct[f] += 1
            else:
                ok = False
        if ok:
            exact += 1
            if hard:
                hard_exact += 1
    n = len(cases)
    pct = lambda x, d=n: round(100.0 * x / max(1, d), 2)
    return {
        "exact": {"correct": exact, "pct": pct(exact)},
        "fields": {f: {"correct": field_correct[f], "pct": pct(field_correct[f])} for f in fields},
        "link_hard_exact": {"correct": hard_exact, "total": hard_total, "pct": pct(hard_exact, hard_total)},
        "errors": errors,
    }


def main():
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is missing")

    c = load_o2_contract()
    cases, fields, schema, system = c["CASES"], c["FIELDS"], c["SCHEMA"], c["SYSTEM"]
    print("==============================================================")
    print("BUYFLOW O2 EXTENSION - GPT-5.6 SOL API")
    print(f"Model: {MODEL} | Responses API | structured outputs | reasoning=low")
    print(f"Cases: {len(cases)} | exact same pinned O2 cases used for GPT-OSS/Gemma")
    print("Aggregate-only. No case failures/gold printed.")
    print("This is a benchmark extension, NOT a new fresh blind set.")
    print("Does not use local GPU. Does not touch Blind O3. Production OFF.")
    print("==============================================================")

    started = time.time()
    preds = []
    total_in = total_out = total_reasoning = total_cached = 0
    actual_model = MODEL
    for i, (_cid, email_text, _gold) in enumerate(cases, 1):
        print(f"[SOL {i:02d}/{len(cases)}] inference ... ", end="", flush=True)
        try:
            pred, usage, actual_model = call_sol(api_key, system, schema, fields, email_text)
            preds.append(pred)
            total_in += int(usage.get("input_tokens") or 0)
            total_out += int(usage.get("output_tokens") or 0)
            total_reasoning += int((usage.get("output_tokens_details") or {}).get("reasoning_tokens") or 0)
            total_cached += int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0)
            print("OK")
        except Exception as e:
            preds.append(None)
            print(f"ERROR: {e}")

    s = score(cases, preds, fields)
    n = len(cases)
    print("\n==================== GPT-5.6 SOL O2 RESULT ===================")
    print(f"Resolved model: {actual_model}")
    print(f"EXACT: {s['exact']['correct']}/{n} = {s['exact']['pct']}%")
    for f in fields:
        x = s["fields"][f]
        print(f"{f}: {x['correct']}/{n} = {x['pct']}%")
    h = s["link_hard_exact"]
    print(f"link-hard EXACT: {h['correct']}/{h['total']} = {h['pct']}%")
    print(f"Errors: {s['errors']}")
    print(f"Tokens: input={total_in} cached_input={total_cached} output={total_out} reasoning={total_reasoning}")
    # Conservative estimate ignores any cached-input discount, so actual can be lower.
    upper_cost = total_in / 1_000_000 * 4.0 + total_out / 1_000_000 * 20.0
    print(f"Conservative token-cost estimate (no cache discount): ${upper_cost:.4f}")
    print(f"Elapsed: {(time.time()-started)/60:.1f} min")
    print("Gold/failure details: HIDDEN")
    print("Blind O3: NOT USED | Production: OFF")
    print("==============================================================")

    summary = {
        "benchmark": "buyflow-o2-extension-gpt-5-6-sol-api",
        "pinned_o2_commit": O2_COMMIT,
        "model_requested": MODEL,
        "model_resolved": actual_model,
        "reasoning_effort": "low",
        "structured_outputs": True,
        "cases": n,
        "score": s,
        "usage": {
            "input_tokens": total_in,
            "cached_input_tokens": total_cached,
            "output_tokens": total_out,
            "reasoning_tokens": total_reasoning,
            "conservative_cost_usd": round(upper_cost, 6),
        },
        "fresh_blind": False,
        "blind_o3_used": False,
        "production": "OFF",
    }
    out = OUT_DIR / "summary.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Summary: {out}")


if __name__ == "__main__":
    main()
