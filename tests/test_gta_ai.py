import json
import threading
import time
import urllib.request

from PIL import Image

from gta_ai.actions import NEUTRAL, PLAN_SCHEMA, Limits, PadState, parse_plan
from gta_ai.app import build_context
from gta_ai.brain import MockBrain, build_system_prompt
from gta_ai.capture import Capturer
from gta_ai.executor import Executor
from gta_ai.gamepad import DryRunPad
from gta_ai.overlay import LiveState, start_server


def _step(**kw):
    base = {"hold": [], "tap": [], "left_stick": {"x": 0, "y": 0}, "right_stick": {"x": 0, "y": 0},
            "l2": 0, "r2": 0, "duration_ms": 500}
    base.update(kw)
    return base


def test_parse_plan_clamps_and_filters():
    data = {
        "observation": "o", "goal": "g", "commentary": "c",
        "steps": [_step(hold=["cross", "ps_button"], left_stick={"x": 5, "y": -9}, r2=3, duration_ms=99999),
                  _step(tap=["options"], duration_ms=10)],
        "sustain": {"hold": [], "left_stick": {"x": 0, "y": 0}, "right_stick": {"x": 0, "y": 0},
                    "l2": 0, "r2": 0.5},
    }
    plan = parse_plan(data, Limits(max_step_ms=2000, blocked_buttons=frozenset({"options"})))
    s0 = plan.steps[0]
    assert s0.state.buttons == {"cross"}
    assert (s0.state.lx, s0.state.ly, s0.state.r2) == (1.0, -1.0, 1.0)
    assert s0.duration_ms == 2000
    # blocked tap is dropped; step is kept but has no tap
    assert plan.steps[1].tap == frozenset()
    assert plan.sustain.r2 == 0.5
    assert any("ps_button" in w for w in plan.warnings)


def test_parse_plan_total_budget_and_tap_min_duration():
    steps = [_step(tap=["cross"], duration_ms=20) for _ in range(20)]
    plan = parse_plan({"steps": steps}, Limits(max_steps=8, max_plan_ms=1000, tap_ms=100))
    assert len(plan.steps) <= 8
    assert plan.total_ms <= 1000
    assert all(s.duration_ms >= 160 or s is plan.steps[-1] for s in plan.steps)


def test_parse_plan_garbage_is_safe():
    plan = parse_plan({"steps": ["nope", {"duration_ms": "abc"}], "sustain": "x"})
    assert plan.sustain == NEUTRAL


def test_executor_timeline():
    now = [0.0]
    ex = Executor(DryRunPad(verbose=False), tap_ms=100, sustain_timeout_s=2.0, clock=lambda: now[0])
    plan = parse_plan({
        "steps": [_step(tap=["cross"], left_stick={"x": 0, "y": 1}, duration_ms=500),
                  _step(hold=["r1"], duration_ms=300)],
        "sustain": {"hold": [], "left_stick": {"x": 0, "y": 0}, "right_stick": {"x": 0, "y": 0},
                    "l2": 0, "r2": 0.4},
    })
    ex.submit(plan)
    assert ex.desired_state(0.05).buttons == {"cross"}        # tap active
    assert ex.desired_state(0.2).buttons == frozenset()        # tap released
    assert ex.desired_state(0.2).ly == 1.0
    assert ex.desired_state(0.6).buttons == {"r1"}
    assert ex.desired_state(1.0).r2 == 0.4                     # sustain
    assert ex.desired_state(3.0) == NEUTRAL                    # dead-man timeout
    now[0] = 0.3
    assert abs(ex.remaining_ms() - 500) < 1


def test_executor_pause_releases_pad():
    pad = DryRunPad(verbose=False)
    ex = Executor(pad, tick_hz=200)
    ex.start()
    ex.submit(parse_plan({"steps": [_step(hold=["cross"], duration_ms=2000)]}))
    time.sleep(0.05)
    assert pad.history[-1][1].buttons == {"cross"}
    ex.set_paused(True)
    time.sleep(0.05)
    assert pad.history[-1][1] == NEUTRAL
    ex.stop()


def test_capture_file_and_mock_brain(tmp_path):
    p = tmp_path / "f.png"
    Image.new("RGB", (1920, 1080), (40, 90, 160)).save(p)
    frame = Capturer(f"file:{p}", max_width=1280).grab()
    assert frame.image.size == (1280, 720)
    d = MockBrain(think_s=0, seed=1).decide(frame, "ctx")
    assert d.plan.steps and d.plan.commentary


def test_prompt_and_schema():
    sp = build_system_prompt()
    assert "{controls}" not in sp and "cheat sheet" in sp
    assert PLAN_SCHEMA["additionalProperties"] is False
    json.dumps(PLAN_SCHEMA)
    ctx = build_context("m", [], ["go left"], 3, 12)
    assert "go left" in ctx and "paused" in ctx


def test_overlay_server(tmp_path):
    state = LiveState(str(tmp_path / "c.txt"))
    flag = {"p": False}

    def toggle():
        flag["p"] = not flag["p"]
        return flag["p"]

    srv = start_server(state, "127.0.0.1", 0, toggle)
    port = srv.server_address[1]
    try:
        state.update(commentary="hello")
        s = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/state"))
        assert s["commentary"] == "hello"
        urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/note", data=b"steal a car"))
        assert state.take_notes() == ["steal a car"]
        r = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/pause", data=b"")))
        assert r["paused"] is True
        assert (tmp_path / "c.txt").read_text() == "hello"
    finally:
        srv.shutdown()


# ---- local model brain (OpenAI-compatible: Ollama / LM Studio) ----
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402

from gta_ai.local_brain import LocalBrain, extract_json  # noqa: E402

_PLAN = {"observation": "beach", "goal": "car", "commentary": "vroom",
         "steps": [_step(tap=["triangle"], duration_ms=300)],
         "sustain": {"hold": [], "left_stick": {"x": 0, "y": 0}, "right_stick": {"x": 0, "y": 0},
                     "l2": 0, "r2": 0}}


def _fake_openai(reject_schema: bool, reply: str):
    seen = []

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(body)
            fmt = (body.get("response_format") or {}).get("type")
            if reject_schema and fmt == "json_schema":
                raw, code = b'{"error":"response_format json_schema not supported"}', 400
            else:
                raw, code = json.dumps({"choices": [{"message": {"role": "assistant", "content": reply}}]}).encode(), 200
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen


def _frame(tmp_path):
    p = tmp_path / "f.png"
    Image.new("RGB", (640, 360), (10, 200, 10)).save(p)
    return Capturer(f"file:{p}").grab()


def test_extract_json_variants():
    assert extract_json(json.dumps(_PLAN))["goal"] == "car"
    messy = "<think>hmm {not json}</think>Sure!\n```json\n" + json.dumps(_PLAN) + "\n```"
    assert extract_json(messy)["commentary"] == "vroom"
    chatty = 'Here you go: ' + json.dumps(_PLAN) + ' hope that helps {'
    assert extract_json(chatty)["observation"] == "beach"


def test_local_brain_happy_path(tmp_path):
    srv, seen = _fake_openai(False, json.dumps(_PLAN))
    try:
        b = LocalBrain(url=f"http://127.0.0.1:{srv.server_address[1]}/v1", model="qwen2.5vl:7b",
                       extra_body={"think": False})
        d = b.decide(_frame(tmp_path), "ctx")
    finally:
        srv.shutdown()
    assert d.plan.steps[0].tap == {"triangle"} and d.cost_usd == 0.0
    req = seen[0]
    assert req["model"] == "qwen2.5vl:7b" and req["think"] is False
    assert req["response_format"]["type"] == "json_schema"
    assert req["messages"][1]["content"][0]["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_local_brain_steps_down_json_mode(tmp_path):
    srv, seen = _fake_openai(True, "<think>x</think>" + json.dumps(_PLAN))
    try:
        b = LocalBrain(url=f"http://127.0.0.1:{srv.server_address[1]}/v1")
        d = b.decide(_frame(tmp_path), "ctx")
    finally:
        srv.shutdown()
    assert b.json_mode == "object" and len(seen) == 2
    assert d.plan.commentary == "vroom"
