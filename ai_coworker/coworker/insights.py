"""The 'ongoing analysis' part: deterministic checks a scheduled job runs and posts to the team chat."""
from .erp import ErpBackend
from .memory import Memory

SAFETY_DAYS = 14


def stock_risks(erp: ErpBackend, top: int = 15) -> list[dict]:
    """Bought-in items whose stock won't last until a new order could arrive, or that are below min."""
    risks = []
    for it in erp.list_items():
        if it.type == "make":
            continue
        s = erp.get_stock(it.code)
        yearly = erp.get_usage(it.code, 365)
        daily = yearly / 365
        cover = s.available / daily if daily else None
        reasons = []
        if cover is not None and cover < it.lead_time_days + SAFETY_DAYS:
            reasons.append(f"{cover:.0f} days cover vs {it.lead_time_days}d lead time")
        if it.min_stock and s.available < it.min_stock:
            reasons.append(f"available {s.available:g} below min {it.min_stock:g}")
        if reasons:
            risks.append(
                {
                    "item": it.code,
                    "description": it.description,
                    "available": s.available,
                    "on_order": s.on_order,
                    "usage_per_year": yearly,
                    "days_cover": None if cover is None else round(cover),
                    "why": "; ".join(reasons),
                }
            )
    risks.sort(key=lambda r: r["days_cover"] if r["days_cover"] is not None else 1e9)
    return risks[:top]


def daily_digest(erp: ErpBackend, mem: Memory) -> str:
    lines = ["**Morning digest**", ""]
    risks = stock_risks(erp)
    if risks:
        lines.append(f"**Stock at risk ({len(risks)})**")
        for r in risks:
            oo = f", {r['on_order']:g} on order" if r["on_order"] else ", nothing on order"
            lines.append(f"- {r['item']} ({r['description']}): {r['available']:g} available{oo} - {r['why']}")
    else:
        lines.append("No stock risks found.")
    overdue = mem.overdue_actions()
    lines.append("")
    if overdue:
        lines.append(f"**Overdue actions ({len(overdue)})**")
        for a in overdue:
            lines.append(f"- #{a['id']} {a['description']} - {a['owner'] or 'unassigned'}, due {a['due']}")
    else:
        lines.append("No overdue actions.")
    issues = mem.list_issues("open")
    if issues:
        lines.append("")
        lines.append(f"**Open production issues ({len(issues)})**")
        for i in issues[:10]:
            lines.append(f"- #{i['id']} [{i['severity']}] {i['title']}")
    return "\n".join(lines)
