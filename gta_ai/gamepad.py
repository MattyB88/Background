"""Virtual gamepad backends.

  * x360  - virtual Xbox 360 pad via ViGEmBus (Windows) / uinput (Linux) using
            `vgamepad`. Best choice with chiaki-ng (SDL sees it as a normal pad).
  * ds4   - virtual DualShock 4 via `vgamepad`. Try this with the official
            PS Remote Play app, which only accepts PlayStation controllers.
  * dry   - prints state changes; no driver needed. For testing.

Every backend takes a full PadState in `apply()` (idempotent), so the executor
never has to track individual press/release events.
"""
from __future__ import annotations

import logging
import time

from .actions import NEUTRAL, PadState

log = logging.getLogger(__name__)


class Pad:
    name = "base"

    def apply(self, state: PadState) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def neutral(self) -> None:
        self.apply(NEUTRAL)

    def close(self) -> None:
        try:
            self.neutral()
        except Exception:  # noqa: BLE001 - best effort on shutdown
            log.exception("failed to neutralise pad on close")


class DryRunPad(Pad):
    name = "dry"

    def __init__(self, verbose: bool = True) -> None:
        self.verbose = verbose
        self.history: list[tuple[float, PadState]] = []
        self._last: PadState | None = None

    def apply(self, state: PadState) -> None:
        if state == self._last:
            return
        self._last = state
        self.history.append((time.monotonic(), state))
        if self.verbose:
            log.info("[pad] %s", state.describe())


class _VGamepadBase(Pad):
    def __init__(self, invert_y: bool) -> None:
        try:
            import vgamepad as vg  # noqa: F401
        except Exception as e:  # ImportError, or ViGEmBus missing on Windows
            raise RuntimeError(
                "vgamepad could not start. On Windows install the ViGEmBus driver "
                "(pip install vgamepad runs its installer; or get it from "
                "https://github.com/nefarius/ViGEmBus/releases) and reboot. "
                f"Original error: {e!r}"
            ) from e
        self.vg = vg
        self.invert_y = invert_y
        self._last: PadState | None = None

    def _y(self, y: float) -> float:
        return -y if self.invert_y else y


class X360Pad(_VGamepadBase):
    name = "x360"

    def __init__(self, invert_y: bool = False) -> None:
        super().__init__(invert_y)
        vg = self.vg
        B = vg.XUSB_BUTTON
        self.map = {
            "cross": B.XUSB_GAMEPAD_A,
            "circle": B.XUSB_GAMEPAD_B,
            "square": B.XUSB_GAMEPAD_X,
            "triangle": B.XUSB_GAMEPAD_Y,
            "l1": B.XUSB_GAMEPAD_LEFT_SHOULDER,
            "r1": B.XUSB_GAMEPAD_RIGHT_SHOULDER,
            "l3": B.XUSB_GAMEPAD_LEFT_THUMB,
            "r3": B.XUSB_GAMEPAD_RIGHT_THUMB,
            "dpad_up": B.XUSB_GAMEPAD_DPAD_UP,
            "dpad_down": B.XUSB_GAMEPAD_DPAD_DOWN,
            "dpad_left": B.XUSB_GAMEPAD_DPAD_LEFT,
            "dpad_right": B.XUSB_GAMEPAD_DPAD_RIGHT,
            "options": B.XUSB_GAMEPAD_START,
            "share": B.XUSB_GAMEPAD_BACK,
            # Xbox pads have no touchpad. chiaki-ng lets you bind one in its
            # controller settings; otherwise this button is ignored.
        }
        self.pad = vg.VX360Gamepad()
        self.neutral()

    def apply(self, state: PadState) -> None:
        if state == self._last:
            return
        self._last = state
        p = self.pad
        p.reset()
        for b in state.buttons:
            btn = self.map.get(b)
            if btn is not None:
                p.press_button(button=btn)
        p.left_joystick_float(x_value_float=state.lx, y_value_float=self._y(state.ly))
        p.right_joystick_float(x_value_float=state.rx, y_value_float=self._y(state.ry))
        p.left_trigger_float(value_float=state.l2)
        p.right_trigger_float(value_float=state.r2)
        p.update()


class DS4Pad(_VGamepadBase):
    name = "ds4"

    def __init__(self, invert_y: bool = True) -> None:
        # DS4 reports Y with 0 = up, so vgamepad's float API needs y negated to
        # keep our "+y = up" convention. Run `python -m gta_ai.preflight --pad`
        # and flip gamepad.invert_y in config if the stick goes the wrong way.
        super().__init__(invert_y)
        vg = self.vg
        B = vg.DS4_BUTTONS
        self.map = {
            "cross": B.DS4_BUTTON_CROSS,
            "circle": B.DS4_BUTTON_CIRCLE,
            "square": B.DS4_BUTTON_SQUARE,
            "triangle": B.DS4_BUTTON_TRIANGLE,
            "l1": B.DS4_BUTTON_SHOULDER_LEFT,
            "r1": B.DS4_BUTTON_SHOULDER_RIGHT,
            "l3": B.DS4_BUTTON_THUMB_LEFT,
            "r3": B.DS4_BUTTON_THUMB_RIGHT,
            "options": B.DS4_BUTTON_OPTIONS,
            "share": B.DS4_BUTTON_SHARE,
        }
        D = vg.DS4_DPAD_DIRECTIONS
        self.dpad = {
            (0, 0): D.DS4_BUTTON_DPAD_NONE,
            (0, 1): D.DS4_BUTTON_DPAD_NORTH,
            (1, 1): D.DS4_BUTTON_DPAD_NORTHEAST,
            (1, 0): D.DS4_BUTTON_DPAD_EAST,
            (1, -1): D.DS4_BUTTON_DPAD_SOUTHEAST,
            (0, -1): D.DS4_BUTTON_DPAD_SOUTH,
            (-1, -1): D.DS4_BUTTON_DPAD_SOUTHWEST,
            (-1, 0): D.DS4_BUTTON_DPAD_WEST,
            (-1, 1): D.DS4_BUTTON_DPAD_NORTHWEST,
        }
        self.pad = vg.VDS4Gamepad()
        self.neutral()

    def apply(self, state: PadState) -> None:
        if state == self._last:
            return
        self._last = state
        vg, p, b = self.vg, self.pad, state.buttons
        p.reset()
        for name in b:
            btn = self.map.get(name)
            if btn is not None:
                p.press_button(button=btn)
        dx = ("dpad_right" in b) - ("dpad_left" in b)
        dy = ("dpad_up" in b) - ("dpad_down" in b)
        p.directional_pad(direction=self.dpad[(dx, dy)])
        if "touchpad" in b:
            p.press_special_button(special_button=vg.DS4_SPECIAL_BUTTONS.DS4_SPECIAL_BUTTON_TOUCHPAD)
        # Real DS4s also set the digital L2/R2 bits when the trigger is pulled.
        if state.l2 > 0.1:
            p.press_button(button=vg.DS4_BUTTONS.DS4_BUTTON_TRIGGER_LEFT)
        if state.r2 > 0.1:
            p.press_button(button=vg.DS4_BUTTONS.DS4_BUTTON_TRIGGER_RIGHT)
        p.left_joystick_float(x_value_float=state.lx, y_value_float=self._y(state.ly))
        p.right_joystick_float(x_value_float=state.rx, y_value_float=self._y(state.ry))
        p.left_trigger_float(value_float=state.l2)
        p.right_trigger_float(value_float=state.r2)
        p.update()


def make_pad(kind: str, invert_y: bool | None = None) -> Pad:
    kind = kind.lower()
    if kind == "dry":
        return DryRunPad()
    if kind == "x360":
        return X360Pad(invert_y=bool(invert_y) if invert_y is not None else False)
    if kind == "ds4":
        return DS4Pad(invert_y=bool(invert_y) if invert_y is not None else True)
    raise ValueError(f"unknown gamepad type {kind!r} (use x360, ds4 or dry)")
