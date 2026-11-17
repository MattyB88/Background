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
