"""Import pick-and-place placement lists (MYData / TPSys exports, CAD CSV, KiCad .pos, Altium)."""
from __future__ import annotations

import csv
import io
import re

ALIASES = {
    "ref": ["ref", "refdes", "designator", "reference", "ref des", "name", "comp", "component id", "id", "pos"],
    "x": ["x", "posx", "pos x", "mid x", "center-x(mm)", "centerx", "x (mm)", "xpos", "x-coord", "x coord", "ref x"],
    "y": ["y", "posy", "pos y", "mid y", "center-y(mm)", "centery", "y (mm)", "ypos", "y-coord", "y coord", "ref y"],
    "rot": ["rot", "rotation", "angle", "theta", "orientation", "rotate", "a"],
    "part": ["part", "val", "value", "component", "comp name", "partnumber", "part number", "comment", "article", "device"],
    "package": ["package", "footprint", "pkg", "case", "package name", "pattern", "shape"],
    "side": ["side", "layer", "tb", "mount side"],
}


def _norm(h):
    return re.sub(r"\s+", " ", h.strip().lower().replace("_", " ").replace('"', ""))


def _num(s):
    s = str(s).strip().lower().replace(",", ".")
    m = re.match(r"^[-+]?\d*\.?\d+(e[-+]?\d+)?", s.replace("mm", "").replace("mil", "").strip())
    return float(m.group(0)) if m else None


def _split(line, delim):
    if delim == "ws":
        return next(csv.reader([re.sub(r"\s+", " ", line.strip())], delimiter=" ", skipinitialspace=True))
    return [c.strip() for c in next(csv.reader([line], delimiter=delim))]


def parse(text: str, units: str = "auto", y_up: bool = True) -> dict:
    """Return {'components': [...], 'units': str, 'warnings': [...]}."""
    lines = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith(("#", "//", ";"))]
    if not lines:
        raise ValueError("Empty placement file")
    sample = "\n".join(lines[:20])
    delim = max([",", ";", "\t"], key=sample.count)
    if sample.count(delim) < len(lines[:20]):
        delim = "ws"
    header_idx, cols = None, {}
    for i, line in enumerate(lines[:15]):
        cells = [_norm(c) for c in _split(line, delim)]
        found = {}
        for key, names in ALIASES.items():
            for j, c in enumerate(cells):
                if c in names and j not in found.values():
                    found[key] = j
                    break
        if {"ref", "x", "y"} <= found.keys():
            header_idx, cols = i, found
            break
    warnings = []
    if header_idx is None:
        # KiCad-like fixed order: Ref Val Package PosX PosY Rot Side
        warnings.append("No header found - assumed column order Ref, Value, Package, X, Y, Rot, Side")
        header_idx, cols = -1, {"ref": 0, "part": 1, "package": 2, "x": 3, "y": 4, "rot": 5, "side": 6}
    comps = []
    for line in lines[header_idx + 1:]:
        cells = _split(line, delim)
        try:
            x, y = _num(cells[cols["x"]]), _num(cells[cols["y"]])
        except IndexError:
            continue
        if x is None or y is None:
            continue
        get = lambda k, d="": cells[cols[k]].strip() if k in cols and cols[k] < len(cells) else d
        rot = _num(get("rot", "0")) or 0.0
        comps.append({"ref": get("ref"), "x": x, "y": y, "rot": rot % 360,
                      "part": get("part"), "package": get("package") or get("part"),
                      "side": get("side", "top").lower()})
    if not comps:
        raise ValueError("No placements recognised - check the file has Ref/X/Y columns")
    if units == "auto":
        span = max(max(abs(c["x"]), abs(c["y"])) for c in comps)
        units = "um" if span > 2000 else ("mil" if "mil" in text.lower() else "mm")
        if units != "mm":
            warnings.append(f"Coordinates look like {units} - converted to mm")
    scale = {"mm": 1.0, "um": 0.001, "mil": 0.0254, "inch": 25.4}[units]
    for c in comps:
        c["x"] = round(c["x"] * scale, 4)
        c["y"] = round(c["y"] * scale, 4)
    bottom = [c for c in comps if c["side"].startswith("b")]
    if bottom:
        warnings.append(f"{len(bottom)} bottom-side placements skipped")
        comps = [c for c in comps if not c["side"].startswith("b")]
    return {"components": comps, "units": units, "warnings": warnings}


def parse_file(data: bytes, **kw) -> dict:
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return parse(data.decode(enc), **kw)
        except UnicodeDecodeError:
            continue
    raise ValueError("Cannot decode file")
