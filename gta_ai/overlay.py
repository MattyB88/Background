"""Stream overlay and control panel (built on the standard-library HTTP server; no extra deps).

  http://127.0.0.1:8765/          OBS Browser Source (transparent background)
  http://127.0.0.1:8765/control   Streamer panel: pause/resume and director notes
  http://127.0.0.1:8765/state     JSON
It also writes overlay/commentary.txt for an OBS "Text (read from file)" source.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

log = logging.getLogger(__name__)


class LiveState:
    def __init__(self, text_file: str | None = "overlay/commentary.txt") -> None:
        self._lock = threading.Lock()
        self.data: dict = {
            "commentary": "Booting up...", "goal": "", "observation": "", "action": "",
            "turn": 0, "latency_s": 0.0, "cost_usd": 0.0, "paused": False,
            "status": "starting", "model": "", "director_note": "", "started": time.time(),
        }
        self.notes: deque[str] = deque(maxlen=5)
        self.text_file = Path(text_file) if text_file else None
        if self.text_file:
            self.text_file.parent.mkdir(parents=True, exist_ok=True)

    def update(self, **kw) -> None:
        with self._lock:
            self.data.update(kw)
            commentary = self.data["commentary"]
        if self.text_file and "commentary" in kw:
            try:
                self.text_file.write_text(commentary, encoding="utf-8")
            except OSError:
                log.exception("could not write overlay text file")

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self.data)

    def add_note(self, note: str) -> None:
        note = note.strip()[:300]
        if note:
            with self._lock:
                self.notes.append(note)
                self.data["director_note"] = note
            log.info("director note: %s", note)

    def take_notes(self) -> list[str]:
        with self._lock:
            notes = list(self.notes)
            self.notes.clear()
            return notes


OVERLAY_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>AI Overlay</title>
<style>
body{margin:0;background:transparent;font-family:system-ui,Segoe UI,sans-serif;color:#fff}
.box{position:fixed;left:24px;bottom:24px;max-width:46vw;background:rgba(10,10,20,.72);
border-left:6px solid #ff3ea5;border-radius:10px;padding:14px 18px;text-shadow:0 1px 2px #000}
.c{font-size:26px;font-weight:600;line-height:1.25}
.g{margin-top:6px;font-size:17px;color:#7fe7ff}
.m{margin-top:6px;font-size:13px;color:#bbb;font-family:Consolas,monospace}
.p{color:#ffcf3e;font-weight:700}
</style></head><body><div class="box"><div class="c" id="c"></div><div class="g" id="g"></div>
<div class="m" id="m"></div></div><script>
async function tick(){try{const s=await (await fetch('/state')).json();
c.textContent=s.commentary;g.textContent=s.goal?('Goal: '+s.goal):'';
m.innerHTML=(s.paused?'<span class="p">PAUSED</span> ':'')+'turn '+s.turn+' | think '+s.latency_s.toFixed(1)+'s | '+s.action;
}catch(e){}}setInterval(tick,500);tick();</script></body></html>"""

CONTROL_HTML = """<!doctype html><html><head><meta charset="utf-8"><title>AI Control</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:16px;max-width:720px}
button{font-size:22px;padding:14px 22px;border:0;border-radius:8px;margin:4px 0;width:100%}
#pause{background:#e33;color:#fff}input{font-size:18px;width:100%;box-sizing:border-box;padding:10px;margin:8px 0}
pre{white-space:pre-wrap;background:#222;padding:10px;border-radius:8px;font-size:13px}</style></head><body>
<h2>AI Pilot Control</h2><button id="pause" onclick="post('/pause')">PAUSE / RESUME</button>
<form onsubmit="event.preventDefault();post('/note',note.value);note.value=''">
<input id="note" placeholder="Director note, e.g. 'steal the red sports car'"><button>Send note</button></form>
<pre id="s"></pre><script>
async function post(u,b){await fetch(u,{method:'POST',body:b||''});tick()}
async function tick(){const s=await (await fetch('/state')).json();s_el.textContent=JSON.stringify(s,null,1);
pause.textContent=s.paused?'RESUME AI':'PAUSE AI (release pad)';pause.style.background=s.paused?'#2a2':'#e33'}
const s_el=document.getElementById('s');setInterval(tick,1000);tick();</script></body></html>"""


def start_server(state: LiveState, host: str, port: int, on_pause: Callable[[], bool]) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # silence default access log
            pass

        def _send(self, code: int, body: str, ctype: str) -> None:
            raw = body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):  # noqa: N802
            if self.path == "/":
                self._send(200, OVERLAY_HTML, "text/html; charset=utf-8")
            elif self.path == "/control":
                self._send(200, CONTROL_HTML, "text/html; charset=utf-8")
            elif self.path == "/state":
                self._send(200, json.dumps(state.snapshot()), "application/json")
            else:
                self._send(404, "not found", "text/plain")

        def do_POST(self):  # noqa: N802
            length = min(int(self.headers.get("Content-Length") or 0), 4096)
            body = self.rfile.read(length).decode("utf-8", "replace") if length else ""
            if self.path == "/pause":
                paused = on_pause()
                self._send(200, json.dumps({"paused": paused}), "application/json")
            elif self.path == "/note":
                state.add_note(body)
                self._send(200, "{}", "application/json")
            else:
                self._send(404, "not found", "text/plain")

    server = ThreadingHTTPServer((host, port), Handler)
    threading.Thread(target=server.serve_forever, name="overlay", daemon=True).start()
    log.info("overlay: http://%s:%d/  control: http://%s:%d/control", host, port, host, port)
    return server
