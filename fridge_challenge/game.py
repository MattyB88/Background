"""Game engine: plans random challenge times and runs the buzzer state machine.

Phases:
    idle      -> waiting for the next surprise challenge
    announce  -> "CHALLENGE TIME!" name + challenge shown, short get-ready countdown
    active    -> clock is running; the named person must do it and hit the buzzer
    success   -> buzzer pressed in time, points awarded
    fail      -> time ran out, everyone gets a punishment chore
"""
from __future__ import annotations

import datetime as dt
import logging
import random
import threading
import time
from typing import Callable

log = logging.getLogger(__name__)

IDLE, ANNOUNCE, ACTIVE, SUCCESS, FAIL = "idle", "announce", "active", "success", "fail"

# A planned event this late (e.g. the Pi was asleep or the clock jumped) is skipped.
STALE_EVENT_SECONDS = 300


def _parse_hhmm(value: str) -> dt.time:
    hours, minutes = value.split(":")
    return dt.time(int(hours), int(minutes))


def week_start(ts: float) -> float:
    """Epoch seconds for midnight on the Monday of the week containing ts."""
    day = dt.datetime.fromtimestamp(ts).date()
    monday = day - dt.timedelta(days=day.weekday())
    return dt.datetime.combine(monday, dt.time()).timestamp()


class Game:
    def __init__(
        self,
        config: dict,
        store,
        notifier: Callable[[dict], None] | None = None,
        now: Callable[[], float] = time.time,
        rng: random.Random | None = None,
    ):
        self.cfg = config
        self.store = store
        self.notifier = notifier
        self.now = now
        self.rng = rng or random.Random()
        self.lock = threading.RLock()
        self.phase_listeners: list[Callable[[str], None]] = []

        self.phase = IDLE
        self.phase_started = now()
        self.current: dict | None = None
        self.paused = False
        self.plan: list[float] = []
        self.plan_date: dt.date | None = None
        self.recent_members: list[str] = []
        self.recent_challenges: list[str] = []

    # ------------------------------------------------------------------ config
    @property
    def family(self) -> list[dict]:
        return self.cfg["family"]

    def _timing(self, key: str, default: float) -> float:
        return float(self.cfg.get("timing", {}).get(key, default))

    # ---------------------------------------------------------------- planning
    def _window(self, day: dt.date) -> tuple[float, float] | None:
        sched = self.cfg.get("schedule", {})
        window = sched.get("weekend" if day.weekday() >= 5 else "weekday")
        if not window:
            return None
        start = dt.datetime.combine(day, _parse_hhmm(window["start"])).timestamp()
        end = dt.datetime.combine(day, _parse_hhmm(window["end"])).timestamp()
        return (start, end) if end > start else None

    def make_plan(self, now: float) -> None:
        """Pick today's random challenge times (only those still in the future)."""
        day = dt.datetime.fromtimestamp(now).date()
        self.plan_date = day
        self.plan = []
        window = self._window(day)
        if not window:
            return
        start, end = window
        first = max(start, now + 60)  # never fire the instant the Pi boots
        if first >= end:
            return

        sched = self.cfg.get("schedule", {})
        per_day = float(sched.get("events_per_day", 3))
        gap = float(sched.get("min_gap_minutes", 30)) * 60
        # Scale by how much of today's window is left, rounding randomly so a
        # mid-day restart doesn't systematically add or drop events.
        expected = per_day * (end - first) / (end - start)
        count = int(expected + self.rng.random())

        while count > 0:
            for _ in range(200):
                times = sorted(self.rng.uniform(first, end) for _ in range(count))
                if all(b - a >= gap for a, b in zip(times, times[1:])):
                    self.plan = times
                    log.info("Planned %d challenge(s) for %s", count, day)
                    return
            count -= 1

    # --------------------------------------------------------------- selection
    def _eligible_challenges(self, member: dict) -> list[dict]:
        age = member.get("age", 99)
        out = []
        for ch in self.cfg["challenges"]:
            if not ch.get("min_age", 0) <= age <= ch.get("max_age", 200):
                continue
            if ch.get("only") and member["name"] not in ch["only"]:
                continue
            out.append(ch)
        return out

    def _pick_member(self) -> dict:
        members = [m for m in self.family if self._eligible_challenges(m)]
        if not members:
            raise RuntimeError("No family member has an eligible challenge")
        last = self.recent_members[-1] if self.recent_members else None
        weights = []
        for m in members:
            w = 1.0 / (1 + self.recent_members.count(m["name"]))
            if m["name"] == last and len(members) > 1:
                w *= 0.1
            weights.append(w)
        return self.rng.choices(members, weights=weights)[0]

    def _pick_challenge(self, member: dict) -> dict:
        options = self._eligible_challenges(member)
        fresh = [c for c in options if c["text"] not in self.recent_challenges]
        return self.rng.choice(fresh or options)

    # ------------------------------------------------------------ transitions
    def _set_phase(self, phase: str) -> None:
        self.phase = phase
        self.phase_started = self.now()
        for listener in self.phase_listeners:
            try:
                listener(phase)
            except Exception:  # hardware hiccups must never stop the game
                log.exception("Phase listener failed")

    def _start_event(self, member_name: str | None = None) -> None:
        member = None
        if member_name:
            member = next((m for m in self.family if m["name"] == member_name), None)
        if member is None:
            member = self._pick_member()
        challenge = self._pick_challenge(member)

        self.recent_members = (self.recent_members + [member["name"]])[-len(self.family) * 2 :]
        self.recent_challenges = (self.recent_challenges + [challenge["text"]])[-10:]
        self.current = {
            "member": member["name"],
            "challenge": challenge["text"].format(name=member["name"]),
            "seconds": int(challenge.get("seconds", 60)),
            "points": int(challenge.get("points", 1)),
            "started_at": self.now(),
        }
        log.info("Challenge for %s: %s", member["name"], self.current["challenge"])
        self._set_phase(ANNOUNCE)

    def _finish(self, success: bool) -> None:
        cur = self.current
        now = self.now()
        cur["reaction_seconds"] = round(now - cur["active_at"], 1)
        cur["success"] = success
        cur["punishment"] = None if success else self.rng.choice(self.cfg["punishments"])
        cur["event_id"] = self.store.record_event(
            started_at=cur["started_at"],
            member=cur["member"],
            challenge=cur["challenge"],
            success=success,
            reaction_seconds=cur["reaction_seconds"],
            points=cur["points"] if success else 0,
            punishment=cur["punishment"],
        )
        self._set_phase(SUCCESS if success else FAIL)
        if self.notifier:
            self.notifier(
                {
                    "type": "challenge_result",
                    "event_id": cur["event_id"],
                    "member": cur["member"],
                    "challenge": cur["challenge"],
                    "success": success,
                    "reaction_seconds": cur["reaction_seconds"],
                    "points": cur["points"] if success else 0,
                    "punishment": cur["punishment"],
                    "assigned_to": [] if success else [m["name"] for m in self.family],
                    "timestamp": dt.datetime.fromtimestamp(now).isoformat(timespec="seconds"),
                }
            )

    # ------------------------------------------------------------- public API
    def tick(self) -> None:
        with self.lock:
            now = self.now()
            if self.plan_date != dt.datetime.fromtimestamp(now).date():
                self.make_plan(now)
            elapsed = now - self.phase_started

            if self.phase == IDLE:
                if self.plan and now >= self.plan[0]:
                    due = self.plan.pop(0)
                    if self.paused:
                        log.info("Paused - skipping planned challenge")
                    elif now - due > STALE_EVENT_SECONDS:
                        log.info("Skipping stale planned challenge")
                    else:
                        self._start_event()
            elif self.phase == ANNOUNCE:
                if elapsed >= self._timing("announce_seconds", 8):
                    self.current["active_at"] = now
                    self.current["deadline"] = now + self.current["seconds"]
                    self._set_phase(ACTIVE)
            elif self.phase == ACTIVE:
                if now >= self.current["deadline"]:
                    self._finish(success=False)
            elif elapsed >= self._timing("result_seconds", 20):
                self.current = None
                self._set_phase(IDLE)

    def press(self) -> bool:
        """The big buzzer was pressed. Only counts while a challenge is running."""
        with self.lock:
            if self.phase != ACTIVE:
                return False
            self._finish(success=True)
            return True

    def trigger_now(self, member_name: str | None = None) -> bool:
        with self.lock:
            if self.phase != IDLE:
                return False
            self._start_event(member_name)
            return True

    def cancel(self) -> bool:
        """Abort the running challenge without recording a result."""
        with self.lock:
            if self.phase not in (ANNOUNCE, ACTIVE):
                return False
            self.current = None
            self._set_phase(IDLE)
            return True

    def set_paused(self, paused: bool) -> None:
        with self.lock:
            self.paused = paused

    def run_forever(self, interval: float = 0.2, stop: threading.Event | None = None) -> None:
        stop = stop or threading.Event()
        while not stop.is_set():
            try:
                self.tick()
            except Exception:
                log.exception("Game tick failed")
            stop.wait(interval)

    def state(self) -> dict:
        """Snapshot for the fridge display."""
        with self.lock:
            now = self.now()
            out = {
                "phase": self.phase,
                "paused": self.paused,
                "events_left_today": 0 if self.paused else len(self.plan),
                "leaderboard": self.store.leaderboard(
                    [m["name"] for m in self.family], since=week_start(now)
                ),
                "chores_owed": len(self.store.pending_punishments()),
                "allow_screen_press": bool(self.cfg.get("display", {}).get("allow_screen_press")),
            }
            cur = self.current
            if cur:
                out.update(
                    member=cur["member"],
                    challenge=cur["challenge"],
                    time_limit=cur["seconds"],
                    points=cur["points"],
                )
                if self.phase == ANNOUNCE:
                    out["seconds_left"] = max(
                        0.0, self._timing("announce_seconds", 8) - (now - self.phase_started)
                    )
                elif self.phase == ACTIVE:
                    out["seconds_left"] = max(0.0, cur["deadline"] - now)
                else:
                    out.update(
                        success=cur["success"],
                        reaction_seconds=cur["reaction_seconds"],
                        punishment=cur["punishment"],
                    )
            return out

    def admin_summary(self) -> dict:
        with self.lock:
            fmt = lambda t: dt.datetime.fromtimestamp(t).strftime("%H:%M")  # noqa: E731
            return {
                "state": self.state(),
                "planned_today": [fmt(t) for t in self.plan],
                "family": [m["name"] for m in self.family],
                "recent_events": self.store.recent_events(25),
                "pending_punishments": self.store.pending_punishments(),
            }
