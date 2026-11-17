"""Tools the LLM can call. Each has a JSON schema (what the model sees) and a Python function (what runs)."""
import json
from dataclasses import asdict

from . import insights, planning
from .erp import ErpBackend
from .memory import Memory


def _fn(name, description, properties=None, required=None):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties or {}, "required": required or []},
        },
    }


ITEM = {"type": "string", "description": "Item/part code, e.g. CCA53"}

SCHEMAS = [
    _fn("find_items", "Search items by code or description. Use when unsure of an exact code.",
        {"query": {"type": "string"}}, ["query"]),
    _fn("stock_on_hand", "Current stock for an item: on hand, allocated, available, on order.",
        {"item_code": ITEM}, ["item_code"]),
    _fn("usage", "How many of an item were used (issued) over the last N days, with monthly average.",
        {"item_code": ITEM, "days": {"type": "integer", "default": 365}}, ["item_code"]),
    _fn("bom", "Bill of materials for a manufactured item, optionally multi-level and multiplied by a quantity.",
        {"item_code": ITEM, "qty": {"type": "number", "default": 1}, "multi_level": {"type": "boolean", "default": True}},
        ["item_code"]),
    _fn("check_builds",
        "Check whether there is enough stock for one or more builds, processed IN ORDER (earlier builds consume "
        "stock first). Returns shortages and the max buildable quantity for each. Use for any 'can I build' / "
        "'will I have enough' question.",
        {"builds": {"type": "array", "items": {"type": "object", "properties": {
            "item": {"type": "string"}, "qty": {"type": "number"}}, "required": ["item", "qty"]}},
         "include_on_order": {"type": "boolean", "default": False,
                              "description": "Count open purchase orders as available"}},
        ["builds"]),
    _fn("stock_risks", "List bought-in items at risk of running out (days of cover vs lead time, below minimum)."),
    _fn("save_note", "Save meeting notes, decisions or anything the team asks you to remember.",
        {"title": {"type": "string"}, "body": {"type": "string"},
         "tags": {"type": "string", "description": "comma separated, e.g. 'meeting,production,CAS123'"}},
        ["title", "body"]),
    _fn("search_notes", "Search saved meeting notes / remembered info by keywords.",
        {"query": {"type": "string"}}, ["query"]),
    _fn("log_issue", "Log a production issue.",
        {"title": {"type": "string"}, "details": {"type": "string"},
         "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]}, "item_code": ITEM},
        ["title"]),
    _fn("list_issues", "List production issues.",
        {"status": {"type": "string", "enum": ["open", "closed", "all"], "default": "open"}}),
    _fn("close_issue", "Close a production issue.", {"issue_id": {"type": "integer"}}, ["issue_id"]),
    _fn("add_action", "Add an action item (optionally linked to an issue).",
        {"description": {"type": "string"}, "owner": {"type": "string"},
         "due": {"type": "string", "description": "YYYY-MM-DD"}, "issue_id": {"type": "integer"}},
        ["description"]),
    _fn("list_actions", "List action items, optionally filtered by owner.",
        {"status": {"type": "string", "enum": ["open", "done", "cancelled", "all"], "default": "open"},
         "owner": {"type": "string"}}),
    _fn("update_action", "Mark an action done/cancelled/open.",
        {"action_id": {"type": "integer"}, "status": {"type": "string", "enum": ["open", "done", "cancelled"]}},
        ["action_id", "status"]),
]


class Toolbox:
    def __init__(self, erp: ErpBackend, mem: Memory):
        self.erp, self.mem = erp, mem

    def run(self, name: str, args_json: str, user: str = "", channel: str = "") -> str:
        try:
            args = json.loads(args_json or "{}")
            result = getattr(self, f"t_{name}")(user=user, channel=channel, **args)
        except Exception as e:  # report errors to the model so it can recover / tell the user
            result = {"error": f"{type(e).__name__}: {e}"}
        return json.dumps(result, default=str)

    # ERP (read-only)
    def t_find_items(self, query, **_):
        return [asdict(i) for i in self.erp.search_items(query)]

    def t_stock_on_hand(self, item_code, **_):
        item = self.erp.get_item(item_code)
        if not item:
            return {"error": f"No item {item_code}", "did_you_mean": [i.code for i in self.erp.search_items(item_code, 5)]}
        s = self.erp.get_stock(item_code)
        return {**asdict(item), "on_hand": s.on_hand, "allocated": s.allocated, "available": s.available, "on_order": s.on_order}

    def t_usage(self, item_code, days=365, **_):
        total = self.erp.get_usage(item_code, days)
        return {"item": item_code.upper(), "days": days, "total_used": total, "avg_per_month": round(total / days * 30.4, 1)}

    def t_bom(self, item_code, qty=1, multi_level=True, **_):
        return planning.explode_bom(self.erp, item_code, qty, multi_level)

    def t_check_builds(self, builds, include_on_order=False, **_):
        return planning.check_builds(self.erp, builds, include_on_order)

    def t_stock_risks(self, **_):
        return insights.stock_risks(self.erp)

    # memory
    def t_save_note(self, title, body, tags="", user="", channel="", **_):
        return self.mem.save_note(title, body, tags, author=user, channel=channel)

    def t_search_notes(self, query, **_):
        return self.mem.search_notes(query)

    def t_log_issue(self, title, details="", severity="medium", item_code="", user="", **_):
        return self.mem.log_issue(title, details, severity, item_code, raised_by=user)

    def t_list_issues(self, status="open", **_):
        return self.mem.list_issues(status)

    def t_close_issue(self, issue_id, **_):
        return self.mem.close_issue(issue_id)

    def t_add_action(self, description, owner="", due="", issue_id=None, user="", **_):
        return self.mem.add_action(description, owner, due, issue_id, created_by=user)

    def t_list_actions(self, status="open", owner="", **_):
        return self.mem.list_actions(status, owner)

    def t_update_action(self, action_id, status, **_):
        return self.mem.update_action(action_id, status)
