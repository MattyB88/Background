"""Optional AI assistant (Anthropic Claude API). The AOI works fully without it.

What it gets (no customer data, no images unless the user sends one):
  * program summary: package mix, thresholds, component count
  * history stats: first-pass yield, defect pareto by ref / package / type, false-call rate, cycle time
  * optional single defect crop pair (golden vs test) for a second opinion
What it returns: short plain-English actions (tune threshold X, check feeder for Y, re-teach Z).
"""
from __future__ import annotations

import base64
import json
import os
import urllib.request

import cv2

from .program import ROOT

SETTINGS = ROOT / "settings.json"
DEFAULT_MODEL = "claude-sonnet-5"


def settings():
    s = json.loads(SETTINGS.read_text()) if SETTINGS.exists() else {}
    s.setdefault("model", DEFAULT_MODEL)
    s.setdefault("enabled", False)
    return s


def save_settings(new):
    s = settings()
    s.update({k: v for k, v in new.items() if k in ("api_key", "model", "enabled")})
    ROOT.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps(s))
    try:
        os.chmod(SETTINGS, 0o600)
    except OSError:
        pass


def available():
    s = settings()
    return bool(s["enabled"] and (s.get("api_key") or os.environ.get("ANTHROPIC_API_KEY")))


def _call(content, max_tokens=700):
    s = settings()
    key = s.get("api_key") or os.environ.get("ANTHROPIC_API_KEY")
    if not (s["enabled"] and key):
        raise RuntimeError("AI is off - add a key in Advanced settings")
    body = json.dumps({"model": s["model"], "max_tokens": max_tokens, "system": (
        "You are an SMT process engineer assisting an AOI operator. Be brief: max 6 bullet points, "
        "each an action. Mention component refs and numbers. No preamble."),
        "messages": [{"role": "user", "content": content}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", body, {
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return "".join(b.get("text", "") for b in data.get("content", []))


def summarize(program):
    pk = {}
    for c in program.data["components"]:
        pk[c["package"]] = pk.get(c["package"], 0) + 1
    payload = {"program": program.name, "components": len(program.data["components"]), "packages": pk,
               "thresholds": program.data["thresholds"], "stats": program.stats()}
    return _call([{"type": "text", "text": "AOI line data (JSON). Summarise yield, likely root causes "
                   "(placement, feeder, polarity, paste, lighting, program), and what to adjust before the next "
                   "build. Flag refs where the false-call rate suggests the threshold/ROI is wrong.\n"
                   + json.dumps(payload)}])


def second_opinion(program, run_id, ref):
    d = program.dir / "runs" / run_id
    res = json.loads((d / "result.json").read_text())
    comp = next(c for c in res["components"] if c["ref"] == ref)
    imgs = []
    for kind in ("golden", "test"):
        img = cv2.imread(str(d / f"{ref}_{kind}.png"))
        img = cv2.resize(img, None, fx=max(1, 256 / img.shape[1]), fy=max(1, 256 / img.shape[1]))
        ok, buf = cv2.imencode(".png", img)
        imgs.append({"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                                  "data": base64.b64encode(buf).decode()}})
    text = (f"Image 1 = golden {comp['package']} ({ref}), image 2 = inspected. AOI flagged {comp['fails']} "
            f"scores {json.dumps({k: comp.get(k) for k in ('presence', 'polarity', 'ocv', 'offset_mm')})}. "
            "Answer first line exactly REAL DEFECT or FALSE CALL, then one sentence why.")
    return _call(imgs + [{"type": "text", "text": text}], 200)
