"""Main loop: capture -> Claude -> executor (virtual pad) -> overlay."""
from __future__ import annotations

import argparse
import json
import logging
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path

from .actions import Limits
from .brain import ClaudeBrain, MockBrain
from .capture import Capturer
from .config import load_config
from .executor import Executor
from .gamepad import make_pad
from .hotkeys import start_hotkeys
from .overlay import LiveState, start_server

log = logging.getLogger("gta_ai")


def build_context(mission: str, history: deque, notes: list[str], turn: int, paused_for: float) -> str:
    lines = [f"MISSION (from the streamer): {mission}", f"Turn {turn}."]
    if notes:
        lines.append("NEW DIRECTOR NOTES (act on these now, they override the mission):")
        lines += [f"- {n}" for n in notes]
    if paused_for > 0:
        lines.append(f"(The AI was paused for {paused_for:.0f}s. A human may have moved things; re-assess.)")
    if history:
        lines.append("Your recent turns (oldest first):")
        for h in history:
            lines.append(f"- [{h['turn']}] saw: {h['observation']} | goal: {h['goal']} | did: {h['action']}")
    lines.append("Here is the current screenshot. Decide your next inputs.")
    return "\n".join(lines)


def run(cfg: dict) -> None:
    lc, bc, gc = cfg["loop"], cfg["brain"], cfg["gamepad"]
    limits = Limits(
        max_steps=lc["max_steps"], max_step_ms=lc["max_step_ms"], max_plan_ms=lc["max_plan_ms"],
        tap_ms=gc["tap_ms"], blocked_buttons=frozenset(gc["blocked_buttons"]),
    )
    capturer = Capturer(cfg["capture"]["source"], cfg["capture"]["max_width"], cfg["capture"]["jpeg_quality"])
    if bc["type"] == "mock":
        brain = MockBrain(limits)
    else:
        brain = ClaudeBrain(
            model=bc["model"], effort=bc["effort"], max_tokens=bc["max_tokens"], fast_mode=bc["fast_mode"],
            use_fallbacks=bc["use_fallbacks"], price_in_per_mtok=bc["price_in_per_mtok"],
            price_out_per_mtok=bc["price_out_per_mtok"], limits=limits,
            controls_path=bc["controls_file"] or None, timeout_s=bc["timeout_s"],
        )
    pad = make_pad(gc["type"], gc["invert_y"])
    executor = Executor(pad, gc["tick_hz"], gc["tap_ms"], gc["sustain_timeout_s"])
    state = LiveState(cfg["overlay"]["text_file"] if cfg["overlay"]["enabled"] else None)
    quit_evt = threading.Event()

    def toggle_pause():
        paused = executor.toggle_pause()
        state.update(paused=paused, status="paused" if paused else "live")
        return paused

    def panic():
        executor.set_paused(True)
        state.update(paused=True, status="paused (panic)")

    def quit():  # noqa: A001 - name shows in the hotkey help line
        log.warning("quit requested")
        executor.set_paused(True)
        quit_evt.set()

    server = None
    if cfg["overlay"]["enabled"]:
        server = start_server(state, cfg["overlay"]["host"], cfg["overlay"]["port"], toggle_pause)
    if cfg["hotkeys"]["enabled"]:
        hk = cfg["hotkeys"]
        start_hotkeys({hk["pause"]: toggle_pause, hk["panic"]: panic, hk["quit"]: quit})

    run_dir = None
    if lc["save_frames"]:
        run_dir = Path("runs") / datetime.now().strftime("%Y%m%d-%H%M%S")
        run_dir.mkdir(parents=True, exist_ok=True)
        log.info("saving frames and decisions to %s", run_dir)

    executor.start()
    if lc["start_paused"]:
        executor.set_paused(True)
        state.update(paused=True, status="paused", commentary="Standing by... (press F8 to go live)")
    else:
        state.update(status="live")

    history: deque = deque(maxlen=lc["history_turns"])
    turn, total_cost, errors = 0, 0.0, 0
    paused_since: float | None = time.monotonic() if executor.paused else None
    last_decision = 0.0

    try:
        while not quit_evt.is_set():
            if executor.paused:
                paused_since = paused_since or time.monotonic()
                quit_evt.wait(0.1)
                continue
            paused_for = time.monotonic() - paused_since if paused_since else 0.0
            paused_since = None

            # wait until the current timed steps are nearly done
            while (not quit_evt.is_set() and not executor.paused
                   and executor.remaining_ms() > lc["think_lead_ms"]):
                quit_evt.wait(0.02)
            gap = lc["min_interval_s"] - (time.monotonic() - last_decision)
            if gap > 0:
                quit_evt.wait(gap)
            if quit_evt.is_set() or executor.paused:
                continue

            turn += 1
            try:
                frame = capturer.grab()
                state.update(status="thinking")
                notes = state.take_notes()
                ctx = build_context(lc["mission"], history, notes, turn, paused_for)
                decision = brain.decide(frame, ctx)
                errors = 0
            except Exception as e:  # noqa: BLE001 - keep the stream alive
                errors += 1
                log.exception("turn %d failed (%d in a row)", turn, errors)
                if errors >= lc["max_consecutive_errors"]:
                    log.error("too many consecutive errors - pausing AI")
                    executor.set_paused(True)
                state.update(status=f"error: {e.__class__.__name__}", paused=executor.paused)
                quit_evt.wait(min(2 ** errors, 15))
                continue
            last_decision = time.monotonic()

            if executor.paused:  # paused while we were thinking: drop the stale plan
                continue
            plan = decision.plan
            executor.submit(plan)
            total_cost += decision.cost_usd
            action = plan.describe()
            history.append({"turn": turn, "observation": plan.observation[:160],
                            "goal": plan.goal, "action": action[:200]})
            state.update(
                commentary=plan.commentary or state.snapshot()["commentary"], goal=plan.goal,
                observation=plan.observation, action=action, turn=turn,
                latency_s=decision.latency_s, cost_usd=round(total_cost, 3), model=decision.model,
                status="live",
            )
            log.info("turn %d (%.1fs, $%.3f total) %s\n    -> %s", turn, decision.latency_s,
                     total_cost, plan.commentary, action)

            if run_dir:
                frame.image.save(run_dir / f"{turn:05d}.jpg", quality=80)
                with (run_dir / "decisions.jsonl").open("a", encoding="utf-8") as f:
                    f.write(json.dumps({"turn": turn, "t": frame.captured_at, "latency_s": decision.latency_s,
                                        "cost_usd": decision.cost_usd, "model": decision.model,
                                        "note": decision.note, "context": ctx, "output": decision.raw}) + "\n")

            if total_cost >= lc["max_cost_usd"]:
                log.error("cost cap $%.2f reached - pausing AI", lc["max_cost_usd"])
                executor.set_paused(True)
                state.update(paused=True, status="cost cap reached",
                             commentary="I've spent my whole allowance. Taking a break!")
    except KeyboardInterrupt:
        log.warning("Ctrl+C")
    finally:
        executor.stop()  # releases every input on the virtual pad
        if server:
            server.shutdown()
        log.info("stopped after %d turns, ~$%.2f spent", turn, total_cost)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m gta_ai", description="Claude plays GTA over PS Remote Play")
    ap.add_argument("-c", "--config", help="TOML config file (see config.example.toml)")
    ap.add_argument("--source", help="capture source, e.g. 'window:chiaki' or 'monitor:1'")
    ap.add_argument("--pad", choices=["x360", "ds4", "dry"], help="virtual gamepad type")
    ap.add_argument("--brain", choices=["claude", "mock"])
    ap.add_argument("--model")
    ap.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"])
    ap.add_argument("--mission")
    ap.add_argument("--live", action="store_true", help="start unpaused")
    ap.add_argument("--no-hotkeys", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    for noisy in ("httpx", "httpx2", "httpcore", "anthropic"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    cfg = load_config(a.config)
    if a.source:
        cfg["capture"]["source"] = a.source
    if a.pad:
        cfg["gamepad"]["type"] = a.pad
    if a.brain:
        cfg["brain"]["type"] = a.brain
    if a.model:
        cfg["brain"]["model"] = a.model
    if a.effort:
        cfg["brain"]["effort"] = a.effort
    if a.mission:
        cfg["loop"]["mission"] = a.mission
    if a.live:
        cfg["loop"]["start_paused"] = False
    if a.no_hotkeys:
        cfg["hotkeys"]["enabled"] = False
    run(cfg)
