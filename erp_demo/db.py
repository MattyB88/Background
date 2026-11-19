"""SQLite storage for the ERP demo.

Tables mirror the core modules of a mid-market manufacturing/distribution ERP:
customers (debtors), suppliers (creditors), inventory items, sales orders (+ lines),
invoices, purchase orders and work orders. Every table has an `extra` JSON column so
columns from an export that don't map to a known field are kept, not dropped.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("ERP_DEMO_DB", Path(__file__).parent / "data" / "erp.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT, email TEXT, phone TEXT,
    address TEXT, city TEXT, state TEXT, postcode TEXT,
    terms_days INTEGER DEFAULT 30,
    credit_limit REAL DEFAULT 0,
    sales_rep TEXT,
    status TEXT DEFAULT 'Active',
    extra TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS suppliers (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT, email TEXT, phone TEXT,
    address TEXT, city TEXT, state TEXT, postcode TEXT,
    terms_days INTEGER DEFAULT 30,
    status TEXT DEFAULT 'Active',
    extra TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS items (
    code TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    category TEXT,
    uom TEXT DEFAULT 'EA',
    cost_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    on_hand REAL DEFAULT 0,
    allocated REAL DEFAULT 0,
    on_order REAL DEFAULT 0,
    reorder_level REAL DEFAULT 0,
    warehouse TEXT DEFAULT 'MAIN',
    supplier_code TEXT,
    item_type TEXT DEFAULT 'Stock',
    extra TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sales_orders (
    order_no TEXT PRIMARY KEY,
    customer_code TEXT,
    order_date TEXT,
    required_date TEXT,
    status TEXT DEFAULT 'Open',
    customer_ref TEXT,
    sales_rep TEXT,
    total_ex REAL DEFAULT 0,
    total_inc REAL DEFAULT 0,
    extra TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sales_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT,
    line_no INTEGER,
    item_code TEXT,
    description TEXT,
    qty REAL DEFAULT 0,
    qty_shipped REAL DEFAULT 0,
    unit_price REAL DEFAULT 0,
    line_total REAL DEFAULT 0,
    extra TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS invoices (
    invoice_no TEXT PRIMARY KEY,
    customer_code TEXT,
    order_no TEXT,
    invoice_date TEXT,
    due_date TEXT,
    total_inc REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    status TEXT DEFAULT 'Open',
    extra TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS purchase_orders (
    po_no TEXT PRIMARY KEY,
    supplier_code TEXT,
    order_date TEXT,
    due_date TEXT,
    status TEXT DEFAULT 'Open',
    total_ex REAL DEFAULT 0,
    extra TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS work_orders (
    wo_no TEXT PRIMARY KEY,
    item_code TEXT,
    qty REAL DEFAULT 0,
    qty_completed REAL DEFAULT 0,
    start_date TEXT,
    due_date TEXT,
    status TEXT DEFAULT 'Planned',
    order_no TEXT,
    extra TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_sol_order ON sales_order_lines(order_no);
CREATE INDEX IF NOT EXISTS ix_so_cust ON sales_orders(customer_code);
CREATE INDEX IF NOT EXISTS ix_inv_cust ON invoices(customer_code);
"""

# Table -> primary key column. Used by the generic API and importer.
TABLES = {
    "customers": "code",
    "suppliers": "code",
    "items": "code",
    "sales_orders": "order_no",
    "sales_order_lines": "id",
    "invoices": "invoice_no",
    "purchase_orders": "po_no",
    "work_orders": "wo_no",
}


def connect(readonly: bool = False) -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if readonly:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    else:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(reset: bool = False) -> None:
    if reset and DB_PATH.exists():
        DB_PATH.unlink()
    with connect() as conn:
        conn.executescript(SCHEMA)


def columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]


def row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    extra = d.pop("extra", None)
    if extra:
        try:
            parsed = json.loads(extra)
            if parsed:
                d["extra"] = parsed
        except json.JSONDecodeError:
            pass
    return d


def rows(conn: sqlite3.Connection, sql: str, params=()) -> list[dict]:
    return [row_to_dict(r) for r in conn.execute(sql, params)]


def upsert(conn: sqlite3.Connection, table: str, record: dict) -> None:
    cols = list(record)
    placeholders = ",".join("?" for _ in cols)
    conn.execute(
        f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES ({placeholders})",
        [record[c] for c in cols],
    )
