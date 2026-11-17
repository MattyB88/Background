"""Decision makers: ClaudeBrain (vision -> plan) and MockBrain (no API, for testing)."""
from __future__ import annotations

import json
import logging
import math
import random
import time
from dataclasses import dataclass
from pathlib import Path

from .actions import PLAN_SCHEMA, Limits, Plan, parse_plan
from .capture import Frame

log = logging.getLogger(__name__)
PROMPTS = Path(__file__).parent / "prompts"


@dataclass
class Decision:
    plan: Plan
    raw: dict
    latency_s: float
    cost_usd: float = 0.0
    model: str = ""
    note: str = ""


def build_system_prompt(controls_path: str | None = None) -> str:
    controls = Path(controls_path) if controls_path else PROMPTS / "controls.md"
    return (PROMPTS / "system.md").read_text(encoding="utf-8").replace(
        "{controls}", controls.read_text(encoding="utf-8")
    )


class ClaudeBrain:
    FALLBACK_BETA = "server-side-fallback-2026-07-01"

    def __init__(
        self,
        model: str = "claude-opus-5-5",
        effort: str = "low",
        max_tokens: int = 6000,
        fast_mode: bool = False,
        use_fallbacks: bool = True,
        price_in_per_mtok: float = 4.0,
        price_out_per_mtok: float = 20.0,
        limits: Limits = Limits(),
        controls_path: str | None = None,
        timeout_s: float = 30.0,
    ) -> None:
        import anthropic

        self.anthropic = anthropic
        # Credentials: ANTHROPIC_API_KEY env var (or an `ant auth login` profile).
        self.client = anthropic.Anthropic(timeout=timeout_s, max_retries=1)
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.fast_mode = fast_mode
        self.use_fallbacks = use_fallbacks
        self.price_in = price_in_per_mtok
        self.price_out = price_out_per_mtok
        self.limits = limits
        self.system = [{
            "type": "text",
            "text": build_system_prompt(controls_path),
            "cache_control": {"type": "ephemeral"},
        }]

    def _request(self, content: list) -> object:
        kwargs: dict = dict(
            model=self.model,
            max_tokens=self.max_tokens,
            system=self.system,
            messages=[{"role": "user", "content": content}],
            output_config={
                "effort": self.effort,
                "format": {"type": "json_schema", "schema": PLAN_SCHEMA},
            },
        )
        if self.fast_mode:
            kwargs["speed"] = "fast"
        if self.use_fallbacks:
            # If a safety classifier declines (GTA is violent), the API re-runs the
            # request on a fallback model instead of returning nothing.
            return self.client.beta.messages.create(
                betas=[self.FALLBACK_BETA], fallbacks="default", **kwargs
            )
        return self.client.messages.create(**kwargs)

    def _cost(self, usage) -> float:
        if usage is None:
            return 0.0
        inp = (getattr(usage, "input_tokens", 0) or 0)
        inp += 1.25 * (getattr(usage, "cache_creation_input_tokens", 0) or 0)
        inp += 0.1 * (getattr(usage, "cache_read_input_tokens", 0) or 0)
        out = getattr(usage, "output_tokens", 0) or 0
        return (inp * self.price_in + out * self.price_out) / 1_000_000

    def decide(self, frame: Frame, context: str) -> Decision:
        content = [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": frame.b64}},
            {"type": "text", "text": context},
        ]
        t0 = time.monotonic()
        try:
            resp = self._request(content)
        except self.anthropic.BadRequestError as e:
            if not (self.use_fallbacks or self.fast_mode):
                raise
            # Never die on stream night because an optional feature was rejected.
            log.warning("request rejected (%s); retrying without fallbacks/fast mode", e.message)
            self.use_fallbacks = False
            self.fast_mode = False
            resp = self._request(content)
        latency = time.monotonic() - t0
        cost = self._cost(getattr(resp, "usage", None))
        model = getattr(resp, "model", self.model)

        if resp.stop_reason == "refusal":
            details = getattr(resp, "stop_details", None)
            note = f"refused ({getattr(details, 'category', None)})"
            log.warning("model %s: %s", note, getattr(details, "explanation", ""))
            return Decision(Plan(steps=[], commentary="(the AI declined that one - standing still)"),
                            {}, latency, cost, model, note)
        if resp.stop_reason == "max_tokens":
            log.warning("hit max_tokens; raise brain.max_tokens")

        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            log.error("could not parse model output: %r", text[:300])
            return Decision(Plan(steps=[]), {}, latency, cost, model, "unparseable output")
        plan = parse_plan(data, self.limits)
        for w in plan.warnings:
            log.info("plan warning: %s", w)
        return Decision(plan, data, latency, cost, model)


class MockBrain:
    """Scripted wandering. Tests the full capture -> pad pipeline at zero cost."""

    def __init__(self, limits: Limits = Limits(), think_s: float = 1.0, seed: int | None = None) -> None:
        self.limits = limits
        self.think_s = think_s
        self.rng = random.Random(seed)
        self.n = 0

    def decide(self, frame: Frame, context: str) -> Decision:
        time.sleep(self.think_s)
        self.n += 1
        ang = self.rng.uniform(-math.pi, math.pi)
        data = {
            "observation": f"mock frame {frame.source_size}, brightness {frame.mean_brightness:.0f}",
            "goal": "wander around (mock brain)",
            "commentary": f"Mock turn {self.n}: wandering at {math.degrees(ang):.0f} degrees.",
            "steps": [
                {"hold": [], "tap": [], "left_stick": {"x": 0, "y": 0},
                 "right_stick": {"x": round(math.sin(ang), 2), "y": 0}, "l2": 0, "r2": 0, "duration_ms": 300},
                {"hold": ["cross"] if self.n % 3 == 0 else [], "tap": ["square"] if self.n % 5 == 0 else [],
                 "left_stick": {"x": 0, "y": 1}, "right_stick": {"x": 0, "y": 0}, "l2": 0, "r2": 0,
                 "duration_ms": 1200},
            ],
            "sustain": {"hold": [], "left_stick": {"x": 0, "y": 0}, "right_stick": {"x": 0, "y": 0},
                        "l2": 0, "r2": 0},
        }
        return Decision(parse_plan(data, self.limits), data, self.think_s, 0.0, "mock")
