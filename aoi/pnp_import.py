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
    "ipn": ["ipn", "internal part number", "internal pn", "stock code", "part code", "item", "item number", "sku"],
    "z": ["z", "rot z", "rz"],
}


def _norm(h):
    return re.sub(r"\s+", " ", h.strip().lower().replace("_", " ").replace('"', ""))


def _num(s):
    s = str(s).strip().lower()
    if s.count(",") > 1 or (s.count(",") == 1 and s.count(".") == 1):
        s = s.replace(",", "")  # thousands separators (Excel / Altium exports)
    s = s.replace(",", ".")
    m = re.match(r"^[-+]?\d*\.?\d+(e[-+]?\d+)?", s.replace("mm", "").replace("mil", "").strip())
    return float(m.group(0)) if m else None


def _split(line, delim):
    if delim == "ws":
        return next(csv.reader([re.sub(r"\s+", " ", line.strip())], delimiter=" ", skipinitialspace=True))
    return [c.strip() for c in next(csv.reader([line], delimiter=delim))]


def parse(text: str, units: str = "auto", y_up: bool = True, board=None, machine_cmp=None) -> dict:
    """Return {'components': [...], 'units': str, 'warnings': [...]}."""
    if is_mydata(text):
        return parse_mydata(text, board=board, machine_cmp=machine_cmp)
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
        rot = _num(get("rot", "") or get("z", "0")) or 0.0  # no rotation column: Z = rotation
        comps.append({"ref": get("ref"), "x": x, "y": y, "rot": rot % 360,
                      "part": get("part"), "package": get("package") or get("part"),
                      "side": get("side", "top").lower(), "ipn": get("ipn")})
    if not comps:
        raise ValueError("No placements recognised - check the file has Ref/X/Y columns")
    scale = None
    if units == "auto":
        span = max(max(c["x"] for c in comps) - min(c["x"] for c in comps),
                   max(c["y"] for c in comps) - min(c["y"] for c in comps))
        header = lines[header_idx].lower() if header_idx >= 0 else ""
        if "mil" in header or "mil" in text[:500].lower():
            units = "mil"
        elif "(mm)" in header or "mm" in header:
            units = "mm"
            big = max(max(abs(c["x"]), abs(c["y"])) for c in comps)
            if big > 5000:  # "mm" column but decimal point lost (Altium writes 4 decimals)
                scale = 1.0
                while big * scale > 2000:
                    scale /= 10
                warnings.append(f"Coordinates had no decimal point - scaled x{scale:g} to mm, please check board size")
        else:
            units = "um" if span > 2000 else "mm"
        if units not in ("mm",):
            warnings.append(f"Coordinates look like {units} - converted to mm")
    scale = scale or {"mm": 1.0, "um": 0.001, "mil": 0.0254, "inch": 25.4}[units]
    for c in comps:
        c["x"] = round(c["x"] * scale, 4)
        c["y"] = round(c["y"] * scale, 4)
    bottom = [c for c in comps if c["side"].startswith("b")]
    if bottom:
        warnings.append(f"{len(bottom)} bottom-side placements skipped")
        comps = [c for c in comps if not c["side"].startswith("b")]
    return {"components": comps, "units": units, "warnings": warnings}


def parse_file(data: bytes, **kw) -> dict:
    encs = ("utf-16", "utf-8-sig", "latin-1") if data[:2] in (b"\xff\xfe", b"\xfe\xff") or data[1:2] == b"\x00" else ("utf-8-sig", "utf-16", "latin-1")
    for enc in encs:
        try:
            return parse(data.decode(enc), **kw)
        except UnicodeDecodeError:
            continue
    raise ValueError("Cannot decode file")


# ---------------------------------------------------------------- user-defined formats (BOM / placement templates)
FIELDS = ["ref", "x", "y", "rot", "part", "package", "ipn", "side"]
DELIMS = {"auto": None, "comma": ",", "semicolon": ";", "tab": "\t", "space": "ws", "pipe": "|"}


def raw_rows(text, delim="auto", max_rows=None):
    """Split text into rows of cells using the chosen delimiter (no header logic)."""
    lines = [l for l in text.splitlines() if l.strip()]
    if delim == "auto" or delim is None:
        sample = "\n".join(lines[:30])
        d = max([",", ";", "\t", "|"], key=sample.count)
        delim = d if sample.count(d) >= len(lines[:30]) else "ws"
    else:
        delim = DELIMS.get(delim, delim)
    rows = [_split(l, delim) for l in (lines if max_rows is None else lines[:max_rows])]
    return rows, delim


def guess_mapping(header):
    cells = [_norm(c) for c in header]
    m = {}
    for key, names in {**ALIASES, "z": ["z"]}.items():
        for j, c in enumerate(cells):
            if c in names and j not in m.values():
                m["rot" if key == "z" and "rot" not in m else key] = j
                break
    m.pop("z", None)
    return m


def parse_with_format(text, fmt):
    """fmt = {delimiter, skip_rows, header_row (index after skip, -1 = none), columns {field: col index},
              units, rot_offset, flip_x, flip_y, drop: [{col, op: empty|equals|contains|regex, value}],
              bottom_skip (bool)}"""
    rows, _ = raw_rows(text, fmt.get("delimiter", "auto"))
    rows = rows[int(fmt.get("skip_rows", 0)):]
    hr = int(fmt.get("header_row", 0))
    header = rows[hr] if hr >= 0 and hr < len(rows) else []
    body = rows[hr + 1:] if hr >= 0 else rows
    cols = {k: int(v) for k, v in (fmt.get("columns") or guess_mapping(header)).items() if v not in (None, "", -1)}
    if not {"ref", "x", "y"} <= cols.keys():
        raise ValueError("Map at least Designator, X and Y")
    drops = fmt.get("drop", [])
    comps, dropped = [], 0

    def cell(r, k, d=""):
        return r[cols[k]].strip() if k in cols and cols[k] < len(r) else d
    for r in body:
        bad = False
        for rule in drops:
            c = int(rule.get("col", -1))
            v = r[c].strip() if 0 <= c < len(r) else ""
            op, val = rule.get("op", "empty"), str(rule.get("value", ""))
            if (op == "empty" and not v) or (op == "equals" and v.lower() == val.lower()) or \
               (op == "contains" and val.lower() in v.lower()) or (op == "regex" and re.search(val, v, re.I)):
                bad = True
                break
        x, y = _num(cell(r, "x")), _num(cell(r, "y"))
        if bad or x is None or y is None or not cell(r, "ref"):
            dropped += 1
            continue
        rot = (_num(cell(r, "rot", "0")) or 0.0) + float(fmt.get("rot_offset", 0))
        comps.append({"ref": cell(r, "ref"), "x": -x if fmt.get("flip_x") else x, "y": -y if fmt.get("flip_y") else y,
                      "rot": rot % 360, "part": cell(r, "part"), "package": cell(r, "package") or cell(r, "part"),
                      "side": cell(r, "side", "top").lower(), "ipn": cell(r, "ipn")})
    if not comps:
        raise ValueError("No rows left - check delimiter / header row / mapping / drop rules")
    units = fmt.get("units", "auto")
    warnings = [f"{dropped} rows dropped"] if dropped else []
    if units == "auto":
        big = max(max(abs(c["x"]), abs(c["y"])) for c in comps)
        units = "um" if big > 5000 else "mm"
    scale = {"mm": 1.0, "um": 0.001, "mil": 0.0254, "inch": 25.4, "cm": 10.0}[units]
    for c in comps:
        c["x"], c["y"] = round(c["x"] * scale, 4), round(c["y"] * scale, 4)
    if fmt.get("bottom_skip", True):
        n = len(comps)
        comps = [c for c in comps if not c["side"].startswith("b")]
        if n - len(comps):
            warnings.append(f"{n - len(comps)} bottom-side placements skipped")
    return {"components": comps, "units": units, "warnings": warnings, "header": header, "columns": cols}


def header_signature(text, fmt):
    rows, _ = raw_rows(text, fmt.get("delimiter", "auto"), 40)
    rows = rows[int(fmt.get("skip_rows", 0)):]
    hr = int(fmt.get("header_row", 0))
    return "|".join(_norm(c) for c in rows[hr]) if 0 <= hr < len(rows) else ""


# ---------------------------------------------------------------- BOM (IPN + designators, no XY)
TH_REF = re.compile(r"^(J|JS|JT|JP|P|SW|X|GDT|PCB|H|MH|TP|BT|F|K|CN|CON|T)\d*$", re.I)
TH_IPN = re.compile(r"^(CCO|CSW|CPCB|CPC\d|CGA|CCR|CBAT|CRL)", re.I)


def expand_refs(cell):
    """'R24 , R53 ,R60 - R66, J2 (ICSP)' -> [R24, R53, R60..R66, J2]"""
    out = []
    cell = re.sub(r"\([^)]*\)", "", cell)
    for part in re.split(r"[,;/]+|\s{2,}", cell):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^([A-Za-z]+)(\d+)\s*[-–~]\s*([A-Za-z]*)(\d+)$", part.replace(" ", ""))
        if m and (not m.group(3) or m.group(3).upper() == m.group(1).upper()) and int(m.group(4)) - int(m.group(2)) < 500:
            out += [f"{m.group(1)}{i}" for i in range(int(m.group(2)), int(m.group(4)) + 1)]
        else:
            out += [p for p in part.split() if p]
    return out


def parse_bom(text):
    """Returns {'items': [{ipn, qty, refs, th}], 'refs': {ref: {ipn, th}}, 'warnings': []}"""
    rows, _ = raw_rows(text, "auto")
    hi, cols = 0, {}
    for i, r in enumerate(rows[:15]):
        cells = [_norm(c) for c in r]
        ipn = next((j for j, c in enumerate(cells) if c in ("item code", "ipn", "part number", "stock code", "item", "part", "code")), None)
        des = next((j for j, c in enumerate(cells) if c in ("designator", "designators", "refdes", "reference", "references", "ref", "u1", "location", "locations")), None)
        if ipn is not None and des is not None:
            hi, cols = i, {"ipn": ipn, "des": des}
            qty = next((j for j, c in enumerate(cells) if "qty" in c or "quantity" in c), None)
            cols["qty"] = qty
            # extra designator columns (U2..Un in Accentis exports)
            cols["more"] = [j for j, c in enumerate(cells) if re.fullmatch(r"u\d+", c) and j != des]
            break
    if not cols:
        raise ValueError("BOM needs an item/IPN column and a designator column")
    items, refs, warn = [], {}, []
    for r in rows[hi + 1:]:
        if len(r) <= max(cols["ipn"], cols["des"]):
            continue
        ipn = r[cols["ipn"]].strip()
        cells = [r[cols["des"]]] + [r[j] for j in cols["more"] if j < len(r)]
        rl = [x for c in cells for x in expand_refs(c)]
        if not ipn or not rl:
            continue
        qty = _num(r[cols["qty"]]) if cols["qty"] is not None and cols["qty"] < len(r) else None
        if qty and int(round(qty)) != len(rl):
            warn.append(f"{ipn}: qty {qty:g} but {len(rl)} designators")
        th = bool(TH_IPN.match(ipn)) or all(TH_REF.match(x) for x in rl)
        items.append({"ipn": ipn, "qty": qty, "refs": rl, "th": th})
        for x in rl:
            refs[x] = {"ipn": ipn, "th": th}
    return {"items": items, "refs": refs, "warnings": warn}


# ---------------------------------------------------------------- Mycronic MYData / TPSys layout (.gen)
def is_mydata(text):
    text = text.replace("\r", "")
    return bool(re.search(r"^\s*F8\s+-?\d+(\.\d+)?\s+-?\d+", text, re.M)) and bool(re.search(r"^\s*F9\s", text, re.M))


def mydata_boards(text):
    """Boards in a MYData layout file: [{name, parts, fiducials}] (a library export holds many)."""
    out = []
    for line in text.replace("\r", "").lstrip("\ufeff").splitlines():
        t = line.strip().split(None, 1)
        if not t:
            continue
        if t[0] == "F1":
            out.append({"name": (t[1] if len(t) > 1 else "").strip(), "parts": 0, "fiducials": 0})
        elif out and t[0] == "F9":
            out[-1]["parts"] += 1
        elif out and t[0] == "F3":
            out[-1]["fiducials"] += 1
    return out


def _fid_shape(v):
    """F3 x y <shape> [diam] -> (shape, diameter mm). Shapes: circle, TH_SQ, TH_SQ_1mm, TH_1mm ..."""
    shape = v[2] if len(v) > 2 else "circle"
    d = _num(v[3]) if len(v) > 3 else None
    if d is None:
        m = re.search(r"(\d+(?:\.\d+)?)\s*mm", shape, re.I)
        d = float(m.group(1)) if m else 1.0
    kind = "square" if re.search(r"SQ|RECT|SQUARE", shape, re.I) else "circle"
    return kind, d


def parse_mydata(text, board=None, machine_cmp=None):
    """MYData layout export: F1 board, F3 fiducials, F8 x y rot(mdeg) ... IPN / F9 ref, C00 IPN C01 package C02 description.
    Coordinates are micrometres; rotation in thousandths of a degree. Only machine-placed parts are listed.
    A file with several F1 boards needs *board* (name); otherwise ValueError lists them."""
    comps, fids, comp_info = [], [], {}
    pending = None
    cur = None
    text = text.replace("\r", "").lstrip("\ufeff")
    boards = mydata_boards(text)
    if board is None:
        if len(boards) > 1:
            e = ValueError(f"This .gen holds {len(boards)} boards - pick one")
            e.boards = boards
            raise e
        board = boards[0]["name"] if boards else ""
    elif boards and board not in [b["name"] for b in boards]:
        raise ValueError(f"Board '{board}' not in file")
    active = not boards  # no F1 at all: take everything
    for line in text.splitlines():
        t = line.strip().split(None, 1)
        if not t:
            continue
        key, rest = t[0], (t[1] if len(t) > 1 else "")
        if key == "F1":
            active = rest.strip() == board
            pending = None
        elif key == "F3" and active:
            v = rest.split()
            if len(v) >= 2:
                shape, d = _fid_shape(v)
                fids.append((float(v[0]) / 1000, float(v[1]) / 1000, d, shape))
        elif key == "F8" and active:
            v = rest.split()
            if len(v) < 2:
                continue
            ipn = next((t for t in reversed(v[3:]) if not re.fullmatch(r"[-\d.]+|[YNyn]", t)), "")
            pending = {"x": float(v[0]) / 1000, "y": float(v[1]) / 1000,
                       "rot": (float(v[2]) / 1000) % 360 if len(v) > 2 else 0.0, "ipn": ipn}
        elif key == "F9" and pending and active:
            pending["ref"] = rest.strip()
            comps.append(pending)
            pending = None
        elif key == "C00":
            cur = rest.strip()
            comp_info[cur] = {}
        elif key in ("C01", "C02") and cur:
            comp_info[cur][key] = rest.strip()
    for k, v in (machine_cmp or {}).items():
        comp_info.setdefault(k, {"C01": v.get("package", ""), "C02": v.get("description", "")})
    out = []
    for i, (x, y, d, shape) in enumerate(fids):
        out.append({"ref": f"FID{i + 1}", "x": x, "y": y, "rot": 0.0, "part": shape, "package": f"FIDUCIAL_{d:g}MM" + ("_SQ" if shape == "square" else ""),
                    "side": "top", "ipn": "", "fid_diam": d, "fid_shape": shape})
    for c in comps:
        info = comp_info.get(c["ipn"], {})
        out.append({"ref": c["ref"], "x": round(c["x"], 4), "y": round(c["y"], 4), "rot": c["rot"],
                    "part": info.get("C02", c["ipn"]), "package": info.get("C01") or c["ipn"], "side": "top", "ipn": c["ipn"]})
    if not comps:
        raise ValueError(f"No F8/F9 placements found for board '{board}'")
    return {"components": out, "units": "um", "board": board, "boards": [b["name"] for b in boards],
            "warnings": [f"MYData layout '{board}': {len(comps)} machine-placed parts, {len(fids)} fiducials"]}


# ---------------------------------------------------------------- Mycronic machine libraries
def parse_cmp(text):
    """cmp.cmp component library: C00 IPN, C01 package, C02 description -> {ipn: {package, description}}."""
    out, cur = {}, None
    for line in text.replace("\r", "").lstrip("\ufeff").splitlines():
        t = line.strip().split(None, 1)
        if not t:
            continue
        if t[0] == "C00":
            cur = (t[1] if len(t) > 1 else "").strip()
            out[cur] = {"package": "", "description": ""}
        elif cur and t[0] == "C01":
            out[cur]["package"] = (t[1] if len(t) > 1 else "").strip()
        elif cur and t[0] == "C02":
            out[cur]["description"] = (t[1] if len(t) > 1 else "").strip()
    return out


def parse_pck(text):
    """pck.gen package library -> {name: {type, body:[x,y] mm, height, leads:[{type,n,x,y,angle,len,wid,pitch}]}}.
    P01 body X Y (µm) ..., P051 <type> <count> <x> <y> <angle mdeg>, P052 len*3 width*3 pitch ..."""
    out, cur = {}, None
    for line in text.replace("\r", "").lstrip("\ufeff").splitlines():
        t = line.strip().split()
        if not t:
            continue
        k = t[0]
        if k == "P00":
            cur = {"type": "", "body": None, "height": None, "leads": []}
            out[" ".join(t[1:])] = cur
        elif cur is None:
            continue
        elif k == "P000" and len(t) > 1:
            cur["type"] = t[1]
        elif k == "P01" and len(t) >= 3:
            v = [_num(x) or 0 for x in t[1:]]
            cur["body"] = [v[0] / 1000, v[1] / 1000]
            cur["height"] = v[4] / 1000 if len(v) > 4 else None
        elif k == "P051" and len(t) >= 6:
            cur["leads"].append({"type": t[1], "n": int(_num(t[2]) or 1), "x": _num(t[3]) / 1000, "y": _num(t[4]) / 1000,
                                 "angle": (_num(t[5]) or 0) / 1000})
        elif k == "P052" and cur["leads"] and len(t) >= 8:
            v = [_num(x) or 0 for x in t[1:]]
            cur["leads"][-1].update(len=v[1] / 1000, wid=v[4] / 1000, pitch=v[6] / 1000)
    return out


def to_csv(parsed):
    """Translate any parsed placement data (e.g. a MYData .gen) to the standard template CSV."""
    import io
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["IPN", "Comment", "Designator", "Package", "X", "Y", "Rotation"])
    for c in parsed["components"]:
        w.writerow([c.get("ipn", ""), c.get("part", ""), c["ref"], c.get("package", ""), c["x"], c["y"], c.get("rot", 0)])
    return out.getvalue()
