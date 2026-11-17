"""Global hotkeys, which work while the Remote Play window has focus. Uses pynput."""
from __future__ import annotations

import logging
from typing import Callable

log = logging.getLogger(__name__)


def start_hotkeys(bindings: dict[str, Callable[[], object]]):
    """bindings: {"f8": fn, ...}. Returns the listener, or None if pynput is unavailable."""
    try:
        from pynput import keyboard
    except Exception as e:  # noqa: BLE001
        log.warning("hotkeys disabled (pynput unavailable: %s). Use the /control page instead.", e)
        return None

    keymap = {}
    for name, fn in bindings.items():
        key = getattr(keyboard.Key, name.lower(), None)
        if key is None:
            log.warning("unknown hotkey %r ignored", name)
            continue
        keymap[key] = fn

    def on_press(key):
        fn = keymap.get(key)
        if fn:
            try:
                fn()
            except Exception:  # noqa: BLE001
                log.exception("hotkey handler failed")

    listener = keyboard.Listener(on_press=on_press, daemon=True)
    listener.start()
    log.info("hotkeys: %s", ", ".join(f"{k.upper()}={v.__name__}" for k, v in bindings.items()))
    return listener
