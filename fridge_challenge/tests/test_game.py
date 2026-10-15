import datetime as dt
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from game import ACTIVE, ANNOUNCE, FAIL, IDLE, SUCCESS, Game  # noqa: E402
from storage import Store  # noqa: E402


class Clock:
    def __init__(self, start: dt.datetime):
        self.t = start.timestamp()

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


CONFIG = {
    "family": [{"name": "Dad", "age": 40}, {"name": "Ella", "age": 7}],
    "schedule": {
        "events_per_day": 3,
        "min_gap_minutes": 30,
        "weekday": {"start": "16:00", "end": "19:00"},
        "weekend": {"start": "09:00", "end": "19:00"},
    },
    "timing": {"announce_seconds": 5, "result_seconds": 10},
    "challenges": [
        {"text": "Star jumps, {name}!", "seconds": 30, "points": 2},
        {"text": "Burpees", "seconds": 30, "min_age": 12},
    ],
    "punishments": ["Everyone unloads the dishwasher"],
}

# A Wednesday, before the weekday window opens.
MORNING = dt.datetime(2026, 10, 14, 8, 0)


@pytest.fixture
def make_game(tmp_path):
    def _make(start=MORNING, notifier=None):
        clock = Clock(start)
        game = Game(CONFIG, Store(str(tmp_path / "t.sqlite3")), notifier=notifier, now=clock, rng=random.Random(1))
        return game, clock

    return _make


def run_to_active(game, clock, member=None):
    game.tick()
    assert game.trigger_now(member)
    assert game.phase == ANNOUNCE
    clock.advance(5)
    game.tick()
    assert game.phase == ACTIVE


def test_plan_falls_inside_window_with_gap(make_game):
    for seed in range(20):
        game, clock = make_game()
        game.rng = random.Random(seed)
        game.tick()
        assert len(game.plan) == 3
        start = dt.datetime(2026, 10, 14, 16, 0).timestamp()
        end = dt.datetime(2026, 10, 14, 19, 0).timestamp()
        assert all(start <= t <= end for t in game.plan)
        assert all(b - a >= 30 * 60 for a, b in zip(game.plan, game.plan[1:]))


def test_no_plan_after_window(make_game):
    game, _ = make_game(start=dt.datetime(2026, 10, 14, 20, 0))
    game.tick()
    assert game.plan == []


def test_planned_event_fires(make_game):
    game, clock = make_game()
    game.tick()
    clock.t = game.plan[0]
    game.tick()
    assert game.phase == ANNOUNCE
    assert len(game.plan) == 2


def test_press_in_time_awards_points(make_game):
    sent = []
    game, clock = make_game(notifier=sent.append)
    run_to_active(game, clock, "Dad")
    assert game.press() is True
    assert game.phase == SUCCESS
    assert game.current["challenge"] in ("Star jumps, Dad!", "Burpees")
    board = {r["name"]: r for r in game.store.leaderboard(["Dad", "Ella"])}
    assert board["Dad"]["wins"] == 1
    assert sent[0]["success"] is True and sent[0]["assigned_to"] == []


def test_press_outside_active_is_ignored(make_game):
    game, clock = make_game()
    game.tick()
    assert game.press() is False
    game.trigger_now()
    assert game.press() is False  # no cheating during the announce countdown
    assert game.phase == ANNOUNCE


def test_timeout_punishes_everyone(make_game):
    sent = []
    game, clock = make_game(notifier=sent.append)
    run_to_active(game, clock, "Ella")
    clock.advance(31)
    game.tick()
    assert game.phase == FAIL
    assert game.state()["punishment"] == "Everyone unloads the dishwasher"
    assert len(game.store.pending_punishments()) == 1
    assert sent[0]["assigned_to"] == ["Dad", "Ella"]
    clock.advance(10)
    game.tick()
    assert game.phase == IDLE


def test_age_filter(make_game):
    game, clock = make_game()
    for _ in range(20):
        game.tick()
        game.trigger_now("Ella")
        assert game.current["challenge"] == "Star jumps, Ella!"
        game.cancel()


def test_paused_skips_planned_event(make_game):
    game, clock = make_game()
    game.tick()
    game.set_paused(True)
    clock.t = game.plan[0]
    game.tick()
    assert game.phase == IDLE


def test_complete_punishment(make_game):
    game, clock = make_game()
    run_to_active(game, clock)
    clock.advance(60)
    game.tick()
    pid = game.store.pending_punishments()[0]["id"]
    assert game.store.complete_punishment(pid)
    assert game.store.pending_punishments() == []
