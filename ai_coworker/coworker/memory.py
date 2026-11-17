"""Shared team memory in a single SQLite file: meeting notes, production issues and actions."""
import datetime as dt
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY, created_at TEXT, author TEXT, channel TEXT,
    title TEXT, body TEXT, tags TEXT);
CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY, created_at TEXT, raised_by TEXT, title TEXT, details TEXT,
    severity TEXT, item_code TEXT, status TEXT DEFAULT 'open', closed_at TEXT);
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY, created_at TEXT, created_by TEXT, description TEXT, owner TEXT,
    due TEXT, issue_id INTEGER REFERENCES issues(id), status TEXT DEFAULT 'open', closed_at TEXT);
"""


def _now():
    return dt.datetime.now().isoformat(timespec="seconds")


class Memory:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def _all(self, sql, *args):
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def _insert(self, sql, *args) -> int:
        cur = self.db.execute(sql, args)
        self.db.commit()
        return cur.lastrowid

    # notes
    def save_note(self, title, body, tags="", author="", channel=""):
        nid = self._insert(
            "INSERT INTO notes(created_at,author,channel,title,body,tags) VALUES(?,?,?,?,?,?)",
            _now(), author, channel, title, body, tags,
        )
        return {"note_id": nid}

    def search_notes(self, query="", limit=8):
        words = [w for w in query.lower().split() if len(w) > 2]
        if not words:
            return self._all("SELECT * FROM notes ORDER BY id DESC LIMIT ?", limit)
        where = " OR ".join(["lower(title||' '||body||' '||tags) LIKE ?"] * len(words))
        return self._all(f"SELECT * FROM notes WHERE {where} ORDER BY id DESC LIMIT ?", *[f"%{w}%" for w in words], limit)

    # issues
    def log_issue(self, title, details="", severity="medium", item_code="", raised_by=""):
        iid = self._insert(
            "INSERT INTO issues(created_at,raised_by,title,details,severity,item_code) VALUES(?,?,?,?,?,?)",
            _now(), raised_by, title, details, severity, item_code.upper(),
        )
        return {"issue_id": iid}

    def list_issues(self, status="open"):
        if status == "all":
            return self._all("SELECT * FROM issues ORDER BY id DESC LIMIT 50")
        return self._all("SELECT * FROM issues WHERE status=? ORDER BY id DESC LIMIT 50", status)

    def close_issue(self, issue_id):
        self.db.execute("UPDATE issues SET status='closed', closed_at=? WHERE id=?", (_now(), issue_id))
        self.db.commit()
        return {"issue_id": issue_id, "status": "closed"}

    # actions
    def add_action(self, description, owner="", due="", issue_id=None, created_by=""):
        aid = self._insert(
            "INSERT INTO actions(created_at,created_by,description,owner,due,issue_id) VALUES(?,?,?,?,?,?)",
            _now(), created_by, description, owner, due, issue_id,
        )
        return {"action_id": aid}

    def list_actions(self, status="open", owner=""):
        sql, args = "SELECT * FROM actions WHERE 1=1", []
        if status != "all":
            sql += " AND status=?"
            args.append(status)
        if owner:
            sql += " AND lower(owner) LIKE ?"
            args.append(f"%{owner.lower()}%")
        return self._all(sql + " ORDER BY COALESCE(NULLIF(due,''),'9999'), id LIMIT 50", *args)

    def update_action(self, action_id, status):
        closed = _now() if status in ("done", "cancelled") else None
        self.db.execute("UPDATE actions SET status=?, closed_at=? WHERE id=?", (status, closed, action_id))
        self.db.commit()
        return {"action_id": action_id, "status": status}

    def overdue_actions(self, today: dt.date | None = None):
        today = (today or dt.date.today()).isoformat()
        return self._all("SELECT * FROM actions WHERE status='open' AND due<>'' AND due<? ORDER BY due", today)
