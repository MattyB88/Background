"""SQLite history of challenges, points and owed chores."""
from __future__ import annotations

import datetime as dt
import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at REAL NOT NULL,
    member TEXT NOT NULL,
    challenge TEXT NOT NULL,
    success INTEGER NOT NULL,
    reaction_seconds REAL,
    points INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS punishments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id),
    text TEXT NOT NULL,
    created_at REAL NOT NULL,
    done_at REAL
);
"""


def _fmt(ts: float | None) -> str | None:
    return dt.datetime.fromtimestamp(ts).strftime("%a %d %b %H:%M") if ts else None


class Store:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.executescript(SCHEMA)

    def record_event(self, *, started_at, member, challenge, success, reaction_seconds, points, punishment):
        with self.lock, self.db:
            cur = self.db.execute(
                "INSERT INTO events (started_at, member, challenge, success, reaction_seconds, points)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (started_at, member, challenge, int(success), reaction_seconds, points),
            )
            event_id = cur.lastrowid
            if punishment:
                self.db.execute(
                    "INSERT INTO punishments (event_id, text, created_at) VALUES (?, ?, ?)",
                    (event_id, punishment, time.time()),
                )
            return event_id

    def leaderboard(self, members: list[str], since: float = 0) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT member, SUM(points) AS points, SUM(success) AS wins,"
                " SUM(1 - success) AS misses FROM events WHERE started_at >= ? GROUP BY member",
                (since,),
            ).fetchall()
        stats = {r["member"]: dict(r) for r in rows}
        board = [
            {
                "name": name,
                "points": stats.get(name, {}).get("points") or 0,
                "wins": stats.get(name, {}).get("wins") or 0,
                "misses": stats.get(name, {}).get("misses") or 0,
            }
            for name in members
        ]
        return sorted(board, key=lambda r: (-r["points"], r["misses"], r["name"]))

    def recent_events(self, limit: int = 20) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT e.*, p.text AS punishment FROM events e"
                " LEFT JOIN punishments p ON p.event_id = e.id"
                " ORDER BY e.started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r, when=_fmt(r["started_at"]), success=bool(r["success"])) for r in rows]

    def pending_punishments(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT p.id, p.text, p.created_at, e.member AS missed_by FROM punishments p"
                " JOIN events e ON e.id = p.event_id WHERE p.done_at IS NULL ORDER BY p.created_at"
            ).fetchall()
        return [dict(r, when=_fmt(r["created_at"])) for r in rows]

    def complete_punishment(self, punishment_id: int) -> bool:
        with self.lock, self.db:
            cur = self.db.execute(
                "UPDATE punishments SET done_at = ? WHERE id = ? AND done_at IS NULL",
                (time.time(), punishment_id),
            )
            return cur.rowcount > 0
