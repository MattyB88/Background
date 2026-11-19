"""Generate fictional sample data so the demo runs before the real export is loaded.

    python -m erp_demo.seed            # rebuilds data/erp.db with sample data
"""
from __future__ import annotations

import json
import random
from datetime import timedelta

from . import db
from .services import today

R = random.Random(42)

PREFIX = ["Apex", "Southern", "Coastal", "Ironbark", "Harbour", "Summit", "Redgum", "Bluewater", "Granite",
          "Westfield", "Northgate", "Eastline", "Kestrel", "Banksia", "Riverside", "Copperhead", "Silverleaf",
          "Outback", "Pinnacle", "Wattle"]
SUFFIX = ["Engineering", "Fabrications", "Industries", "Constructions", "Mining Services", "Agricultural",
          "Plumbing", "Electrical", "Hydraulics", "Marine", "Logistics", "Manufacturing"]
CITIES = [("Brisbane", "QLD", "4000"), ("Sydney", "NSW", "2000"), ("Melbourne", "VIC", "3000"),
          ("Perth", "WA", "6000"), ("Adelaide", "SA", "5000"), ("Newcastle", "NSW", "2300"),
          ("Townsville", "QLD", "4810"), ("Geelong", "VIC", "3220"), ("Toowoomba", "QLD", "4350"),
          ("Hobart", "TAS", "7000")]
FIRST = ["Sam", "Alex", "Jordan", "Chris", "Taylor", "Morgan", "Jamie", "Riley", "Casey", "Drew", "Pat", "Lee"]
LAST = ["Nguyen", "Smith", "Patel", "Brown", "Wilson", "Kelly", "Chen", "Walker", "Murphy", "Singh"]
REPS = ["J. Harris", "M. Tran", "K. O'Neill", "S. Rossi"]
CATEGORIES = {
    "FAST": ("Fasteners", ["Hex Bolt M{0} x {1}mm Gal", "Nyloc Nut M{0} Zinc", "Flat Washer M{0} SS316", "Coach Screw {0} x {1}mm"]),
    "HYD": ("Hydraulics", ["Hydraulic Hose 1/{0}in x {1}m", "Hydraulic Fitting JIC {0}/{1}", "Gear Pump {0}cc", "Cylinder Seal Kit {0}mm"]),
    "STL": ("Steel", ["RHS {0}x{1}x3mm 8m", "Flat Bar {0}x{1}mm 6m", "Angle {0}x{0}x{1}mm 6m", "Plate {1}mm 2400x1200"]),
    "BRG": ("Bearings", ["Ball Bearing 62{0}-2RS", "Pillow Block UCP2{0}", "Taper Roller 3{0}{1}", "Flange Bearing UCF2{0}"]),
    "ELC": ("Electrical", ["Motor {0}kW 4P 415V", "Contactor {1}A 3P", "Cable 2.5mm {1}m Roll", "VSD {0}kW"]),
    "ASM": ("Assemblies", ["Trailer Drawbar Assy {0}t", "Hydraulic Power Pack {0}kW", "Conveyor Frame {1}m", "Gate Frame {0}m x {1}m"]),
}


def _date(days_ago: int) -> str:
    return (today() - timedelta(days=days_ago)).isoformat()


def build() -> None:
    db.init_db(reset=True)
    conn = db.connect()
    customers, suppliers, items = [], [], []

    used = set()
    while len(customers) < 45:
        name = f"{R.choice(PREFIX)} {R.choice(SUFFIX)}"
        if name in used:
            continue
        used.add(name)
        city, state, pc = R.choice(CITIES)
        code = (name.split()[0][:4] + name.split()[1][:2]).upper() + f"{len(customers):02d}"
        contact = f"{R.choice(FIRST)} {R.choice(LAST)}"
        customers.append(code)
        db.upsert(conn, "customers", {
            "code": code, "name": f"{name} Pty Ltd", "contact": contact,
            "email": f"{contact.split()[0].lower()}@{name.replace(' ', '').lower()}.example",
            "phone": f"0{R.randint(2, 8)} {R.randint(3000, 9999)} {R.randint(1000, 9999)}",
            "address": f"{R.randint(1, 250)} {R.choice(['Industrial', 'Enterprise', 'Commerce', 'Trade'])} Dr",
            "city": city, "state": state, "postcode": pc,
            "terms_days": R.choice([7, 14, 30, 30, 30, 60]),
            "credit_limit": R.choice([5000, 10000, 25000, 50000, 100000]),
            "sales_rep": R.choice(REPS), "status": "Active" if R.random() > .06 else "On Hold",
            "extra": "{}"})

    for i, nm in enumerate(["Bolt & Nut Supply", "HydraFlow Components", "Steelmark Distribution", "Precision Bearings",
                            "Volt Electrical Wholesale", "Pacific Hose & Fittings", "Metro Steel", "TorqueDrive Motors"]):
        city, state, pc = R.choice(CITIES)
        code = f"SUP{i + 1:03d}"
        suppliers.append(code)
        db.upsert(conn, "suppliers", {"code": code, "name": f"{nm} Pty Ltd", "contact": f"{R.choice(FIRST)} {R.choice(LAST)}",
                                      "email": f"orders@{nm.split()[0].lower()}.example", "phone": f"1300 {R.randint(100, 999)} {R.randint(100, 999)}",
                                      "city": city, "state": state, "postcode": pc, "terms_days": 30, "status": "Active", "extra": "{}"})

    sup_for = {"FAST": "SUP001", "HYD": "SUP002", "STL": "SUP003", "BRG": "SUP004", "ELC": "SUP005", "ASM": None}
    for prefix, (cat, patterns) in CATEGORIES.items():
        for n in range(22 if prefix != "ASM" else 10):
            desc = R.choice(patterns).format(R.choice([6, 8, 10, 12, 16, 20]), R.choice([25, 40, 50, 75, 100]))
            cost = round(R.uniform(0.4, 15) if prefix == "FAST" else R.uniform(900, 6500) if prefix == "ASM" else R.uniform(12, 900), 2)
            reorder = 0 if prefix == "ASM" else R.choice([10, 20, 50, 100, 200])
            code = f"{prefix}-{1000 + n * 7}"
            items.append((code, cost, prefix))
            db.upsert(conn, "items", {
                "code": code, "description": desc, "category": cat, "uom": "EA" if prefix != "STL" else "LEN",
                "cost_price": cost, "sell_price": round(cost * R.uniform(1.3, 1.9), 2),
                "on_hand": max(0, int(reorder * R.uniform(0.1, 3))) if prefix != "ASM" else R.randint(0, 4),
                "allocated": 0, "on_order": 0, "reorder_level": reorder, "warehouse": R.choice(["MAIN", "MAIN", "BNE2"]),
                "supplier_code": sup_for[prefix], "item_type": "Manufactured" if prefix == "ASM" else "Stock", "extra": "{}"})

    # Weighted customer popularity so some customers clearly dominate
    weights = [R.paretovariate(1.3) for _ in customers]
    so_n, inv_n, wo_n = 100001, 500001, 7001
    for _ in range(650):
        days_ago = int(R.triangular(0, 420, 30))
        cust = R.choices(customers, weights)[0]
        order_no = f"SO{so_n:06d}"; so_n += 1
        status = ("Open" if days_ago < 10 else R.choice(["Picking", "Backorder", "Open"]) if days_ago < 25
                  else R.choices(["Invoiced", "Cancelled"], [0.96, 0.04])[0])
        total = 0.0
        for ln in range(1, R.randint(1, 6) + 1):
            code, cost, prefix = R.choice(items)
            qty = R.choice([1, 2, 5, 10, 25, 50, 100]) if prefix == "FAST" else R.randint(1, 3) if prefix == "ASM" else R.randint(1, 20)
            price = round(cost * R.uniform(1.3, 1.8), 2)
            total += qty * price
            db.upsert(conn, "sales_order_lines", {"order_no": order_no, "line_no": ln, "item_code": code,
                                                  "description": conn.execute("SELECT description FROM items WHERE code=?", (code,)).fetchone()[0],
                                                  "qty": qty, "qty_shipped": qty if status == "Invoiced" else 0,
                                                  "unit_price": price, "line_total": round(qty * price, 2), "extra": "{}"})
            if status in ("Open", "Picking", "Backorder"):
                conn.execute("UPDATE items SET allocated = allocated + ? WHERE code = ?", (qty, code))
            if prefix == "ASM" and status in ("Open", "Backorder"):
                db.upsert(conn, "work_orders", {"wo_no": f"WO{wo_n}", "item_code": code, "qty": qty, "qty_completed": 0,
                                                "start_date": _date(days_ago - 1), "due_date": _date(days_ago - 14),
                                                "status": R.choice(["Planned", "Released", "In Progress"]), "order_no": order_no, "extra": "{}"})
                wo_n += 1
        db.upsert(conn, "sales_orders", {"order_no": order_no, "customer_code": cust, "order_date": _date(days_ago),
                                         "required_date": _date(days_ago - 10), "status": status,
                                         "customer_ref": f"PO{R.randint(10000, 99999)}" if R.random() > .3 else None,
                                         "sales_rep": conn.execute("SELECT sales_rep FROM customers WHERE code=?", (cust,)).fetchone()[0],
                                         "total_ex": round(total, 2), "total_inc": round(total * 1.1, 2), "extra": "{}"})
        if status == "Invoiced":
            inv_days = days_ago - R.randint(2, 12)
            terms = conn.execute("SELECT terms_days FROM customers WHERE code=?", (cust,)).fetchone()[0]
            gross = round(total * 1.1, 2)
            due_days = inv_days - terms
            slow = weights[customers.index(cust)] % 1 > .75  # some customers pay late
            paid_prob = 0.97 if due_days > 90 else 0.25 if slow else 0.6 if due_days > 0 else 0.15
            paid = gross if R.random() < paid_prob else (round(gross * .5, 2) if R.random() < .1 else 0)
            db.upsert(conn, "invoices", {"invoice_no": f"INV{inv_n}", "customer_code": cust, "order_no": order_no,
                                         "invoice_date": _date(inv_days), "due_date": _date(due_days), "total_inc": gross,
                                         "paid": paid, "balance": round(gross - paid, 2),
                                         "status": "Paid" if gross - paid < 0.005 else "Open", "extra": "{}"})
            inv_n += 1

    for i in range(40):
        days_ago = R.randint(0, 120)
        sup = R.choice(suppliers[:5])
        status = "Received" if days_ago > 30 else R.choice(["Open", "Sent", "Part Received"])
        po_items = conn.execute("SELECT code, cost_price FROM items WHERE supplier_code=? ORDER BY RANDOM() LIMIT 3", (sup,)).fetchall()
        total = 0
        for code, cost in po_items:
            qty = R.choice([20, 50, 100])
            total += qty * cost
            if status != "Received":
                conn.execute("UPDATE items SET on_order = on_order + ? WHERE code = ?", (qty, code))
        db.upsert(conn, "purchase_orders", {"po_no": f"PO{30001 + i}", "supplier_code": sup, "order_date": _date(days_ago),
                                            "due_date": _date(days_ago - 14), "status": status, "total_ex": round(total, 2),
                                            "extra": json.dumps({"lines": [c for c, _ in po_items]})})
    conn.commit()
    conn.close()


if __name__ == "__main__":
    build()
    print(f"Sample data written to {db.DB_PATH}")
