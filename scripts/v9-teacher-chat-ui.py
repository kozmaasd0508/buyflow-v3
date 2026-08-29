#!/usr/bin/env python3
"""Local-only web UI for BuyFlow V9 teacher chat.

Serves a tiny browser UI on 127.0.0.1:4393 and proxies chat/health calls to the
local V9 shadow server on 127.0.0.1:4392. Uses only the Python standard library.
No Supabase writes, no training writes, no Purchase writes.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 4393
MODEL_BASE = "http://127.0.0.1:4392"

HTML = r"""<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>BuyFlow AI – Tanári Chat</title>
<style>
:root{font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:#0b0d12;color:#eef2ff}
.wrap{max-width:980px;margin:0 auto;padding:24px}.top{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.title{font-size:24px;font-weight:750}.sub{color:#9ca3af;font-size:13px}.badge{padding:7px 10px;border-radius:999px;background:#1f2937;font-size:12px}
.card{background:#11151d;border:1px solid #252b38;border-radius:18px;overflow:hidden}.messages{height:58vh;min-height:420px;overflow:auto;padding:18px}
.msg{max-width:82%;padding:11px 13px;border-radius:14px;margin:8px 0;white-space:pre-wrap;line-height:1.45}.user{margin-left:auto;background:#26324a}.ai{background:#181d27;border:1px solid #293142}
.row{display:flex;gap:10px;padding:14px;border-top:1px solid #252b38}textarea{flex:1;resize:vertical;min-height:58px;max-height:180px;background:#0d1118;color:#fff;border:1px solid #303849;border-radius:12px;padding:12px;font:inherit}
button{border:0;border-radius:12px;padding:0 18px;font-weight:700;cursor:pointer;background:#eef2ff;color:#0b0d12}.hint{padding:0 18px 16px;color:#8b93a7;font-size:12px}
.err{color:#fca5a5}.ok{color:#86efac}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div><div class="title">BuyFlow AI – Tanári Chat</div><div class="sub">Helyi Qwen chat · V9 classifier adapter kikapcsolva beszélgetés közben</div></div>
    <div id="status" class="badge">Kapcsolódás…</div>
  </div>
  <div class="card">
    <div id="messages" class="messages"><div class="msg ai">Szia! Itt közvetlenül beszélhetsz a helyi BuyFlow/Qwen modellel. Ez a chat nem ír tanítóadatot automatikusan.</div></div>
    <div class="row">
      <textarea id="input" placeholder="Írj neki… (Ctrl+Enter = küldés)"></textarea>
      <button id="send">Küldés</button>
    </div>
    <div class="hint">A válasz a helyi /teacher-chat végpontról jön. A V9 LoRA adapter ebben a módban szándékosan ki van kapcsolva, hogy normál beszélgetés legyen.</div>
  </div>
</div>
<script>
const messages=document.getElementById('messages'), input=document.getElementById('input'), send=document.getElementById('send'), statusEl=document.getElementById('status');
function add(text,cls){const d=document.createElement('div');d.className='msg '+cls;d.textContent=text;messages.appendChild(d);messages.scrollTop=messages.scrollHeight;return d}
async function health(){try{const r=await fetch('/api/health');const j=await r.json();if(j.ok&&j.ready){statusEl.textContent='V9 szerver: kész';statusEl.className='badge ok'}else{statusEl.textContent='V9 szerver: tölt…';statusEl.className='badge'}}catch(e){statusEl.textContent='V9 szerver: nem elérhető';statusEl.className='badge err'}}
async function go(){const text=input.value.trim();if(!text)return;input.value='';add(text,'user');send.disabled=true;const pending=add('Gondolkodik…','ai');try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:text})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||j.reason||('HTTP '+r.status));pending.textContent=j.response||'(üres válasz)'}catch(e){pending.textContent='Hiba: '+e.message;pending.classList.add('err')}finally{send.disabled=false;input.focus();health()}}
send.onclick=go;input.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter')go()});health();setInterval(health,5000);input.focus();
</script>
</body>
</html>"""


def proxy_json(path: str, payload: dict | None = None) -> tuple[int, dict]:
    url = MODEL_BASE + path
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="GET" if payload is None else "POST")
    req.add_header("Accept", "application/json")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            raw = res.read().decode("utf-8", errors="replace")
            return res.status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"ok": False, "error": raw[:500]}
        return exc.code, body
    except Exception as exc:
        return 503, {"ok": False, "error": f"LOCAL_MODEL_UNREACHABLE: {exc}"}


class Handler(BaseHTTPRequestHandler):
    server_version = "BuyFlowTeacherChatUI/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print("ui", fmt % args)

    def send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/":
            data = HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == "/api/health":
            status, body = proxy_json("/health")
            self.send_json(status, body)
            return
        self.send_json(404, {"ok": False, "error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path != "/api/chat":
            self.send_json(404, {"ok": False, "error": "NOT_FOUND"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            incoming = json.loads(raw)
            prompt = str(incoming.get("prompt", "")).strip()
        except Exception:
            self.send_json(400, {"ok": False, "error": "INVALID_JSON"})
            return
        if not prompt:
            self.send_json(400, {"ok": False, "error": "EMPTY_PROMPT"})
            return
        status, body = proxy_json("/teacher-chat", {"prompt": prompt})
        self.send_json(status, body)


def main() -> None:
    print("# BUYFLOW V9 TEACHER CHAT UI")
    print(f"open: http://{HOST}:{PORT}")
    print(f"model: {MODEL_BASE}")
    print("local_only: True")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
