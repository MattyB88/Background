"""Controller state + the plan format Claude returns, with validation/clamping.

Conventions (independent of the virtual pad backend):
  * sticks are floats in [-1, 1]; +x = right, +y = UP / forward
  * triggers (l2/r2) are floats in [0, 1]
  * buttons use PlayStation names
"""
from __future__ import annotations

from dataclasses import dataclass, field

BUTTONS: tuple[str, ...] = (
    "cross", "circle", "square", "triangle",
    "l1", "r1", "l3", "r3",
    "dpad_up", "dpad_down", "dpad_left", "dpad_right",
    "options", "share", "touchpad",
)


def _clamp(v: object, lo: float, hi: float) -> float:
    try:
        f = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    if f != f:  # NaN
        return 0.0
    return max(lo, min(hi, f))


@dataclass(frozen=True)
class PadState:
    buttons: frozenset[str] = frozenset()
    lx: float = 0.0
    ly: float = 0.0
    rx: float = 0.0
    ry: float = 0.0
    l2: float = 0.0
    r2: float = 0.0

    def with_buttons(self, extra: frozenset[str]) -> "PadState":
        if not extra:
            return self
        return PadState(self.buttons | extra, self.lx, self.ly, self.rx, self.ry, self.l2, self.r2)

    def describe(self) -> str:
        parts = []
        if self.buttons:
            parts.append("+".join(sorted(self.buttons)))
        if abs(self.lx) > 0.05 or abs(self.ly) > 0.05:
            parts.append(f"L({self.lx:+.2f},{self.ly:+.2f})")
        if abs(self.rx) > 0.05 or abs(self.ry) > 0.05:
            parts.append(f"R({self.rx:+.2f},{self.ry:+.2f})")
        if self.l2 > 0.05:
            parts.append(f"L2={self.l2:.2f}")
        if self.r2 > 0.05:
            parts.append(f"R2={self.r2:.2f}")
        return " ".join(parts) or "neutral"


NEUTRAL = PadState()


@dataclass(frozen=True)
class Step:
    state: PadState
    tap: frozenset[str]
    duration_ms: int


@dataclass
class Plan:
    steps: list[Step]
    sustain: PadState = NEUTRAL
    observation: str = ""
    commentary: str = ""
    goal: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def total_ms(self) -> int:
        return sum(s.duration_ms for s in self.steps)

    def describe(self) -> str:
        steps = "; ".join(
            f"{s.state.with_buttons(s.tap).describe()} {s.duration_ms}ms" for s in self.steps
        )
        return f"[{steps}] then sustain {self.sustain.describe()}"


@dataclass(frozen=True)
class Limits:
    max_steps: int = 8
    max_step_ms: int = 4000
    max_plan_ms: int = 8000
    tap_ms: int = 100
    blocked_buttons: frozenset[str] = frozenset()


def _buttons(raw: object, limits: Limits, warnings: list[str]) -> frozenset[str]:
    out = set()
    for b in raw or []:  # type: ignore[union-attr]
        name = str(b).strip().lower()
        if name not in BUTTONS:
            warnings.append(f"unknown button {name!r} dropped")
            continue
        if name in limits.blocked_buttons:
            warnings.append(f"blocked button {name!r} dropped")
            continue
        out.add(name)
    return frozenset(out)


def _state(raw: dict, limits: Limits, warnings: list[str]) -> PadState:
    ls = raw.get("left_stick") or {}
    rs = raw.get("right_stick") or {}
    return PadState(
        buttons=_buttons(raw.get("hold"), limits, warnings),
        lx=_clamp(ls.get("x", 0), -1, 1),
        ly=_clamp(ls.get("y", 0), -1, 1),
        rx=_clamp(rs.get("x", 0), -1, 1),
        ry=_clamp(rs.get("y", 0), -1, 1),
        l2=_clamp(raw.get("l2", 0), 0, 1),
        r2=_clamp(raw.get("r2", 0), 0, 1),
    )


def parse_plan(data: dict, limits: Limits = Limits()) -> Plan:
    """Turn Claude's JSON into a safe, clamped Plan. Never raises on bad values."""
    warnings: list[str] = []
    steps: list[Step] = []
    budget = limits.max_plan_ms
    raw_steps = data.get("steps") or []
    if len(raw_steps) > limits.max_steps:
        warnings.append(f"{len(raw_steps)} steps truncated to {limits.max_steps}")
    for raw in raw_steps[: limits.max_steps]:
        if not isinstance(raw, dict) or budget <= 0:
            continue
        state = _state(raw, limits, warnings)
        tap = _buttons(raw.get("tap"), limits, warnings) - state.buttons
        dur = int(_clamp(raw.get("duration_ms", 200), 0, limits.max_step_ms))
        if tap:
            # leave a release gap so consecutive taps register as separate presses
            dur = max(dur, limits.tap_ms + 60)
        dur = min(dur, budget)
        if dur <= 0:
            continue
        budget -= dur
        steps.append(Step(state=state, tap=tap, duration_ms=dur))

    sustain_raw = data.get("sustain")
    sustain = _state(sustain_raw, limits, warnings) if isinstance(sustain_raw, dict) else NEUTRAL

    return Plan(
        steps=steps,
        sustain=sustain,
        observation=str(data.get("observation", ""))[:600],
        commentary=str(data.get("commentary", ""))[:400],
        goal=str(data.get("goal", ""))[:200],
        warnings=warnings,
    )


# JSON schema handed to Claude via structured outputs (output_config.format).
_STICK = {
    "type": "object",
    "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
    "required": ["x", "y"],
    "additionalProperties": False,
}
_BUTTON_LIST = {"type": "array", "items": {"type": "string", "enum": list(BUTTONS)}}

_STATE_PROPS = {
    "hold": _BUTTON_LIST,
    "left_stick": _STICK,
    "right_stick": _STICK,
    "l2": {"type": "number"},
    "r2": {"type": "number"},
}

PLAN_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "observation": {"type": "string"},
        "goal": {"type": "string"},
        "commentary": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    **_STATE_PROPS,
                    "tap": _BUTTON_LIST,
                    "duration_ms": {"type": "integer"},
                },
                "required": ["hold", "tap", "left_stick", "right_stick", "l2", "r2", "duration_ms"],
                "additionalProperties": False,
            },
        },
        "sustain": {
            "type": "object",
            "properties": _STATE_PROPS,
            "required": ["hold", "left_stick", "right_stick", "l2", "r2"],
            "additionalProperties": False,
        },
    },
    "required": ["observation", "goal", "commentary", "steps", "sustain"],
    "additionalProperties": False,
}
