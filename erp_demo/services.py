"""Business queries shared by the REST API and the AI assistant's tools.

Keeping one implementation means the AI can only see and do what the API exposes.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime

from . import db

SEARCH_COLUMNS = {
    "customers": ["code", "name", "contact", "email", "city", "state", "sales_rep"],
    "suppliers": ["code", "name", "contact", "email", "city", "state"],
    "items": ["code", "description", "category", "supplier_code", "warehouse"],
    "sales_orders": ["order_no", "customer_code", "customer_ref", "status", "sales_rep"],
    "invoices": ["invoice_no", "customer_code", "order_no", "status"],
    "purchase_orders": ["po_no", "supplier_code", "status"],
    "work_orders": ["wo_no", "item_code", "status", "order_no"],
}

DEFAULT_SORT = {
    "customers": "name",
    "suppliers": "name",
    "items": "code",
    "sales_orders": "order_date DESC",
    "invoices": "invoice_date DESC",
    "purchase_orders": "order_date DESC",
    "work_orders": "due_date",
}

GST_RATE = 0.10


def today() -> date:
    """Business date. Set ERP_DEMO_TODAY=YYYY-MM-DD to pin it to the export's date."""
    pinned = os.environ.get("ERP_DEMO_TODAY")
    return date.fromisoformat(pinned) if pinned else date.today()


def _conn():
    return db.connect()


# ---------------------------------------------------------------- generic lists

def list_records(table: str, q: str | None = None, filters: dict | None = None,
                 sort: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    if table not in SEARCH_COLUMNS:
        raise ValueError(f"Unknown resource '{table}'")
    with _conn() as conn:
        valid = set(db.columns(conn, table))
        where, params = [], []
        if q:
            like = f"%{q}%"
            where.append("(" + " OR ".join(f"{c} LIKE ?" for c in SEARCH_COLUMNS[table]) + ")")
            params += [like] * len(SEARCH_COLUMNS[table])
        for key, val in (filters or {}).items():
            if val in (None, ""):
                continue
            if key not in valid:
                raise ValueError(f"Unknown filter field '{key}' for {table}")
            where.append(f"{key} = ?")
            params.append(val)
        order = DEFAULT_SORT[table]
        if sort:
            field = sort.lstrip("-")
            if field not in valid:
                raise ValueError(f"Unknown sort field '{field}'")
            order = f"{field} {'DESC' if sort.startswith('-') else 'ASC'}"
        clause = f" WHERE {' AND '.join(where)}" if where else ""
        total = conn.execute(f"SELECT COUNT(*) FROM {table}{clause}", params).fetchone()[0]
        data = db.rows(conn, f"SELECT * FROM {table}{clause} ORDER BY {order} LIMIT ? OFFSET ?",
                       params + [min(int(limit), 500), int(offset)])
    return {"total": total, "limit": limit, "offset": offset, "data": data}


# ---------------------------------------------------------------- detail views

def get_customer(code: str) -> dict | None:
    with _conn() as conn:
        cust = conn.execute("SELECT * FROM customers WHERE code = ?", (code,)).fetchone()
        if not cust:
            return None
        out = db.row_to_dict(cust)
        out["recent_orders"] = db.rows(conn, "SELECT order_no, order_date, status, total_inc FROM sales_orders "
                                             "WHERE customer_code = ? ORDER BY order_date DESC LIMIT 10", (code,))
        out["open_invoices"] = db.rows(conn, "SELECT invoice_no, invoice_date, due_date, total_inc, balance FROM invoices "
                                             "WHERE customer_code = ? AND balance > 0.005 ORDER BY due_date", (code,))
        stats = conn.execute(
            "SELECT COALESCE(SUM(balance),0) bal, "
            "COALESCE(SUM(CASE WHEN due_date < ? AND balance > 0.005 THEN balance END),0) overdue "
            "FROM invoices WHERE customer_code = ?", (today().isoformat(), code)).fetchone()
        ytd = conn.execute("SELECT COALESCE(SUM(total_inc),0) FROM invoices WHERE customer_code = ? AND invoice_date >= ?",
                           (code, f"{today().year}-01-01")).fetchone()[0]
        out["balance"] = round(stats["bal"], 2)
        out["overdue"] = round(stats["overdue"], 2)
        out["sales_ytd_inc"] = round(ytd, 2)
        out["credit_available"] = round((out.get("credit_limit") or 0) - stats["bal"], 2)
    return out


def get_supplier(code: str) -> dict | None:
    with _conn() as conn:
        sup = conn.execute("SELECT * FROM suppliers WHERE code = ?", (code,)).fetchone()
        if not sup:
            return None
        out = db.row_to_dict(sup)
        out["open_purchase_orders"] = db.rows(conn, "SELECT * FROM purchase_orders WHERE supplier_code = ? "
                                                    "AND status NOT IN ('Received','Closed','Cancelled') ORDER BY due_date", (code,))
        out["items_supplied"] = db.rows(conn, "SELECT code, description, on_hand, reorder_level FROM items "
                                              "WHERE supplier_code = ? ORDER BY code LIMIT 50", (code,))
    return out


def get_item(code: str) -> dict | None:
    with _conn() as conn:
        item = conn.execute("SELECT * FROM items WHERE code = ?", (code,)).fetchone()
        if not item:
            return None
        out = db.row_to_dict(item)
        out["available"] = round((out.get("on_hand") or 0) - (out.get("allocated") or 0), 3)
        out["margin_pct"] = (round(100 * (out["sell_price"] - out["cost_price"]) / out["sell_price"], 1)
                             if out.get("sell_price") else None)
        out["recent_sales"] = db.rows(conn, "SELECT l.order_no, o.order_date, o.customer_code, l.qty, l.unit_price "
                                            "FROM sales_order_lines l JOIN sales_orders o USING(order_no) "
                                            "WHERE l.item_code = ? ORDER BY o.order_date DESC LIMIT 10", (code,))
        out["work_orders"] = db.rows(conn, "SELECT * FROM work_orders WHERE item_code = ? "
                                           "AND status NOT IN ('Completed','Closed') ORDER BY due_date", (code,))
    return out


def get_sales_order(order_no: str) -> dict | None:
    with _conn() as conn:
        so = conn.execute("SELECT * FROM sales_orders WHERE order_no = ?", (order_no,)).fetchone()
        if not so:
            return None
        out = db.row_to_dict(so)
        out["customer"] = db.rows(conn, "SELECT code, name, email, phone FROM customers WHERE code = ?",
                                  (out["customer_code"],))
        out["customer"] = out["customer"][0] if out["customer"] else None
        out["lines"] = db.rows(conn, "SELECT * FROM sales_order_lines WHERE order_no = ? ORDER BY line_no", (order_no,))
        out["invoices"] = db.rows(conn, "SELECT invoice_no, invoice_date, total_inc, balance FROM invoices WHERE order_no = ?",
                                  (order_no,))
    return out


def get_record(table: str, key: str) -> dict | None:
    with _conn() as conn:
        r = conn.execute(f"SELECT * FROM {table} WHERE {db.TABLES[table]} = ?", (key,)).fetchone()
        return db.row_to_dict(r) if r else None


# ---------------------------------------------------------------- reports

def ar_aging(customer_code: str | None = None) -> dict:
    as_of = today()
    buckets = ["current", "1-30", "31-60", "61-90", "90+"]
    by_cust: dict[str, dict] = {}
    with _conn() as conn:
        sql = ("SELECT i.customer_code, c.name, i.invoice_no, i.due_date, i.balance FROM invoices i "
               "LEFT JOIN customers c ON c.code = i.customer_code WHERE i.balance > 0.005")
        params = []
        if customer_code:
            sql += " AND i.customer_code = ?"
            params.append(customer_code)
        for r in conn.execute(sql, params):
            days = (as_of - _parse_date(r["due_date"])).days if r["due_date"] else 0
            b = "current" if days <= 0 else "1-30" if days <= 30 else "31-60" if days <= 60 else "61-90" if days <= 90 else "90+"
            row = by_cust.setdefault(r["customer_code"], {"customer_code": r["customer_code"], "name": r["name"],
                                                         **{k: 0.0 for k in buckets}, "total": 0.0})
            row[b] += r["balance"]
            row["total"] += r["balance"]
    data = sorted(by_cust.values(), key=lambda x: -x["total"])
    for row in data:
        for k in buckets + ["total"]:
            row[k] = round(row[k], 2)
    totals = {k: round(sum(r[k] for r in data), 2) for k in buckets + ["total"]}
    return {"as_of": as_of.isoformat(), "totals": totals, "data": data}


def low_stock() -> list[dict]:
    with _conn() as conn:
        return db.rows(conn, """
            SELECT code, description, category, on_hand, allocated, on_order, reorder_level,
                   (on_hand - allocated + on_order) AS projected, supplier_code,
                   MAX(reorder_level - (on_hand - allocated + on_order), 0) AS suggested_order_qty
            FROM items
            WHERE item_type = 'Stock' AND reorder_level > 0
              AND (on_hand - allocated + on_order) < reorder_level
            ORDER BY (on_hand - allocated + on_order) - reorder_level""")


SUMMARY_GROUPS = {
    "customer": ("o.customer_code", "LEFT JOIN customers c ON c.code = o.customer_code", "c.name"),
    "item": ("l.item_code", "LEFT JOIN items i ON i.code = l.item_code", "i.description"),
    "category": ("COALESCE(i.category,'(none)')", "LEFT JOIN items i ON i.code = l.item_code", "NULL"),
    "month": ("substr(o.order_date,1,7)", "", "NULL"),
    "sales_rep": ("COALESCE(o.sales_rep,'(none)')", "", "NULL"),
}


def sales_summary(group_by: str = "month", date_from: str | None = None,
                  date_to: str | None = None, limit: int = 24) -> list[dict]:
    """Sales (ex GST) from sales order lines, grouped. Uses order headers if lines are absent."""
    if group_by not in SUMMARY_GROUPS:
        raise ValueError(f"group_by must be one of {sorted(SUMMARY_GROUPS)}")
    key, join, label = SUMMARY_GROUPS[group_by]
    where, params = ["o.status != 'Cancelled'"], []
    if date_from:
        where.append("o.order_date >= ?"); params.append(date_from)
    if date_to:
        where.append("o.order_date <= ?"); params.append(date_to)
    order = "key DESC" if group_by == "month" else "sales DESC"
    with _conn() as conn:
        has_lines = conn.execute("SELECT COUNT(*) FROM sales_order_lines").fetchone()[0] > 0
        if has_lines:
            sql = (f"SELECT {key} AS key, {label} AS label, ROUND(SUM(l.line_total),2) AS sales, "
                   f"COUNT(DISTINCT o.order_no) AS orders, ROUND(SUM(l.qty),2) AS qty "
                   f"FROM sales_order_lines l JOIN sales_orders o ON o.order_no = l.order_no {join} "
                   f"WHERE {' AND '.join(where)} GROUP BY key ORDER BY {order} LIMIT ?")
        else:
            if group_by in ("item", "category"):
                raise ValueError("No sales order lines loaded; item/category summaries need lines.")
            sql = (f"SELECT {key} AS key, {label} AS label, ROUND(SUM(o.total_ex),2) AS sales, "
                   f"COUNT(*) AS orders FROM sales_orders o {join} "
                   f"WHERE {' AND '.join(where)} GROUP BY key ORDER BY {order} LIMIT ?")
        result = db.rows(conn, sql, params + [limit])
    if group_by == "month":
        result.reverse()  # latest N months, oldest first
    return result


def dashboard() -> dict:
    t = today()
    month_start, year_start = t.replace(day=1).isoformat(), f"{t.year}-01-01"
    with _conn() as conn:
        one = lambda sql, p=(): conn.execute(sql, p).fetchone()[0] or 0  # noqa: E731
        kpis = {
            "sales_mtd_ex": round(one("SELECT SUM(total_ex) FROM sales_orders WHERE order_date >= ? AND status != 'Cancelled'", (month_start,)), 2),
            "sales_ytd_ex": round(one("SELECT SUM(total_ex) FROM sales_orders WHERE order_date >= ? AND status != 'Cancelled'", (year_start,)), 2),
            "open_orders": one("SELECT COUNT(*) FROM sales_orders WHERE status IN ('Open','Picking','Backorder')"),
            "open_orders_value_ex": round(one("SELECT SUM(total_ex) FROM sales_orders WHERE status IN ('Open','Picking','Backorder')"), 2),
            "ar_outstanding": round(one("SELECT SUM(balance) FROM invoices WHERE balance > 0.005"), 2),
            "ar_overdue": round(one("SELECT SUM(balance) FROM invoices WHERE balance > 0.005 AND due_date < ?", (t.isoformat(),)), 2),
            "low_stock_items": len(low_stock()),
            "open_work_orders": one("SELECT COUNT(*) FROM work_orders WHERE status NOT IN ('Completed','Closed')"),
            "open_purchase_orders": one("SELECT COUNT(*) FROM purchase_orders WHERE status NOT IN ('Received','Closed','Cancelled')"),
            "counts": {tbl: one(f"SELECT COUNT(*) FROM {tbl}") for tbl in SEARCH_COLUMNS},
        }
        top_customers = db.rows(conn, """
            SELECT o.customer_code AS code, c.name, ROUND(SUM(o.total_ex),2) AS sales
            FROM sales_orders o LEFT JOIN customers c ON c.code = o.customer_code
            WHERE o.order_date >= ? AND o.status != 'Cancelled'
            GROUP BY o.customer_code ORDER BY sales DESC LIMIT 5""", (year_start,))
        latest = conn.execute("SELECT MAX(order_date) FROM sales_orders").fetchone()[0]
    return {"as_of": t.isoformat(), "kpis": kpis, "top_customers_ytd": top_customers,
            "monthly_sales": sales_summary("month", limit=12), "latest_order_date": latest}


# ---------------------------------------------------------------- writes

def create_sales_order(customer_code: str, lines: list[dict], customer_ref: str | None = None,
                       required_date: str | None = None) -> dict:
    if not lines:
        raise ValueError("A sales order needs at least one line")
    with _conn() as conn:
        cust = conn.execute("SELECT code, sales_rep FROM customers WHERE code = ?", (customer_code,)).fetchone()
        if not cust:
            raise ValueError(f"Customer '{customer_code}' not found")
        last = conn.execute("SELECT order_no FROM sales_orders ORDER BY order_no DESC").fetchall()
        nums = [int(m.group()) for (n,) in last if (m := re.search(r"\d+$", n or ""))]
        order_no = f"SO{(max(nums) + 1 if nums else 100001):06d}"
        total = 0.0
        for i, ln in enumerate(lines, 1):
            item = conn.execute("SELECT * FROM items WHERE code = ?", (ln["item_code"],)).fetchone()
            if not item:
                raise ValueError(f"Item '{ln['item_code']}' not found")
            qty = float(ln.get("qty", 1))
            price = float(ln.get("unit_price") or item["sell_price"])
            total += qty * price
            db.upsert(conn, "sales_order_lines", {
                "order_no": order_no, "line_no": i, "item_code": item["code"],
                "description": item["description"], "qty": qty, "unit_price": price,
                "line_total": round(qty * price, 2)})
            conn.execute("UPDATE items SET allocated = allocated + ? WHERE code = ?", (qty, item["code"]))
        db.upsert(conn, "sales_orders", {
            "order_no": order_no, "customer_code": customer_code, "order_date": today().isoformat(),
            "required_date": required_date, "status": "Open", "customer_ref": customer_ref,
            "sales_rep": cust["sales_rep"], "total_ex": round(total, 2),
            "total_inc": round(total * (1 + GST_RATE), 2)})
    return get_sales_order(order_no)


# ---------------------------------------------------------------- read-only SQL

_FORBIDDEN = re.compile(r"\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum)\b", re.I)


def run_sql(query: str, max_rows: int = 200) -> dict:
    """Run a single read-only SELECT against the database (opened in read-only mode)."""
    q = query.strip().rstrip(";")
    if ";" in q or not re.match(r"^\s*(select|with)\b", q, re.I) or _FORBIDDEN.search(q):
        raise ValueError("Only a single SELECT statement is allowed")
    with db.connect(readonly=True) as conn:
        cur = conn.execute(q)
        cols = [c[0] for c in cur.description]
        data = [dict(zip(cols, r)) for r in cur.fetchmany(max_rows + 1)]
    return {"columns": cols, "rows": data[:max_rows], "truncated": len(data) > max_rows}


def _parse_date(s: str) -> date:
    return datetime.fromisoformat(s[:10]).date()
