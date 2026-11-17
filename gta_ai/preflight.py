"""Pre-stream checks. Run each one before going live:

  python -m gta_ai.preflight -c config.toml --capture
  python -m gta_ai.preflight -c config.toml --pad          # or --pad ds4 / --pad x360
  python -m gta_ai.preflight -c config.toml --api          # one real Claude call (~1-3 cents)
"""
from __future__ import annotations

import argparse
import logging
import time

from .actions import NEUTRAL, PadState
from .config import load_config


def check_capture(source: str) -> None:
    from .capture import Capturer

    cap = Capturer(source)
    t = time.monotonic()
    frame = cap.grab()
    dt = time.monotonic() - t
    frame.image.save("preflight_capture.jpg")
    print(f"[capture] OK  source={source} native={frame.source_size} sent={frame.image.size} "
          f"jpeg={len(frame.jpeg) // 1024}KB brightness={frame.mean_brightness:.0f} grab={dt * 1000:.0f}ms")
    print("[capture] open preflight_capture.jpg and check it shows ONLY the game picture.")


def check_pad(kind: str, invert_y: bool | None) -> None:
    from .gamepad import make_pad

    pad = make_pad(kind, invert_y)
    print(f"[pad] virtual {kind} controller created.")
    print("[pad] Now: put the PS5 on the HOME SCREEN (or in-game), focus the Remote Play window,")
    print("      and make sure the client lists the virtual controller. Starting in 8 seconds...")
    time.sleep(8)

    def hold(desc: str, state: PadState, secs: float) -> None:
        print(f"[pad] {desc}")
        pad.apply(state)
        time.sleep(secs)
        pad.apply(NEUTRAL)
        time.sleep(0.4)

    for _ in range(2):
        hold("D-pad RIGHT (home screen selection should move right)", PadState(frozenset({"dpad_right"})), 0.15)
    for _ in range(2):
        hold("D-pad LEFT (selection should move back left)", PadState(frozenset({"dpad_left"})), 0.15)
    hold("Left stick UP for 1.5s (character walks FORWARD / menu moves up)", PadState(ly=1.0), 1.5)
    hold("Left stick DOWN for 1.5s", PadState(ly=-1.0), 1.5)
    hold("Left stick RIGHT for 1s", PadState(lx=1.0), 1.0)
    hold("Right stick RIGHT for 1s (camera pans right)", PadState(rx=1.0), 1.0)
    hold("R2 half pull for 1s", PadState(r2=0.5), 1.0)
    pad.close()
    print("[pad] Done. If UP/DOWN was reversed set gamepad.invert_y (true/false) in your config.")
    print("[pad] If NOTHING happened, the Remote Play client is not seeing the virtual pad. See README.")


def check_api(source: str, model: str) -> None:
    from .actions import Limits
    from .brain import ClaudeBrain
    from .capture import Capturer

    frame = Capturer(source).grab()
    brain = ClaudeBrain(model=model, limits=Limits())
    d = brain.decide(frame, "Preflight test turn. Describe what you see and propose your first inputs.")
    print(f"[api] OK  model={d.model} latency={d.latency_s:.1f}s cost=${d.cost_usd:.4f} {d.note}")
    print(f"[api] observation: {d.plan.observation}")
    print(f"[api] commentary:  {d.plan.commentary}")
    print(f"[api] plan:        {d.plan.describe()}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m gta_ai.preflight")
    ap.add_argument("-c", "--config", help="TOML config (source/pad/model are read from it)")
    ap.add_argument("--capture", action="store_true", help="grab one frame -> preflight_capture.jpg")
    ap.add_argument("--pad", nargs="?", const="config", choices=["config", "x360", "ds4", "dry"],
                    help="drive the virtual pad through a test pattern")
    ap.add_argument("--invert-y", choices=["true", "false"])
    ap.add_argument("--api", action="store_true", help="one real Claude call on a captured frame")
    ap.add_argument("--source")
    ap.add_argument("--model")
    a = ap.parse_args()
    cfg = load_config(a.config)
    source = a.source or cfg["capture"]["source"]
    model = a.model or cfg["brain"]["model"]
    pad_kind = cfg["gamepad"]["type"] if a.pad == "config" else a.pad
    invert = cfg["gamepad"]["invert_y"] if a.invert_y is None else a.invert_y == "true"
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if not (a.capture or a.pad or a.api):
        ap.print_help()
        return
    if a.capture:
        check_capture(source)
    if pad_kind:
        check_pad(pad_kind, invert)
    if a.api:
        check_api(source, model)


if __name__ == "__main__":
    main()
