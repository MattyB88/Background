"""AOI web app. Run:  python -m aoi.app   then open http://localhost:5050"""
from __future__ import annotations

import json
import os
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, jsonify, request, send_file, abort

from . import ai, pnp_import, synth
from .program import Program, list_programs, _safe, ROOT

app = Flask(__name__, static_folder=str(Path(__file__).parent / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024
IMG_EXT = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}


def _img_from_request():
    f = request.files.get("image")
    if f is None:
        abort(400, "No image")
    img = cv2.imdecode(np.frombuffer(f.read(), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        abort(400, "Unreadable image")
    return img


def _capture(cam=0):
    cap = cv2.VideoCapture(int(cam))
    try:
        for _ in range(5):  # let exposure settle
            ok, img = cap.read()
        if not ok:
            abort(400, "Camera not available")
        return img
    finally:
        cap.release()


@app.errorhandler(ValueError)
@app.errorhandler(RuntimeError)
@app.errorhandler(FileNotFoundError)
def _err(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(400)
def _bad(e):
    return jsonify(error=getattr(e, "description", str(e))), 400


@app.get("/")
def index():
    return send_file(Path(__file__).parent / "static" / "index.html")


@app.get("/api/programs")
def programs():
    return jsonify(list_programs())


@app.post("/api/programs")
def new_program():
    p = Program(request.json["name"])
    p.save()
    return jsonify(p.data)


@app.post("/api/demo")
def demo():
    p = Program("DEMO_BOARD")
    p.import_placements(pnp_import.parse(synth.csv_text()))
    p.set_golden(synth.render())
    p.auto_teach()
    samples = ROOT / "demo_images"
    samples.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(samples / "good_1.png"), synth.render(light=0.75, angle=-1, offset=(30, 40), seed=5))
    cv2.imwrite(str(samples / "defects_1.png"), synth.render(
        {"U1": "polarity", "R1": "missing", "C1": "offset", "U2": "marking", "LED1": "polarity"},
        light=0.85, angle=1.5, offset=(50, 22), seed=2))
    return jsonify(ok=True, name=p.name, samples=str(samples))


@app.get("/api/demo/image/<kind>")
def demo_image(kind):
    return send_file(ROOT / "demo_images" / f"{_safe(kind)}.png")


def _prog(name):
    p = Program(name)
    if not p.file.exists():
        abort(404)
    return p


@app.get("/api/programs/<name>")
def get_program(name):
    p = _prog(name)
    return jsonify({**p.data, "overlay": p.overlay(), "has_golden": (p.dir / "golden.png").exists(),
                    "ai": ai.available()})


@app.post("/api/programs/<name>/import")
def import_file(name):
    p = Program(name)
    f = request.files["file"]
    parsed = pnp_import.parse_file(f.read(), units=request.form.get("units", "auto"))
    p.import_placements(parsed)
    return jsonify(count=len(parsed["components"]), warnings=parsed["warnings"],
                   packages=len(p.data["packages"]), fiducials=sum(c["fiducial"] for c in p.data["components"]))


@app.post("/api/programs/<name>/golden")
def golden(name):
    p = _prog(name)
    img = _capture(request.args.get("cam", 0)) if request.args.get("camera") else _img_from_request()
    p.set_golden(img)
    try:
        p.auto_teach()
        auto = True
    except ValueError:
        auto = False
    return jsonify(ok=True, auto_aligned=auto, w=img.shape[1], h=img.shape[0])


@app.get("/api/programs/<name>/golden.jpg")
def golden_img(name):
    p = _prog(name)
    img = p.golden()
    if img is None:
        abort(404)
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes(), 200, {"Content-Type": "image/jpeg"}


@app.post("/api/programs/<name>/teach")
def teach(name):
    p = _prog(name)
    if request.json.get("auto"):
        p.auto_teach()
    else:
        p.data["y_up"] = request.json.get("y_up", p.data["y_up"])
        p.teach(request.json["points"])
    return jsonify(ok=True, overlay=p.overlay())


@app.put("/api/programs/<name>/settings")
def prog_settings(name):
    p = _prog(name)
    body = request.json
    if "thresholds" in body:
        p.data["thresholds"].update({k: float(v) for k, v in body["thresholds"].items()})
    if "y_up" in body:
        p.data["y_up"] = bool(body["y_up"])
    p.save()
    return jsonify(ok=True)


@app.put("/api/programs/<name>/component/<ref>")
def edit_component(name, ref):
    p = _prog(name)
    for c in p.data["components"]:
        if c["ref"] == ref:
            for k in ("enabled", "dx", "dy", "rot", "package", "checks", "th", "fiducial"):
                if k in request.json:
                    c[k] = request.json[k]
            if c["package"] not in p.data["packages"]:
                from .packages import derive
                p.data["packages"][c["package"]] = derive(c["package"]).to_dict()
    p.save()
    return jsonify(ok=True, overlay=p.overlay())


@app.put("/api/programs/<name>/package/<path:pkg>")
def edit_package(name, pkg):
    p = _prog(name)
    d = p.data["packages"][pkg]
    from .packages import resize
    if "body_l" in request.json or "body_w" in request.json:
        resize(d, request.json.get("body_l"), request.json.get("body_w"))
    for k in ("polarized", "marking", "pads"):
        if k in request.json:
            d[k] = request.json[k]
    p.save()
    return jsonify(ok=True, overlay=p.overlay())


@app.post("/api/programs/<name>/autofit/<path:pkg>")
def autofit(name, pkg):
    p = _prog(name)
    l, w, n = p.autofit(pkg)
    return jsonify(body_l=l, body_w=w, measured=n, overlay=p.overlay())


@app.post("/api/programs/<name>/inspect")
def inspect(name):
    p = _prog(name)
    if request.args.get("camera"):
        img = _capture(request.args.get("cam", 0))
    elif request.args.get("file"):
        img = cv2.imread(request.args["file"])
        if img is None:
            abort(400, "Cannot read " + request.args["file"])
    else:
        img = _img_from_request()
    return jsonify(p.inspect(img, request.args.get("board", "")))


@app.post("/api/programs/<name>/watch")
def watch(name):
    """Inspect newest unseen image in a folder (for camera software that saves files)."""
    p = _prog(name)
    folder = Path(request.json["folder"])
    if not folder.is_dir():
        abort(400, "Folder not found")
    seen = set(p.data.get("_seen", []))
    files = sorted((f for f in folder.iterdir() if f.suffix.lower() in IMG_EXT and str(f) not in seen),
                   key=lambda f: f.stat().st_mtime)
    if not files:
        return jsonify(idle=True)
    f = files[-1]
    p.data["_seen"] = (list(seen) + [str(f)])[-500:]
    p.save()
    img = cv2.imread(str(f))
    if img is None:
        return jsonify(idle=True)
    return jsonify(p.inspect(img, f.stem))


@app.get("/api/programs/<name>/runs/<run>/<fname>")
def run_file(name, run, fname):
    p = _prog(name)
    f = p.dir / "runs" / _safe(run) / _safe(fname)
    if not f.exists():
        abort(404)
    return send_file(f)


@app.post("/api/programs/<name>/feedback")
def feedback(name):
    p = _prog(name)
    b = request.json
    p.feedback(b["run"], b["ref"], b["verdict"])
    return jsonify(ok=True)


@app.get("/api/programs/<name>/stats")
def stats(name):
    return jsonify(_prog(name).stats())


@app.get("/api/settings")
def get_settings():
    s = ai.settings()
    return jsonify(enabled=s["enabled"], model=s["model"], has_key=bool(s.get("api_key") or os.environ.get("ANTHROPIC_API_KEY")))


@app.post("/api/settings")
def set_settings():
    ai.save_settings(request.json)
    return get_settings()


@app.post("/api/programs/<name>/ai/summary")
def ai_summary(name):
    return jsonify(text=ai.summarize(_prog(name)))


@app.post("/api/programs/<name>/ai/opinion")
def ai_opinion(name):
    b = request.json
    return jsonify(text=ai.second_opinion(_prog(name), b["run"], b["ref"]))


def main():
    port = int(os.environ.get("AOI_PORT", 5050))
    print(f"AOI running - open http://localhost:{port}   (data: {ROOT})")
    app.run("0.0.0.0", port, threaded=True)


if __name__ == "__main__":
    main()
