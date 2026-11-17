"""Real-time executor: plays a Plan onto the pad at a fixed tick rate.

Claude takes seconds to think, but the game runs at 60 fps. The executor runs on its
own thread. It plays the timed steps of the newest plan, then holds the plan's
`sustain` state (e.g. "keep driving straight") until the next plan arrives.
If no new plan arrives within `sustain_timeout_s`, it returns the pad to neutral.
"""
from __future__ import annotations

import logging
import threading
import time

from .actions import NEUTRAL, PadState, Plan
from .gamepad import Pad

log = logging.getLogger(__name__)


class Executor(threading.Thread):
    def __init__(
        self,
        pad: Pad,
        tick_hz: float = 120.0,
        tap_ms: int = 100,
        sustain_timeout_s: float = 8.0,
        clock=time.monotonic,
    ) -> None:
        super().__init__(name="executor", daemon=True)
        self.pad = pad
        self.tick = 1.0 / tick_hz
        self.tap_s = tap_ms / 1000.0
        self.sustain_timeout_s = sustain_timeout_s
        self.clock = clock
        self._lock = threading.Lock()
        self._plan: Plan | None = None
        self._start = 0.0
        self._paused = False
        self._stop = threading.Event()
        self.current: PadState = NEUTRAL

    # control -----------------------------------------------------------
    def submit(self, plan: Plan) -> None:
        with self._lock:
            self._plan = plan
            self._start = self.clock()

    def set_paused(self, paused: bool) -> None:
        with self._lock:
            self._paused = paused
            if paused:
                self._plan = None
        self._apply(NEUTRAL if paused else self.current)
        log.warning("AI %s", "PAUSED - pad released" if paused else "RESUMED")

    def toggle_pause(self) -> bool:
        self.set_paused(not self.paused)
        return self.paused

    @property
    def paused(self) -> bool:
        return self._paused

    def stop(self) -> None:
        self._stop.set()
        if self.is_alive() and threading.current_thread() is not self:
            self.join(timeout=1.0)
        self.pad.close()

    # state -------------------------------------------------------------
    def remaining_ms(self) -> float:
        """Milliseconds of timed steps left in the current plan (0 when sustaining)."""
        with self._lock:
            if self._plan is None:
                return 0.0
            left = self._plan.total_ms / 1000.0 - (self.clock() - self._start)
            return max(0.0, left * 1000.0)

    def desired_state(self, now: float | None = None) -> PadState:
        now = self.clock() if now is None else now
        with self._lock:
            if self._paused or self._plan is None:
                return NEUTRAL
            plan, elapsed = self._plan, now - self._start
        t = elapsed
        for step in plan.steps:
            dur = step.duration_ms / 1000.0
            if t < dur:
                return step.state.with_buttons(step.tap) if t < self.tap_s else step.state
            t -= dur
        # all timed steps done -> sustain, with a dead-man timeout
        return plan.sustain if t < self.sustain_timeout_s else NEUTRAL

    # loop --------------------------------------------------------------
    def _apply(self, state: PadState) -> None:
        try:
            self.pad.apply(state)
            self.current = state
        except Exception:  # noqa: BLE001 - never let the pad kill the loop
            log.exception("pad.apply failed")

    def run(self) -> None:
        nxt = self.clock()
        while not self._stop.is_set():
            state = self.desired_state()
            if state != self.current:
                self._apply(state)
            nxt += self.tick
            delay = nxt - self.clock()
            if delay > 0:
                self._stop.wait(delay)
            else:
                nxt = self.clock()
        self._apply(NEUTRAL)
