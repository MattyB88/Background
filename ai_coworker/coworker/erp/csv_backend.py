"""Reads ERP exports (or the bundled sample data) from CSV files.

Useful for the demo, and also a legit stop-gap: schedule an Accentis report/export to CSV
into a shared folder and point ERP_CSV_DIR at it.
"""
import csv
import datetime as dt
from pathlib import Path

from .base import ErpBackend, Item, Stock


def _read(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


class CsvBackend(ErpBackend):
    def __init__(self, folder: str):
        p = Path(folder)
        self.items = {
            r["code"].upper(): Item(
                code=r["code"].upper(),
                description=r["description"],
                type=r.get("type", "buy"),
                uom=r.get("uom", "ea"),
                lead_time_days=int(float(r.get("lead_time_days") or 0)),
                min_stock=float(r.get("min_stock") or 0),
            )
            for r in _read(p / "items.csv")
        }
        self.stock = {
            r["item"].upper(): Stock(
                r["item"].upper(),
                float(r["on_hand"] or 0),
                float(r.get("allocated") or 0),
                float(r.get("on_order") or 0),
            )
            for r in _read(p / "stock.csv")
        }
        self.bom: dict[str, list[tuple[str, float]]] = {}
        for r in _read(p / "bom.csv"):
            self.bom.setdefault(r["parent"].upper(), []).append((r["component"].upper(), float(r["qty_per"])))
        self.usage = [
            (dt.date.fromisoformat(r["date"]), r["item"].upper(), float(r["qty"])) for r in _read(p / "usage.csv")
        ]
        # Usage windows are measured back from the newest transaction so the sample data never goes stale.
        self.as_of = max((d for d, _, _ in self.usage), default=dt.date.today())

    def get_item(self, code):
        return self.items.get(code.strip().upper())

    def search_items(self, text, limit=20):
        t = text.strip().lower()
        return [i for i in self.items.values() if t in i.code.lower() or t in i.description.lower()][:limit]

    def list_items(self):
        return list(self.items.values())

    def get_stock(self, code):
        code = code.strip().upper()
        return self.stock.get(code, Stock(code))

    def get_bom(self, code):
        return list(self.bom.get(code.strip().upper(), []))

    def get_usage(self, code, days=365):
        code = code.strip().upper()
        since = self.as_of - dt.timedelta(days=days)
        return sum(q for d, i, q in self.usage if i == code and d > since)
