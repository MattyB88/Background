"""Fridge Challenge - web server for the fridge display + admin page.

Run:  python app.py --config config.json
Display: http://<pi>:8080/        Admin: http://<pi>:8080/admin?token=...
"""
from __future__ import annotations

import argparse
import hmac
import json
import logging
import threading
import urllib.request
from functools import wraps
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request

from game import Game
from hardware import Hardware
from storage import Store

log = logging.getLogger("fridge_challenge")
HERE = Path(__file__).resolve().parent


def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    for key in ("family", "challenges", "punishments"):
        if not cfg.get(key):
            raise SystemExit(f"config: '{key}' must be a non-empty list")
    return cfg


def make_webhook(cfg: dict):
    """POST each challenge result to ourorganiser.com (or anything else)."""
    url = (cfg or {}).get("url")
    if not url:
        return None
    headers = {"Content-Type": "application/json"}
    if cfg.get("token"):
        headers["Authorization"] = f"Bearer {cfg['token']}"

    def post(payload: dict) -> None:
        req = urllib.request.Request(url, json.dumps(payload).encode(), headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                log.info("Webhook -> %s", resp.status)
        except Exception as exc:
            log.warning("Webhook failed: %s", exc)

    return lambda payload: threading.Thread(target=post, args=(payload,), daemon=True).start()


def create_app(game: Game, cfg: dict) -> Flask:
    app = Flask(__name__, template_folder=str(HERE / "templates"), static_folder=str(HERE / "static"))
    admin_token = cfg.get("admin_token") or ""

    def is_admin() -> bool:
        if not admin_token:
            return True
        supplied = request.headers.get("X-Admin-Token") or request.args.get("token") or ""
        return hmac.compare_digest(supplied, admin_token)

    def admin_only(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not is_admin():
                abort(401)
            return fn(*args, **kwargs)

        return wrapper

    @app.get("/")
    def display():
        return render_template("display.html")

    @app.get("/admin")
    def admin():
        return render_template("admin.html")

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/api/state")
    def state():
        return jsonify(game.state())

    @app.post("/api/press")
    def press():
        allowed = cfg.get("display", {}).get("allow_screen_press") or is_admin()
        if not allowed:
            abort(403)
        return {"accepted": game.press()}

    @app.get("/api/admin/summary")
    @admin_only
    def summary():
        return jsonify(game.admin_summary())

    @app.post("/api/admin/trigger")
    @admin_only
    def trigger():
        member = (request.get_json(silent=True) or {}).get("member") or None
        return {"started": game.trigger_now(member)}

    @app.post("/api/admin/cancel")
    @admin_only
    def cancel():
        return {"cancelled": game.cancel()}

    @app.post("/api/admin/pause")
    @admin_only
    def pause():
        game.set_paused(bool((request.get_json(silent=True) or {}).get("paused")))
        return {"paused": game.paused}

    @app.post("/api/admin/replan")
    @admin_only
    def replan():
        with game.lock:
            game.make_plan(game.now())
        return {"planned": len(game.plan)}

    @app.post("/api/admin/punishments/<int:pid>/done")
    @admin_only
    def punishment_done(pid: int):
        return {"done": game.store.complete_punishment(pid)}

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(HERE / "config.json"))
    parser.add_argument("--db", default=str(HERE / "fridge_challenge.sqlite3"))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--no-gpio", action="store_true", help="run without the physical buzzer")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config(args.config)
    game = Game(cfg, Store(args.db), notifier=make_webhook(cfg.get("webhook")))

    hw = Hardware(cfg.get("hardware", {}), on_press=game.press, enabled=not args.no_gpio)
    game.phase_listeners.append(hw.on_phase)

    threading.Thread(target=game.run_forever, daemon=True, name="game-loop").start()
    try:
        create_app(game, cfg).run(host=args.host, port=args.port, threaded=True)
    finally:
        hw.close()


if __name__ == "__main__":
    main()
