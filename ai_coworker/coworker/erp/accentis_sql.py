"""Read-only connector for an Accentis database (SQL Server) via ODBC.

The SQL lives in a TOML file (ACCENTIS_QUERIES) rather than in code, because the real table and
column names have to come from your Accentis admin / partner. Copy accentis_queries.example.toml,
fill in the real queries, and test each one in SQL Server Management Studio first.

Use a SQL login that only has SELECT permission (ideally on a few views made for this purpose).
"""
import tomllib

from .base import ErpBackend, Item, Stock


class AccentisSqlBackend(ErpBackend):
    def __init__(self, odbc_conn_str: str, queries_path: str):
        import pyodbc  # pip install pyodbc  (plus the Microsoft ODBC Driver for SQL Server)

        if not odbc_conn_str:
            raise ValueError("Set ACCENTIS_ODBC to an ODBC connection string")
        with open(queries_path, "rb") as f:
            self.q = tomllib.load(f)["queries"]
        self.conn = pyodbc.connect(odbc_conn_str, readonly=True, autocommit=True)

    def _rows(self, name: str, *params) -> list[dict]:
        cur = self.conn.cursor()
        sql = self.q[name]
        cur.execute(sql, *params[: sql.count("?")])
        cols = [c[0].lower() for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    @staticmethod
    def _item(r: dict) -> Item:
        return Item(
            code=str(r["code"]).strip().upper(),
            description=str(r.get("description") or ""),
            type=str(r.get("type") or "buy"),
            uom=str(r.get("uom") or "ea"),
            lead_time_days=int(r.get("lead_time_days") or 0),
            min_stock=float(r.get("min_stock") or 0),
        )

    def get_item(self, code):
        rows = self._rows("get_item", code.strip().upper())
        return self._item(rows[0]) if rows else None

    def search_items(self, text, limit=20):
        return [self._item(r) for r in self._rows("search_items", f"%{text.strip()}%", f"%{text.strip()}%")][:limit]

    def list_items(self):
        return [self._item(r) for r in self._rows("list_items")]

    def get_stock(self, code):
        code = code.strip().upper()
        rows = self._rows("get_stock", code)
        if not rows:
            return Stock(code)
        r = rows[0]
        return Stock(code, float(r.get("on_hand") or 0), float(r.get("allocated") or 0), float(r.get("on_order") or 0))

    def get_bom(self, code):
        return [(str(r["component"]).strip().upper(), float(r["qty_per"])) for r in self._rows("get_bom", code.strip().upper())]

    def get_usage(self, code, days=365):
        rows = self._rows("get_usage", code.strip().upper(), days)
        return float(rows[0]["qty"] or 0) if rows else 0.0
