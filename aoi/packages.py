"""Package library: derive body / pad geometry from PnP package or part names.

All dimensions in mm. Body is length (along component X, pin-1 to pin-2 axis for
2-terminal parts) x width. Pads are given as rectangles in body coordinates
(centre x, centre y, length, width).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict

# Imperial chip code -> (body L, body W)
CHIP = {
    "01005": (0.4, 0.2), "0201": (0.6, 0.3), "0402": (1.0, 0.5), "0603": (1.6, 0.8),
    "0805": (2.0, 1.25), "1206": (3.2, 1.6), "1210": (3.2, 2.5), "1812": (4.5, 3.2),
    "2010": (5.0, 2.5), "2220": (5.7, 5.0), "2512": (6.3, 3.2),
}
TANT = {"A": (3.2, 1.6), "B": (3.5, 2.8), "C": (6.0, 3.2), "D": (7.3, 4.3), "E": (7.3, 4.3)}


@dataclass
class Package:
    name: str
    body_l: float = 2.0
    body_w: float = 1.25
    pads: list = field(default_factory=list)  # [cx, cy, l, w]
    polarized: bool = False
    marking: bool = False  # has readable top marking (OCV)
    kind: str = "generic"

    def extent(self):
        """Half sizes (x, y) of body + pads bounding box."""
        hx, hy = self.body_l / 2, self.body_w / 2
        for cx, cy, l, w in self.pads:
            hx = max(hx, abs(cx) + l / 2)
            hy = max(hy, abs(cy) + w / 2)
        return hx, hy

    def to_dict(self):
        return asdict(self)

    @staticmethod
    def from_dict(d):
        return Package(**{k: d[k] for k in Package.__dataclass_fields__ if k in d})


def _two_term(name, l, w, polarized=False, kind="chip"):
    pl = max(0.2, l * 0.3)
    pads = [[-l / 2, 0, pl, w * 1.05], [l / 2, 0, pl, w * 1.05]]
    return Package(name, l, w, pads, polarized, False, kind)


def _dual_row(name, n, pitch, body_l, body_w, lead_len, pad_w, marking=True, kind="ic"):
    """Gull-wing dual row (SOIC/TSSOP/SOT): pins along X, rows at +/- Y."""
    per = n // 2
    pads = []
    y = body_w / 2 + lead_len / 2
    x0 = -(per - 1) * pitch / 2
    for i in range(per):
        pads.append([x0 + i * pitch, y, pad_w, lead_len])
    for i in range(per):
        pads.append([x0 + i * pitch, -y, pad_w, lead_len])
    return Package(name, body_l, body_w, pads, True, marking, kind)


def _quad(name, n, pitch, body, lead_len, pad_w, kind="qfp"):
    per = n // 4
    pads = []
    off = body / 2 + lead_len / 2
    x0 = -(per - 1) * pitch / 2
    for i in range(per):
        p = x0 + i * pitch
        pads += [[p, off, pad_w, lead_len], [p, -off, pad_w, lead_len]]
        pads += [[off, p, lead_len, pad_w], [-off, p, lead_len, pad_w]]
    return Package(name, body, body, pads, True, True, kind)


def derive(package_name: str, part_name: str = "") -> Package:
    """Best-effort package geometry from free-text package / part names."""
    raw = f"{package_name} {part_name}".upper()
    name = (package_name or part_name or "UNKNOWN").strip()

    raw = re.sub(r"\bMF05A\b|\bDBV\b", "SOT-23-5", raw)
    m = re.search(r"SOT-?23-?(\d)?", raw)
    if m:
        pins = int(m.group(1) or 3)
        if pins == 3:
            return Package(name, 2.9, 1.3, [[-0.95, -1.1, 0.6, 0.8], [0.95, -1.1, 0.6, 0.8], [0, 1.1, 0.6, 0.8]], True, True, "sot")
        return _dual_row(name, 6 if pins >= 5 else pins, 0.95, 2.9, 1.6, 0.8, 0.6, kind="sot")
    if "SOT-223" in raw or "SOT223" in raw:
        return Package(name, 6.5, 3.5, [[-2.3, -3.2, 1.0, 1.5], [0, -3.2, 1.0, 1.5], [2.3, -3.2, 1.0, 1.5], [0, 3.2, 3.2, 1.5]], True, True, "sot")
    if "SOT-89" in raw or "SOT89" in raw:
        return Package(name, 4.5, 2.5, [[-1.5, -1.8, 0.6, 1.0], [0, -1.8, 0.6, 1.0], [1.5, -1.8, 0.6, 1.0]], True, True, "sot")
    for code, (l, w) in (("SOD-123", (2.7, 1.6)), ("SOD123", (2.7, 1.6)), ("SOD-323", (1.7, 1.25)),
                         ("SOD323", (1.7, 1.25)), ("SOD-523", (1.2, 0.8)), ("MINIMELF", (3.5, 1.5)),
                         ("SMA", (4.3, 2.6)), ("SMB", (4.3, 3.6)), ("SMC", (6.9, 5.9))):
        if re.search(rf"\b{code}\b", raw):
            return _two_term(name, l, w, True, "diode")
    m = re.search(r"\b(?:D2PAK|TO-?263)\b", raw)
    if m:
        return Package(name, 10.0, 9.0, [[0, 5.5, 8.0, 3.0], [-2.54, -5.5, 1.0, 2.0], [2.54, -5.5, 1.0, 2.0]], True, True, "power")
    if re.search(r"\b(?:DPAK|TO-?252)\b", raw):
        return Package(name, 6.5, 6.1, [[0, 3.8, 5.5, 2.0], [-2.3, -3.8, 1.0, 1.6], [2.3, -3.8, 1.0, 1.6]], True, True, "power")
    m = re.search(r"\b(SOIC|SOP|SO)-?(\d+)", raw)
    if m:
        n = int(m.group(2))
        wide = bool(re.search(r"-300|WIDE|\bW\b", raw)) or n >= 20
        return _dual_row(name, n, 1.27, n / 2 * 1.27, 7.5 if wide else 3.9, 1.5, 0.6)
    m = re.search(r"\b(TSSOP|MSOP|SSOP)-?(\d+)", raw)
    if m:
        n = int(m.group(2))
        pitch = 0.5 if m.group(1) == "MSOP" else 0.65
        return _dual_row(name, n, pitch, max(3.0, n / 2 * pitch + 0.5), 4.4 if m.group(1) != "MSOP" else 3.0, 1.2, pitch * 0.55)
    m = re.search(r"\b(\d+)PIN[\W_]*[A-Z]*QFP", raw)
    if m:
        raw = f"QFP-{m.group(1)} " + raw
    m = re.search(r"\bSOJ-?(\d+)", raw)
    if m:
        n = int(m.group(1))
        return _dual_row(name, n, 1.27, n / 2 * 1.27 + 0.5, 7.5, 1.2, 0.6)
    if re.search(r"\b(SSOT-?6|SC-?70|SOT-?363)", raw):
        return _dual_row(name, 6, 0.65, 2.0, 1.25, 0.6, 0.4, kind="sot")
    if re.search(r"\b(6032|7343|3528|3216)\b", raw):
        l, w = {"6032": TANT["C"], "7343": TANT["D"], "3528": TANT["B"], "3216": TANT["A"]}[re.search(r"(6032|7343|3528|3216)", raw).group(1)]
        return _two_term(name, l, w, True, "tant")
    m = re.search(r"\b(LQFP|TQFP|QFP)-?(\d+)", raw)
    if m:
        n = int(m.group(2))
        pitch = 0.5 if n >= 64 else 0.8
        body = round((n / 4) * pitch + 1.0)
        return _quad(name, n, pitch, body, 1.2, pitch * 0.55)
    m = re.search(r"\b(QFN|DFN|VQFN|WQFN)-?(\d+)", raw)
    if m:
        n = int(m.group(2))
        pitch = 0.5
        body = max(2.0, round((n / 4) * pitch + 1.0))
        p = _quad(name, n, pitch, body, 0.6, 0.3, "qfn")
        p.pads = [[x * (body / 2 - 0.3) / abs(x) if abs(x) > body / 2 else x,
                   y * (body / 2 - 0.3) / abs(y) if abs(y) > body / 2 else y, l, w] for x, y, l, w in p.pads]
        return p
    m = re.search(r"(?:TANT\w*|CASE)[ _-]?(?:\d{4}[ _-]?)?\(?([A-E])\b", raw)
    if m:
        l, w = TANT[m.group(1)]
        return _two_term(name, l, w, True, "tant")
    m = re.search(r"(?<!\d)(01005|0201|0402|0603|0805|1206|1210|1812|2010|2220|2512)(?!\d)", raw)
    if m:
        l, w = CHIP[m.group(1)]
        pol = bool(re.search(r"\bLED\b|\bD\d|DIODE", raw))
        return _two_term(name, l, w, pol, "led" if pol else "chip")
    if re.search(r"\bFID|FIDUCIAL", raw):
        return Package(name, 1.0, 1.0, [], False, False, "fiducial")
    return Package(name, 2.0, 1.25, [[-1.0, 0, 0.6, 1.3], [1.0, 0, 0.6, 1.3]], False, False, "generic")
