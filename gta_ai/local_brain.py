"""Local model brain: any OpenAI-compatible server on your PC (Ollama, LM Studio, llama.cpp, vLLM).

The model MUST accept images (a vision / "VL" model). A text-only model cannot
see the game. Working examples:
  Ollama:     ollama pull qwen2.5vl:7b        url = http://localhost:11434/v1
  LM Studio:  load a Qwen2.5-VL / Qwen3-VL GGUF that includes its mmproj file
              and start the server            url = http://localhost:1234/v1

Uses only the standard library (no extra dependencies).
"""
from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.request

from .actions import PLAN_SCHEMA, Limits, Plan, parse_plan
from .brain import Decision, build_system_prompt
from .capture import Frame

log = logging.getLogger(__name__)

# Small models follow a concrete example better than a JSON schema.
JSON_INSTRUCTIONS = """
## Reply format (IMPORTANT)
Reply with ONLY one JSON object, no markdown and no extra text, exactly in this shape:
{"observation": "on foot on a beach, red car parked ahead", "goal": "steal the red car",
 "commentary": "That car is calling my name!",
 "steps": [
   {"hold": [], "tap": [], "left_stick": {"x": 0.0, "y": 1.0}, "right_stick": {"x": 0.0, "y": 0.0}, "l2": 0, "r2": 0, "duration_ms": 1200},
   {"hold": [], "tap": ["triangle"], "left_stick": {"x": 0.0, "y": 0.0}, "right_stick": {"x": 0.0, "y": 0.0}, "l2": 0, "r2": 0, "duration_ms": 300}
 ],
 "sustain": {"hold": [], "left_stick": {"x": 0.0, "y": 0.0}, "right_stick": {"x": 0.0, "y": 0.0}, "l2": 0, "r2": 0}}
Allowed button names: cross, circle, square, triangle, l1, r1, l3, r3, dpad_up, dpad_down, dpad_left, dpad_right, options, share, touchpad.
"""

_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def extract_json(text: str) -> dict:
    """Pull the plan JSON out of whatever a local model produced."""
    text = _THINK.sub("", text or "").strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in model output")
    # Walk to the matching closing brace (ignoring braces inside strings).
    depth, in_str, esc = 0, False, False
    for i, ch in enumerate(text[start:], start):
        if in_str:
            esc = (ch == "\\") and not esc
            if ch == '"' and not esc:
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("unterminated JSON object in model output")


class LocalBrain:
    def __init__(
        self,
        url: str = "http://localhost:11434/v1",
        model: str = "qwen2.5vl:7b",
        api_key: str = "local",
        temperature: float = 0.3,
        max_tokens: int = 1200,
        timeout_s: float = 90.0,
        json_mode: str = "schema",       # schema | object | none
        extra_body: dict | None = None,  # merged into every request, e.g. {"think": false}
        limits: Limits = Limits(),
        controls_path: str | None = None,
    ) -> None:
        self.endpoint = url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout_s = timeout_s
        self.json_mode = json_mode
        self.extra_body = extra_body or {}
        self.limits = limits
        self.system = build_system_prompt(controls_path) + JSON_INSTRUCTIONS

    def _response_format(self) -> dict | None:
        if self.json_mode == "schema":
            return {"type": "json_schema",
                    "json_schema": {"name": "plan", "strict": True, "schema": PLAN_SCHEMA}}
        if self.json_mode == "object":
            return {"type": "json_object"}
        return None

    def _post(self, body: dict) -> dict:
        req = urllib.request.Request(
            self.endpoint, data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"},
        )
        with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
            return json.loads(r.read().decode("utf-8"))

    def decide(self, frame: Frame, context: str) -> Decision:
        body = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "messages": [
                {"role": "system", "content": self.system},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame.b64}"}},
                    {"type": "text", "text": context + "\nReply with the JSON object only."},
                ]},
            ],
            **self.extra_body,
        }
        fmt = self._response_format()
        if fmt:
            body["response_format"] = fmt

        t0 = time.monotonic()
        try:
            resp = self._post(body)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code in (400, 422) and fmt is not None:
                # Server doesn't support this JSON mode: step down once and retry.
                self.json_mode = "object" if self.json_mode == "schema" else "none"
                log.warning("server rejected JSON mode (%s); switching to json_mode=%s", detail, self.json_mode)
                return self.decide(frame, context)
            raise RuntimeError(f"local model HTTP {e.code}: {detail}") from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"cannot reach local model at {self.endpoint}: {e.reason}. "
                               "Is Ollama / LM Studio running?") from e
        latency = time.monotonic() - t0

        try:
            text = resp["choices"][0]["message"].get("content") or ""
        except (KeyError, IndexError, TypeError):
            raise RuntimeError(f"unexpected response from local server: {str(resp)[:300]}")
        try:
            data = extract_json(text)
        except (ValueError, json.JSONDecodeError):
            log.error("could not parse local model output: %r", text[:300])
            return Decision(Plan(steps=[]), {}, latency, 0.0, self.model, "unparseable output")
        plan = parse_plan(data, self.limits)
        for w in plan.warnings:
            log.info("plan warning: %s", w)
        return Decision(plan, data, latency, 0.0, self.model)
