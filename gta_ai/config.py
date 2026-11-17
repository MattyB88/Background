"""Configuration: defaults, overlaid by a TOML file, then by CLI flags."""
from __future__ import annotations

import copy
import tomllib
from pathlib import Path

DEFAULTS: dict = {
    "capture": {
        "source": "window:PS Remote Play",   # or "window:chiaki", "monitor:1", "region:x,y,w,h", "file:img.png"
        "max_width": 1280,
        "jpeg_quality": 70,
    },
    "gamepad": {
        "type": "x360",          # x360 (chiaki-ng) | ds4 (official PS Remote Play) | dry
        "invert_y": None,        # None = backend default; flip if stick up/down is reversed
        "tick_hz": 120,
        "tap_ms": 100,
        "sustain_timeout_s": 8.0,
        "blocked_buttons": [],   # e.g. ["options", "share"] to stop the AI opening menus
    },
    "brain": {
        "type": "claude",        # claude | mock
        "model": "claude-opus-5-5",
        "effort": "low",         # low = fastest reactions; medium/high = smarter but slower
        "max_tokens": 6000,
        "fast_mode": False,      # Opus 5.5 fast mode: faster output at 2x price
        "use_fallbacks": True,
        "price_in_per_mtok": 4.0,
        "price_out_per_mtok": 20.0,
        "controls_file": "",     # custom controls cheat sheet (defaults to prompts/controls.md)
        "timeout_s": 30.0,
    },
    "loop": {
        "mission": "Explore the city, get a car, drive around and cause harmless chaos. "
                   "If a story mission is active, follow its on-screen objectives.",
        "history_turns": 8,
        "think_lead_ms": 400,    # start thinking this long before the current steps finish
        "min_interval_s": 0.5,
        "max_steps": 8,
        "max_step_ms": 4000,
        "max_plan_ms": 8000,
        "max_cost_usd": 25.0,    # stops the AI (pad released) once this much is spent
        "max_consecutive_errors": 5,
        "save_frames": True,     # runs/<timestamp>/ frame + decision log for highlights/debugging
        "start_paused": True,    # start paused; press F8 or use /control to go live
    },
    "overlay": {
        "enabled": True,
        "host": "127.0.0.1",
        "port": 8765,
        "text_file": "overlay/commentary.txt",
    },
    "hotkeys": {
        "enabled": True,
        "pause": "f8",
        "panic": "f9",           # always pauses (never resumes)
        "quit": "f10",
    },
}


def _merge(base: dict, over: dict) -> dict:
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def load_config(path: str | None) -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    if path:
        with Path(path).open("rb") as f:
            _merge(cfg, tomllib.load(f))
    return cfg
