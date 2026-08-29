#!/usr/bin/env python3
"""Local-only web UI for BuyFlow V9 teacher chat.

Serves a tiny browser UI on 127.0.0.1:4393 and proxies chat/health calls to the
local V9 shadow server on 127.0.0.1:4392. Uses only the Python standard library.
No Supabase writes, no training writes, no Purchase writes.

The UI keeps an SSE presence connection open while a browser tab is alive. When
all teacher-chat tabs disappear for 20 seconds, it stops the V9 model server and
then stops itself so Qwen/ROCm memory is not left resident in WSL.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 4393
MODEL_BASE = "http://127.0.0.1:4392"
SHUTDOWN_HEADER = "X-BuyFlow-Shutdown"
SHUTDOWN_TOKEN = "teacher-ui-v1"
AUTO_STOP_GRACE_SECONDS = 20

_presence_lock = threading.Lock()
_active_clients = 0
_ever_had_client = False

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
.title{font-size:24px;font-weight:750}.sub{color:#9ca3af;font-size:13px}.actions{display:flex;gap:9px;align-items:center}.badge{padding:7px 10px;border-radius:999px;background:#1f2937;font-size:12px}
.card{background:#11151d;border:1px solid #252b38;border-radius:18px;overflow:hidden}.messages{height:58vh;min-height:420px;overflow:auto;padding:18px}
.msg{max-width:82%;padding:11px 13px;border-radius:14px;margin:8px 0;white-space:pre-wrap;line-height:1.45}.user{margin-left:auto;background:#26324a}.ai{background:#181d27;border:1px solid #293142}
.row{display:flex;gap:10px;padding:14px;border-top:1px solid #252b38}textarea{flex:1;resize:vertical;min-height:58px;max-height:180px;background:#0d1118;color:#fff;border:1px solid #303849;border-radius:12px;padding:12px;font:inherit}
button{border:0;border-radius:12px;padding:0 18px;font-weight:700;cursor:pointer;background:#eef2ff;color:#0b0d12}.stop{height:34px;padding:0 12px;background:#3a2026;color:#fecaca;border:1px solid #6b3038}.hint{padding:0 18px 16px;color:#8b93a7;font-size:12px}
.err{color:#fca5a5}.ok{color:#86efac}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div><div class="title">BuyFlow AI – Tanári Chat</div><div class="sub">Helyi Qwen chat · V9 classifier adapter kikapcsolva beszélgetés közben</div></div>
    <div class="actions"><div id="status" class="badge">Kapcsolódás…</div><button id="stop" class="stop">Bezárás + modell leállítása</button></div>
  </div>
  <div class="card">
    <div id="messages" class="messages"><div class="msg ai">Szia! Itt közvetlenül beszélhetsz a helyi BuyFlow/Qwen modellel. Ez a chat nem ír tanítóadatot automatikusan.</div></div>
    <div class="row">
      <textarea id="input" placeholder="Írj neki… (Ctrl+Enter = küldés)"></textarea>
      <button id="send">Küldés</button>
    </div>
    <div class="hint">Ha bezárod ezt a böngészőlapot, a modell kb. 20 másodpercen belül automatikusan leáll. A kézi leállító gomb azonnal felszabadítja.</div>
  </div>
</div>
<script>
const messages=document.getElementById('messages'), input=document.getElementById('input'), send=document.getElementById('send'), stopBtn=document.getElementById('stop'), statusEl=document.getElementById('status');
const presence=new EventSource('/api/presence');
function add(text,cls){const d=document.createElement('div');d.className='msg '+cls;d.textContent=text;messages.appendChild(d);messages.scrollTop=messages.scrollHeight;return d}
async function health(){try{const r=await fetch('/api/health');const j=await r.json();if(j.ok&&j.ready){statusEl.textContent='V9 szerver: kész';statusEl.className='badge ok'}else{statusEl.textContent='V9 szerver: tölt…';statusEl.className='badge'}}catch(e){statusEl.textContent='V9 szerver: nem elérhető';statusEl.className='badge err'}}
async function go(){const text=input.value.trim();if(!text)return;input.value='';add(text,'user');send.disabled=true;const pending=add('Gondolkodik…','ai');try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:text})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||j.reason||('HTTP '+r.status));pending.textContent=j.response||'(üres válasz)'}catch(e){pending.textContent='Hiba: '+e.message;pending.classList.add('err')}finally{send.disabled=false;input.focus();health()}}
async function stopAll(){stopBtn.disabled=true;send.disabled=true;statusEl.textContent='Leállítás…';presence.close();try{await fetch('/api/shutdown',{method:'POST'});}catch(e){}document.body.innerHTML='<div style="font-family:system-ui;padding:40px;color:#eef2ff;background:#0b0d12;min-height:100vh"><h2>BuyFlow AI leállítva</h2><p>A V9/Qwen modell leállt, a WSL memória felszabadul. Ezt a lapot bezárhatod.</p></div>'}
send.onclick=go;stopBtn.onclick=stopAll;input.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter')go()});health();setInterval(health,5000);input.focus();
</script>
</body>
</html>"""


def proxy_json(path: str, payload: dict | None = None, headers: dict | None = None, timeout: int = 180) -> tuple[int, dict]:
    url = MODEL_BASE + path
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="GET" if payload is None else "POST")
    req.add_header("Accept", "application/json")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
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


def stop_model() -> dict:
    status, body = proxy_json(
        "/shutdown",
        {},
        headers={SHUTDOWN_HEADER: SHUTDOWN_TOKEN},
        timeout=8,
    )
    return {"status": status, "body": body}


def stop_everything(server: ThreadingHTTPServer) -> None:
    try:
        result = stop_model()
        print("ui model_shutdown", result)
    except Exception as exc:
        print("ui model_shutdown_error", repr(exc))
    finally:
        server.shutdown()


def schedule_auto_stop(server: ThreadingHTTPServer) -> None:
    def check() -> None:
        with _presence_lock:
            should_stop = _ever_had_client and _active_clients == 0
        if should_stop:
            print(f"ui no_client_for_{AUTO_STOP_GRACE_SECONDS}s: stopping model and UI")
            stop_everything(server)

    timer = threading.Timer(AUTO_STOP_GRACE_SECONDS, check)
    timer.daemon = True
    timer.start()


class Handler(BaseHTTPRequestHandler):
    server_version = "BuyFlowTeacherChatUI/1.1"

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
        global _active_clients, _ever_had_client
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
        if self.path == "/api/presence":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            with _presence_lock:
                _active_clients += 1
                _ever_had_client = True
                print("ui presence_open active=", _active_clients)
            try:
                while True:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    time.sleep(10)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                with _presence_lock:
                    _active_clients = max(0, _active_clients - 1)
                    remaining = _active_clients
                    print("ui presence_closed active=", remaining)
                if remaining == 0:
                    schedule_auto_stop(self.server)
            return
        self.send_json(404, {"ok": False, "error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path == "/api/shutdown":
            self.send_json(200, {"ok": True, "stopping": True})
            threading.Thread(target=stop_everything, args=(self.server,), name="buyflow-ui-shutdown", daemon=True).start()
            return
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
    print(f"auto_stop_after_last_tab_seconds: {AUTO_STOP_GRACE_SECONDS}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("teacher_ui_stopped: True")


if __name__ == "__main__":
    main()
