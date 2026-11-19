"""Import an ERP export (CSV / XLSX files) into the demo database.

Usage:
    python -m erp_demo.importer path/to/export_folder_or_file [...] [--reset] [--dry-run]

Each file is matched to an entity (customers, items, sales orders, ...) by its file name
and, failing that, by how many of its column headers match known aliases. Column names
are matched loosely (case, spaces and punctuation ignored). Columns that don't map to a
known field are kept in each record's `extra` JSON, so nothing in the export is lost.

If the mapping guesses wrong, add the export's header to the alias lists below.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd

from . import db

# entity -> (table, filename keywords, {field: [header aliases]})
ENTITIES: dict[str, tuple[str, list[str], dict[str, list[str]]]] = {
    "customers": ("customers", ["customer", "debtor", "client"], {
        "code": ["customer code", "customer id", "debtor code", "debtor", "account code", "account", "cust code", "code", "id"],
        "name": ["customer name", "debtor name", "company", "company name", "trading name", "name"],
        "contact": ["contact", "contact name", "primary contact"],
        "email": ["email", "email address", "e-mail", "accounts email"],
        "phone": ["phone", "telephone", "phone number", "ph"],
        "address": ["address", "street", "address 1", "address line 1", "street address", "billing address"],
        "city": ["city", "suburb", "town"],
        "state": ["state", "region"],
        "postcode": ["postcode", "post code", "zip", "postal code"],
        "terms_days": ["terms", "terms days", "payment terms", "credit terms"],
        "credit_limit": ["credit limit", "limit"],
        "sales_rep": ["sales rep", "rep", "salesperson", "sales person", "account manager"],
        "status": ["status", "active", "account status"],
    }),
    "suppliers": ("suppliers", ["supplier", "creditor", "vendor"], {
        "code": ["supplier code", "supplier id", "creditor code", "creditor", "vendor code", "account code", "code", "id"],
        "name": ["supplier name", "creditor name", "vendor name", "company", "name"],
        "contact": ["contact", "contact name"],
        "email": ["email", "email address"],
        "phone": ["phone", "telephone"],
        "address": ["address", "street", "address 1"],
        "city": ["city", "suburb"],
        "state": ["state"],
        "postcode": ["postcode", "post code", "zip"],
        "terms_days": ["terms", "payment terms", "terms days"],
        "status": ["status", "active"],
    }),
    "items": ("items", ["item", "inventory", "stock", "product", "part"], {
        "code": ["item code", "part number", "part no", "part", "product code", "sku", "stock code", "inventory code", "code"],
        "description": ["description", "item description", "product name", "name", "desc"],
        "category": ["category", "group", "item group", "product group", "class", "type category"],
        "uom": ["uom", "unit", "unit of measure", "units"],
        "cost_price": ["cost", "cost price", "average cost", "avg cost", "standard cost", "unit cost", "last cost"],
        "sell_price": ["sell price", "price", "sell", "list price", "retail price", "price 1", "base price"],
        "on_hand": ["on hand", "qty on hand", "soh", "stock on hand", "quantity on hand", "qoh", "in stock"],
        "allocated": ["allocated", "committed", "reserved", "qty allocated"],
        "on_order": ["on order", "qty on order", "incoming"],
        "reorder_level": ["reorder level", "reorder point", "min", "min stock", "minimum", "reorder qty"],
        "warehouse": ["warehouse", "location", "store", "site"],
        "supplier_code": ["supplier", "supplier code", "primary supplier", "default supplier", "vendor"],
        "item_type": ["item type", "type", "stock type"],
    }),
    "sales_orders": ("sales_orders", ["sales order", "salesorder", "sales_order", "so ", "orders"], {
        "order_no": ["order no", "order number", "sales order", "sales order no", "so number", "so no", "order", "order id", "so"],
        "customer_code": ["customer code", "customer", "debtor code", "debtor", "account", "customer id"],
        "order_date": ["order date", "date", "entered date", "created"],
        "required_date": ["required date", "due date", "delivery date", "promised date", "required"],
        "status": ["status", "order status"],
        "customer_ref": ["customer ref", "customer po", "po number", "reference", "cust ref", "your ref"],
        "sales_rep": ["sales rep", "rep", "salesperson"],
        "total_ex": ["total ex", "total ex gst", "subtotal", "amount ex", "net total", "total excl"],
        "total_inc": ["total inc", "total inc gst", "total", "amount", "grand total", "total incl"],
        # line-level fields, used when the export has one row per order line
        "item_code": ["item code", "part number", "part no", "product code", "sku", "stock code", "item"],
        "description": ["description", "item description", "line description"],
        "qty": ["qty", "quantity", "qty ordered", "ordered"],
        "qty_shipped": ["qty shipped", "shipped", "qty supplied", "supplied", "delivered"],
        "unit_price": ["unit price", "price", "sell price"],
        "line_total": ["line total", "extended", "line amount", "ext price", "extended price"],
        "line_no": ["line", "line no", "line number"],
    }),
    "invoices": ("invoices", ["invoice", "receivable", "ar ", "debtors trans"], {
        "invoice_no": ["invoice no", "invoice number", "invoice", "inv no", "document no", "doc no"],
        "customer_code": ["customer code", "customer", "debtor code", "debtor", "account"],
        "order_no": ["order no", "sales order", "so number", "order"],
        "invoice_date": ["invoice date", "date", "doc date"],
        "due_date": ["due date", "due"],
        "total_inc": ["total", "total inc", "amount", "invoice total", "gross"],
        "paid": ["paid", "amount paid", "payments", "receipted"],
        "balance": ["balance", "outstanding", "amount outstanding", "balance due", "owing"],
        "status": ["status"],
    }),
    "purchase_orders": ("purchase_orders", ["purchase", "po_", "po ", "purchase order"], {
        "po_no": ["po number", "po no", "purchase order", "purchase order no", "po", "order no"],
        "supplier_code": ["supplier code", "supplier", "creditor", "vendor"],
        "order_date": ["order date", "date"],
        "due_date": ["due date", "expected date", "eta", "required date"],
        "status": ["status"],
        "total_ex": ["total ex", "total", "amount", "subtotal"],
    }),
    "work_orders": ("work_orders", ["work order", "workorder", "job", "production", "manufactur"], {
        "wo_no": ["work order", "work order no", "wo number", "wo no", "job no", "job number", "job", "wo"],
        "item_code": ["item code", "part number", "product", "item", "assembly"],
        "qty": ["qty", "quantity", "qty to make", "build qty"],
        "qty_completed": ["qty completed", "completed", "qty built", "built"],
        "start_date": ["start date", "start"],
        "due_date": ["due date", "due", "required date", "finish date"],
        "status": ["status"],
        "order_no": ["sales order", "order no", "so number"],
    }),
}

NUMERIC = {"terms_days", "credit_limit", "cost_price", "sell_price", "on_hand", "allocated", "on_order",
           "reorder_level", "total_ex", "total_inc", "qty", "qty_shipped", "unit_price", "line_total",
           "paid", "balance", "qty_completed", "line_no"}
DATES = {"order_date", "required_date", "invoice_date", "due_date", "start_date"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s).lower()).strip()


def read_file(path: Path) -> list[tuple[str, pd.DataFrame]]:
    if path.suffix.lower() in (".xlsx", ".xlsm", ".xls"):
        sheets = pd.read_excel(path, sheet_name=None, dtype=str)
        return [(f"{path.stem} {name}", df) for name, df in sheets.items()]
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return [(path.stem, pd.read_csv(path, dtype=str, encoding=enc, sep=None, engine="python"))]
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Could not decode {path}")


def map_columns(headers: list[str], aliases: dict[str, list[str]]) -> dict[str, str]:
    """Return {header: field}. Exact alias match first (in alias priority order), then contains."""
    normed = {h: norm(h) for h in headers}
    mapping: dict[str, str] = {}
    for strict in (True, False):
        for field, names in aliases.items():
            if field in mapping.values():
                continue
            for alias in names:
                hit = next((h for h, n in normed.items() if h not in mapping and
                            (n == alias if strict else (len(alias) > 3 and alias in n))), None)
                if hit:
                    mapping[hit] = field
                    break
    return mapping


def detect_entity(label: str, headers: list[str]) -> str | None:
    lab = f" {norm(label)} "
    for entity, (_, keywords, _) in ENTITIES.items():
        if any(k in lab or k.replace(" ", "") in lab.replace(" ", "") for k in keywords):
            return entity
    scores = {e: len(map_columns(headers, a)) for e, (_, _, a) in ENTITIES.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] >= 3 else None


def clean(field: str, value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    v = str(value).strip()
    if v == "" or v.lower() in ("nan", "none", "null"):
        return None
    if field in NUMERIC:
        neg = v.startswith("(") and v.endswith(")")
        num = re.sub(r"[^0-9.\-]", "", v)
        if field == "terms_days":
            m = re.search(r"\d+", v)
            return int(m.group()) if m else None
        try:
            n = float(num)
        except ValueError:
            return None
        return -n if neg else n
    if field in DATES:
        try:
            iso = re.match(r"^\d{4}-\d{2}-\d{2}", v)
            ts = pd.to_datetime(v, dayfirst=not iso)
            return ts.date().isoformat()
        except (ValueError, TypeError):
            return v
    if field == "status" and v.lower() in ("true", "yes", "y", "1"):
        return "Active"
    if field == "status" and v.lower() in ("false", "no", "n", "0"):
        return "Inactive"
    return v


def to_records(df: pd.DataFrame, mapping: dict[str, str]) -> list[tuple[dict, dict]]:
    out = []
    for _, row in df.iterrows():
        rec, extra = {}, {}
        for h, v in row.items():
            if h in mapping:
                cv = clean(mapping[h], v)
                if cv is not None:
                    rec[mapping[h]] = cv
            elif v is not None and not (isinstance(v, float) and pd.isna(v)) and str(v).strip():
                extra[str(h)] = str(v).strip()
        if rec:
            out.append((rec, extra))
    return out


def import_frame(conn, entity: str, df: pd.DataFrame, dry_run: bool = False) -> str:
    table, _, aliases = ENTITIES[entity]
    df = df.dropna(how="all")
    mapping = map_columns(list(df.columns), aliases)
    report = "  columns: " + ", ".join(f"{h!r}->{f}" for h, f in mapping.items())
    unmapped = [h for h in df.columns if h not in mapping]
    if unmapped:
        report += f"\n  kept in extra: {', '.join(map(str, unmapped))}"
    pk = db.TABLES[table]
    if pk not in mapping.values():
        return report + f"\n  SKIPPED: no column for required key '{pk}'"
    records = to_records(df, mapping)
    if dry_run:
        return report + f"\n  would import {len(records)} rows"

    if entity == "sales_orders" and "item_code" in mapping.values():
        return report + "\n  " + _import_order_lines(conn, records)

    cols = set(db.columns(conn, table))
    n = 0
    for rec, extra in records:
        rec = {k: v for k, v in rec.items() if k in cols}
        if table == "invoices":
            if "balance" not in rec and "total_inc" in rec:
                rec["balance"] = rec["total_inc"] - rec.get("paid", 0)
            if "paid" not in rec and "total_inc" in rec and "balance" in rec:
                rec["paid"] = rec["total_inc"] - rec["balance"]
            if "status" not in rec:
                rec["status"] = "Paid" if abs(rec.get("balance") or 0) < 0.005 else "Open"
        if table in ("customers", "suppliers") and "name" not in rec:
            rec["name"] = rec[pk]
        if table == "items" and "description" not in rec:
            rec["description"] = rec[pk]
        if table == "sales_orders":
            if "total_inc" in rec and "total_ex" not in rec:
                rec["total_ex"] = round(rec["total_inc"] / 1.1, 2)
            if "total_ex" in rec and "total_inc" not in rec:
                rec["total_inc"] = round(rec["total_ex"] * 1.1, 2)
        rec["extra"] = json.dumps(extra)
        db.upsert(conn, table, rec)
        n += 1
    return report + f"\n  imported {n} rows into {table}"


def _import_order_lines(conn, records) -> str:
    """Flat export: one row per order line, header fields repeated. Split into header + lines."""
    headers: dict[str, dict] = {}
    lines: dict[str, list[dict]] = {}
    for rec, extra in records:
        no = rec["order_no"]
        h = headers.setdefault(no, {"order_no": no, "extra": json.dumps({})})
        for f in ("customer_code", "order_date", "required_date", "status", "customer_ref", "sales_rep"):
            if f in rec and f not in h:
                h[f] = rec[f]
        if rec.get("item_code"):
            qty, price = rec.get("qty", 0), rec.get("unit_price", 0)
            lines.setdefault(no, []).append({
                "order_no": no, "line_no": int(rec.get("line_no") or len(lines.get(no, [])) + 1),
                "item_code": rec["item_code"], "description": rec.get("description"),
                "qty": qty, "qty_shipped": rec.get("qty_shipped", 0), "unit_price": price,
                "line_total": rec.get("line_total", round(qty * price, 2)), "extra": json.dumps(extra)})
    for no, h in headers.items():
        conn.execute("DELETE FROM sales_order_lines WHERE order_no = ?", (no,))
        total = sum(l["line_total"] for l in lines.get(no, []))
        h.setdefault("total_ex", round(total, 2))
        h.setdefault("total_inc", round(total * 1.1, 2))
        h.setdefault("status", "Open")
        db.upsert(conn, "sales_orders", h)
        for l in lines.get(no, []):
            db.upsert(conn, "sales_order_lines", l)
    return f"imported {len(headers)} orders with {sum(map(len, lines.values()))} lines"


def import_paths(paths: list[Path], reset: bool = False, dry_run: bool = False) -> list[str]:
    if not dry_run:
        db.init_db(reset=reset)
    files: list[Path] = []
    for p in paths:
        files += sorted(f for f in p.rglob("*") if f.suffix.lower() in (".csv", ".xlsx", ".xls", ".xlsm", ".txt")) if p.is_dir() else [p]
    log = []
    conn = db.connect()
    try:
        for f in files:
            for label, df in read_file(f):
                entity = detect_entity(label, list(df.columns))
                if not entity:
                    log.append(f"{label}: could not tell what this file contains - skipped (headers: {list(df.columns)[:12]})")
                    continue
                log.append(f"{label}: {entity}\n" + import_frame(conn, entity, df, dry_run))
        conn.commit()
    finally:
        conn.close()
    return log


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--reset", action="store_true", help="delete the existing database first (drops sample data)")
    ap.add_argument("--dry-run", action="store_true", help="show the column mapping without importing")
    args = ap.parse_args(argv)
    for line in import_paths(args.paths, args.reset, args.dry_run):
        print(line)


if __name__ == "__main__":
    sys.exit(main())
