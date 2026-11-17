"""Deterministic build/shortage maths. The LLM never does this arithmetic itself; it calls these.

Rules (stated back to the user in every answer):
- Available = on hand - allocated. On-order stock is only counted if include_on_order=True.
- Builds are processed in the order given; each one consumes stock before the next is checked.
- Components are taken from stock first. If a 'make' sub-assembly runs out, the shortfall is
  exploded into its own BOM (assumes you'd build more sub-assemblies). Bought-in parts that run
  out are reported as shortages.
- The finished item you're building is never taken from its own stock (you asked to build new ones).
"""
from collections import defaultdict
from dataclasses import dataclass, field

from .erp import ErpBackend

MAX_DEPTH = 20


@dataclass
class BuildResult:
    item: str
    qty: float
    ok: bool
    shortages: dict[str, float] = field(default_factory=dict)
    consumed: dict[str, float] = field(default_factory=dict)
    max_buildable: int = 0


class Simulator:
    def __init__(self, erp: ErpBackend, include_on_order: bool = False):
        self.erp = erp
        self.include_on_order = include_on_order
        self._avail: dict[str, float] = {}
        self._bom: dict[str, list[tuple[str, float]]] = {}

    def bom(self, code: str):
        if code not in self._bom:
            self._bom[code] = self.erp.get_bom(code)
        return self._bom[code]

    def available(self, code: str) -> float:
        if code not in self._avail:
            s = self.erp.get_stock(code)
            self._avail[code] = max(0.0, s.available + (s.on_order if self.include_on_order else 0))
        return self._avail[code]

    def snapshot(self) -> dict[str, float]:
        return dict(self._avail)

    def restore(self, snap: dict[str, float]):
        self._avail = dict(snap)

    def build(self, item: str, qty: float, shortages, consumed, depth=0):
        if depth > MAX_DEPTH:
            raise RuntimeError(f"BOM for {item} is too deep or circular")
        lines = self.bom(item)
        if not lines:
            raise ValueError(f"{item} has no BOM, so it can't be built")
        for comp, per in lines:
            self.consume(comp, qty * per, shortages, consumed, depth + 1)

    def consume(self, code: str, need: float, shortages, consumed, depth):
        take = min(self.available(code), need)
        if take:
            self._avail[code] -= take
            consumed[code] += take
        short = need - take
        if short > 1e-9:
            if self.bom(code):
                self.build(code, short, shortages, consumed, depth)
            else:
                shortages[code] += short

    def try_build(self, item: str, qty: float) -> BuildResult:
        shortages, consumed = defaultdict(float), defaultdict(float)
        self.build(item, qty, shortages, consumed)
        return BuildResult(item, qty, not shortages, dict(shortages), dict(consumed))

    def max_buildable(self, item: str, cap: int = 100000) -> int:
        """Largest whole quantity of `item` buildable from current simulated stock."""
        snap = self.snapshot()

        def fits(n):
            self.restore(snap)
            ok = self.try_build(item, n).ok
            return ok

        lo, hi = 0, 1
        while hi <= cap and fits(hi):
            lo, hi = hi, hi * 2
        hi = min(hi, cap + 1)
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if fits(mid):
                lo = mid
            else:
                hi = mid
        self.restore(snap)
        return lo


def check_builds(erp: ErpBackend, builds: list[dict], include_on_order: bool = False) -> dict:
    """builds: [{"item": "CAS123", "qty": 10}, ...] processed in order."""
    sim = Simulator(erp, include_on_order)
    results = []
    for b in builds:
        item, qty = str(b["item"]).strip().upper(), float(b["qty"])
        if erp.get_item(item) is None and not erp.get_bom(item):
            results.append({"item": item, "error": f"Unknown item {item}"})
            continue
        max_n = sim.max_buildable(item)
        r = sim.try_build(item, qty)  # consumes stock (as far as it goes) for the next build
        on_order = {c: erp.get_stock(c).on_order for c in r.shortages}
        results.append(
            {
                "item": item,
                "qty": qty,
                "enough_stock": r.ok,
                "max_buildable_from_remaining_stock": max_n,
                "shortages": {c: round(q, 3) for c, q in sorted(r.shortages.items())},
                "shortage_items_on_order": {c: q for c, q in on_order.items() if q},
            }
        )
    return {
        "assumptions": "available = on hand - allocated"
        + (" + on order" if include_on_order else " (on-order NOT counted)")
        + "; builds checked in the order given, each consuming stock before the next.",
        "builds": results,
    }


def explode_bom(erp: ErpBackend, item: str, qty: float = 1, multi_level: bool = True) -> list[dict]:
    out, seen = [], set()

    def walk(code, q, level):
        if level > MAX_DEPTH:
            raise RuntimeError("BOM too deep or circular")
        for comp, per in erp.get_bom(code):
            out.append({"level": level, "parent": code, "component": comp, "qty_per": per, "total_qty": q * per})
            if multi_level:
                walk(comp, q * per, level + 1)

    walk(item.strip().upper(), qty, 1)
    return out
