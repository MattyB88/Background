from conftest import ROOT

from coworker.erp.csv_backend import CsvBackend
from coworker.insights import daily_digest, stock_risks
from coworker.memory import Memory
from coworker.planning import check_builds, explode_bom

erp = CsvBackend(str(ROOT / "sample_data"))


def test_the_example_question():
    # "if I build 10x CAS123 and 20x CAS234, will I have enough parts to build 5x CAS321?"
    r = check_builds(erp, [{"item": "cas123", "qty": 10}, {"item": "CAS234", "qty": 20}, {"item": "CAS321", "qty": 5}])
    first, second, target = r["builds"]
    assert first["enough_stock"] and first["max_buildable_from_remaining_stock"] == 18
    assert second["shortages"] == {"CAB2M": 5}
    # CCA53: 50 on hand - 5 allocated = 45; minus 20 (CAS123) and 20 (CAS234) leaves 5; CAS321 needs 15
    assert target["shortages"] == {"CCA53": 10}
    assert target["max_buildable_from_remaining_stock"] == 1
    assert target["shortage_items_on_order"] == {"CCA53": 40}


def test_on_order_counts_when_asked():
    r = check_builds(erp, [{"item": "CAS321", "qty": 25}], include_on_order=True)
    assert r["builds"][0]["shortages"].get("CCA53") is None  # 45 + 40 on order covers 75


def test_subassembly_stock_used_before_building_more():
    # CAS321 needs 2x SUB10 each; 4 in stock, so 3 units => 2 more SUB10 built => 10m WIRE1
    rows = explode_bom(erp, "CAS321", 3)
    assert {"level": 2, "parent": "SUB10", "component": "WIRE1", "qty_per": 5.0, "total_qty": 30.0} in rows


def test_unknown_item():
    assert "error" in check_builds(erp, [{"item": "NOPE", "qty": 1}])["builds"][0]


def test_digest(tmp_path):
    mem = Memory(str(tmp_path / "m.db"))
    mem.add_action("Chase CCA53 PO", owner="Sam", due="2020-01-01")
    text = daily_digest(erp, mem)
    assert "Chase CCA53 PO" in text
    assert any(r["item"] == "CCA53" for r in stock_risks(erp))
