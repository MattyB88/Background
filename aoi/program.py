"""AOI program storage, inspection run orchestration, false-call learning and history."""
from __future__ import annotations

import json
import math
import os
import re
import time
from pathlib import Path

import cv2
import numpy as np

from . import vision
from .packages import Package, derive, resize, from_machine, rot90_cw

ROOT = Path(os.environ.get("AOI_DATA", Path.home() / "aoi_data"))
MAX_REFS = 12


def _safe(name):
    n = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._")
    if not n:
        raise ValueError("Bad name")
    return n


def list_programs():
    ROOT.mkdir(parents=True, exist_ok=True)
    return sorted(p.name for p in ROOT.iterdir() if (p / "program.json").exists())


class Program:
    def __init__(self, name):
        self.name = _safe(name)
        self.dir = ROOT / self.name
        self.file = self.dir / "program.json"
        self.data = json.loads(self.file.read_text()) if self.file.exists() else {
            "name": self.name, "components": [], "packages": {}, "y_up": True, "transform": None,
            "fiducials": [], "thresholds": dict(vision.DEFAULTS), "created": time.time()}
        self.data["thresholds"] = {**vision.DEFAULTS, **self.data["thresholds"]}

    # ------------------------------------------------ persistence
    def save(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=1))
        tmp.replace(self.file)

    def path(self, *p):
        q = self.dir.joinpath(*p)
        q.parent.mkdir(parents=True, exist_ok=True)
        return q

    # ------------------------------------------------ setup
    def import_placements(self, parsed, origin="bottom_left"):
        comps = []
        mydata = parsed.get("units") == "um" and parsed.get("board") is not None
        mach = self.machine_lib()["packages"] if mydata else {}
        # rebuild geometry on re-import, but keep packages the user has tuned
        self.data["packages"] = {k: v for k, v in self.data["packages"].items() if v.get("th") or v.get("checks")}
        src = {}
        pts = [(c["x"], c["y"]) for c in parsed["components"]]
        ox, oy = (min(p[0] for p in pts), min(p[1] for p in pts)) if origin == "bottom_left" and pts else (0.0, 0.0)
        self.data["origin_shift"] = [ox, oy]
        self.data["board"] = parsed.get("board") or ""
        for c in parsed["components"]:
            c = {**c, "x": round(c["x"] - ox, 4), "y": round(c["y"] - oy, 4)}
            pkg_name = c["package"] or "UNKNOWN"
            if pkg_name not in self.data["packages"]:
                lib = self.library()
                # machine layouts carry long descriptions: derive geometry from the package name only
                hint = "" if mydata else c["part"]
                if pkg_name in lib:
                    d, src[pkg_name] = lib[pkg_name], "library"
                elif pkg_name in mach and not c["ref"].upper().startswith("FID"):
                    d, src[pkg_name] = from_machine(pkg_name, mach[pkg_name]).to_dict(), "machine"
                else:
                    d, src[pkg_name] = derive(pkg_name, hint).to_dict(), "derived"
                    if mydata:  # Mycronic 0 deg: chips/ICs are turned 90 deg vs the derived (IPC) frame
                        d = rot90_cw(d)
                d["source"] = src[pkg_name]
                self.data["packages"][pkg_name] = d
            fid = self.data["packages"][pkg_name]["kind"] == "fiducial" or c["ref"].upper().startswith("FID")
            kind = self.data["packages"][pkg_name]["kind"]
            polar_part = bool(re.search(r"\bLED\b|DIODE|ZENER|TVS|TRANSORB|SCHOTTKY|TANT|ELECTROLYTIC", (c.get("part") or "").upper()))
            dnf = bool(re.search(r"\bDNF\b|\bDNP\b|\bNF\b", c["part"].upper()))
            has_ipn_col = any(x.get("ipn") for x in parsed["components"])
            nonpart = bool(re.match(r"^(H|MH|HOLE|TP|TEST|MTG|MT)\d", c["ref"].upper())) or kind == "fiducial"
            skip = dnf or nonpart or (has_ipn_col and not c.get("ipn"))
            from_layout = parsed.get("board") is not None  # machine layout (MYData): every row is a placed SMD part
            pk = self.data["packages"][pkg_name]
            own_checks = None
            if polar_part and not pk["polarized"] and kind not in ("fiducial",):
                own_checks = {"presence": True, "polarity": True, "ocv": False, "offset": True, "bridge": len(pk["pads"]) >= 4}
            comps.append({**c, "package": pkg_name, "fiducial": fid, "enabled": not (fid or skip or (kind == "generic" and not from_layout)), "from_layout": from_layout,
                          "dnf": dnf, "dx": 0, "dy": 0, "polar_part": polar_part,
                          "checks": own_checks, "th": {}})
        self.data["components"] = comps
        self.data["transform"] = None
        self.data["fid_marks"] = {}
        self.data["adjust"] = {"dx": 0.0, "dy": 0.0, "rot": 0.0, "scale": 1.0}
        self.data["y_up"] = True
        self.save()
        return {k: sum(1 for v in src.values() if v == k) for k in ("machine", "library", "derived")}

    def pkg(self, name) -> Package:
        return Package.from_dict(self.data["packages"][name])

    def eff(self, c):
        """Part + package with the body offset applied: ROI centred on the body, pads shifted back onto the lands.
        Offset = package body_off + the part's own body_dx/body_dy (mm, part frame)."""
        pk = self.pkg(c["package"])
        bo = pk.body_off or [0, 0]
        ox, oy = bo[0] + c.get("body_dx", 0), bo[1] + c.get("body_dy", 0)
        if not (ox or oy):
            return c, pk
        r = math.radians(c["rot"])
        bx, by = ox * math.cos(r) - oy * math.sin(r), ox * math.sin(r) + oy * math.cos(r)
        c = {**c, "dx": c.get("dx", 0) + bx, "dy": c.get("dy", 0) + by}
        pk.pads = [[x - ox, y - oy, l, w] for x, y, l, w in pk.pads]
        return c, pk

    def set_golden(self, img):
        cv2.imwrite(str(self.path("golden.png")), img)
        self.data["transform"] = None
        self.save()

    def golden(self):
        p = self.dir / "golden.png"
        return cv2.imread(str(p)) if p.exists() else None

    def teach(self, points):
        """points: [{ref, px, py}] - user clicked (or auto found) locations of >=2 references."""
        comps = {c["ref"]: c for c in self.data["components"]}
        yu = self.data["y_up"]
        src = [vision.mm_src(comps[p["ref"]]["x"], comps[p["ref"]]["y"], yu) for p in points]
        dst = [(p["px"], p["py"]) for p in points]
        M = vision.similarity_from_pairs(src, dst)
        self.data["transform"] = M.tolist()
        self.data["fiducials"] = [p["ref"] for p in points]
        self.save()
        return M

    def auto_teach(self):
        r = self.find_fiducials(fresh=True, overwrite=True)
        if not r["fit"]:
            raise ValueError("Fiducials not found automatically - click them on the image")
        return self.M0

    def autofit(self, package):
        """Set body size of *package* from the golden image (median over all its placements)."""
        img, M = self.golden(), self.M
        if img is None or M is None:
            raise ValueError("Align the board first")
        ppm = vision.px_per_mm(M)
        pkg = self.pkg(package)
        sizes = []
        for c in self.data["components"]:
            if c["package"] == package:
                ctr, ang = vision.comp_pose(M, c, self.data["y_up"])
                known = pkg.kind != "generic"
                r = vision.fit_body(img, ctr, ang, ppm, min(25.0, max(6.0, 3 * max(pkg.body_l, pkg.body_w))), len(pkg.pads) == 2,
                                    0.25 * pkg.body_l * pkg.body_w if known else 0.0)
                # a known package can be corrected, not reinvented: reject wild measurements
                if r and (not known or all(0.6 < m / e < 1.6 for m, e in zip(r[:2], (pkg.body_l, pkg.body_w)))):
                    sizes.append(r)
        if not sizes:
            raise ValueError("Could not measure the body - adjust L/W by hand")
        l, w = (float(np.median([s[i] for s in sizes])) for i in (0, 1))
        d = self.data["packages"][package]
        if len(sizes[0]) == 3:  # measured overall footprint length: scale body in proportion
            l = l / 1.35  # pads/fillets typically reach ~15-20% past each end
        resize(d, round(l, 2), round(w, 2))
        self.save()
        return d["body_l"], d["body_w"], len(sizes)

    def autofit_all(self):
        """Auto-fit every non-fiducial package. Returns {'fitted': [...], 'failed': [...]}."""
        used = {c["package"] for c in self.data["components"] if not c["fiducial"]}
        out = {"fitted": [], "failed": []}
        for name in sorted(used):
            if self.data["packages"][name]["kind"] == "fiducial":
                continue
            try:
                l, w, n = self.autofit(name)
                out["fitted"].append({"package": name, "body_l": l, "body_w": w})
            except ValueError:
                out["failed"].append(name)
        return out

    # ------------------------------------------------ bare (unpopulated) board
    def bare(self):
        p = self.dir / "bare.png"
        return cv2.imread(str(p)) if p.exists() else None

    def set_bare(self, img):
        """Store a bare-board photo aligned to the golden, then auto-program from the difference."""
        gold = self.golden()
        if gold is None or self.M is None:
            raise ValueError("Add the golden (populated) board first")
        warped, reg = vision.register(gold, img, [], prefer="features")
        if warped is None:
            raise ValueError("Bare board not found - same camera position as the golden please")
        cv2.imwrite(str(self.path("bare.png")), warped)
        return self.auto_from_bare()

    def auto_from_bare(self):
        """Parts = where golden differs from bare. With a CSV: snap each placement onto its part and size
        its package; without: create parts from the blobs."""
        gold, bare, M = self.golden(), self.bare(), self.M
        ppm = vision.px_per_mm(M)
        blobs = vision.part_blobs(gold, bare, ppm)
        comps = [c for c in self.data["components"] if not c["fiducial"]]
        yu = self.data["y_up"]
        snapped, sizes = 0, {}
        if comps:
            used = set()
            for c in comps:
                c["dx"] = c["dy"] = 0
                ctr, ang = vision.comp_pose(M, c, yu)
                pkg = self.pkg(c["package"])
                reach = max(1.5 * ppm, 0.6 * max(pkg.extent()) * 2 * ppm)
                best = None
                for i, b in enumerate(blobs):
                    d = math.hypot(b["cx"] - ctr[0], b["cy"] - ctr[1])
                    if i not in used and d < reach and (best is None or d < best[0]):
                        best = (d, i)
                if best is None:
                    continue
                b = blobs[best[1]]
                hx, hy = pkg.extent()
                exp_area = (2 * hx * ppm) * (2 * hy * ppm)
                if not (0.4 < b["l"] * b["w"] / max(exp_area, 1.0) < 2.5):
                    continue  # blob doesn't look like this package (partial / merged) - keep the CSV position
                used.add(best[1])
                inv = cv2.invertAffineTransform(M)
                mx, my = vision.apply(inv, [(b["cx"], b["cy"])])[0]
                my = -my if yu else my
                c["dx"], c["dy"] = round(mx - c["x"], 3), round(my - c["y"], 3)
                # body size in the part's own axes
                a = math.radians(ang)
                along = abs(math.cos(a - math.radians(b["angle"])))
                l, w = (b["l"], b["w"]) if along > 0.7 else (b["w"], b["l"])
                sizes.setdefault(c["package"], []).append((l / ppm, w / ppm))
                snapped += 1
            for name, ls in sizes.items():
                d = self.data["packages"][name]
                L, W = (float(np.median([x[i] for x in ls])) for i in (0, 1))
                if d["kind"] not in ("fiducial",) and 0.3 < L / max(d["body_l"], 0.1) < 3:
                    resize(d, round(L * 0.9, 2), round(W * 0.9, 2))  # blob includes solder/terminations
            created = 0
        else:
            created = 0
            for b in blobs:
                L, W = b["l"] / ppm, b["w"] / ppm
                name = f"BARE_{L:.1f}x{W:.1f}"
                self.data["packages"].setdefault(name, Package(name, round(L * 0.9, 2), round(W * 0.9, 2), [], False, False, "generic").to_dict())
                inv = cv2.invertAffineTransform(M)
                mx, my = vision.apply(inv, [(b["cx"], b["cy"])])[0]
                created += 1
                self.data["components"].append({"ref": f"B{created}", "x": float(mx), "y": float(-my if yu else my),
                                                "rot": (-b["angle"]) % 360, "part": name, "package": name, "side": "top",
                                                "fiducial": False, "enabled": True, "dnf": False, "dx": 0, "dy": 0,
                                                "checks": None, "th": {}, "mode": "presence"})
        self.save()
        return {"parts_found": len(blobs), "snapped": snapped, "created": created,
                "not_found": [c["ref"] for c in comps if c["dx"] == 0 and c["dy"] == 0] if comps else []}

    # ------------------------------------------------ tuning layers: program < package < part
    def tuning(self, c):
        pk = self.data["packages"].get(c["package"], {})
        return {**self.data["thresholds"], **pk.get("th", {}), **c.get("th", {})}

    def set_package_tuning(self, package, th=None, checks=None):
        d = self.data["packages"][package]
        if th is not None:
            d["th"] = {k: float(v) for k, v in th.items() if v is not None}
        if checks is not None:
            d["checks"] = checks
            for c in self.data["components"]:  # parts without their own override follow the package
                if c["package"] == package and not c.get("own_checks"):
                    c["checks"] = checks
        self.save()

    def set_part_tuning(self, ref, th=None, checks=None):
        for c in self.data["components"]:
            if c["ref"] == ref:
                if th is not None:
                    c["th"] = {k: float(v) for k, v in th.items() if v is not None}
                if checks is not None:
                    c["checks"], c["own_checks"] = checks, True
        self.save()

    # ------------------------------------------------ shared parts library (all programs)
    # ------------------------------------------------ saved placement-file formats (shared)
    @staticmethod
    def formats():
        p = ROOT / "formats.json"
        return json.loads(p.read_text()) if p.exists() else {}

    @staticmethod
    def save_format(name, fmt, text=None):
        from . import pnp_import
        fs = Program.formats()
        fmt = dict(fmt)
        if text:
            fmt["signature"] = pnp_import.header_signature(text, fmt)
        fs[name] = fmt
        ROOT.mkdir(parents=True, exist_ok=True)
        (ROOT / "formats.json").write_text(json.dumps(fs, indent=1))
        return fs

    @staticmethod
    def match_format(text):
        """A saved format whose header line matches this file, or None."""
        from . import pnp_import
        for name, fmt in Program.formats().items():
            try:
                if fmt.get("signature") and pnp_import.header_signature(text, fmt) == fmt["signature"]:
                    return name, fmt
            except Exception:
                continue
        return None, None

    @staticmethod
    def machine_lib():
        p = ROOT / "machine_lib.json"
        return json.loads(p.read_text()) if p.exists() else {"packages": {}, "components": {}}

    @staticmethod
    def save_machine_lib(packages=None, components=None):
        lib = Program.machine_lib()
        if packages:
            lib["packages"].update(packages)
        if components:
            lib["components"].update(components)
        ROOT.mkdir(parents=True, exist_ok=True)
        (ROOT / "machine_lib.json").write_text(json.dumps(lib))
        return {"packages": len(lib["packages"]), "components": len(lib["components"])}

    @staticmethod
    def library():
        p = ROOT / "library.json"
        return json.loads(p.read_text()) if p.exists() else {}

    def save_to_library(self, package):
        lib = self.library()
        lib[package] = {k: v for k, v in self.data["packages"][package].items()}
        ROOT.mkdir(parents=True, exist_ok=True)
        (ROOT / "library.json").write_text(json.dumps(lib, indent=1))
        return len(lib)

    def apply_library(self):
        """Use library geometry/tuning for any package with the same name. Returns names updated."""
        lib, done = self.library(), []
        for name in self.data["packages"]:
            if name in lib:
                self.data["packages"][name] = {**self.data["packages"][name], **lib[name], "name": name}
                done.append(name)
        self.save()
        return done

    # ------------------------------------------------ backup / restore
    def backup_zip(self):
        import io
        import zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in self.dir.rglob("*"):
                if f.is_file() and "runs" not in f.relative_to(self.dir).parts:
                    z.write(f, f.relative_to(self.dir))
        return buf.getvalue()

    @staticmethod
    def restore_zip(data, name=None):
        import io
        import zipfile
        z = zipfile.ZipFile(io.BytesIO(data))
        meta = json.loads(z.read("program.json"))
        p = Program(name or meta["name"])
        p.dir.mkdir(parents=True, exist_ok=True)
        for n in z.namelist():
            if ".." in n or n.startswith("/"):
                continue
            (p.dir / n).parent.mkdir(parents=True, exist_ok=True)
            (p.dir / n).write_bytes(z.read(n))
        p.data = json.loads((p.dir / "program.json").read_text())
        p.data["name"] = p.name
        p.save()
        return p.name

    def add_part_at(self, px, py, ref=None):
        """Teach: snap a new part onto the golden image at pixel (px, py)."""
        img, M = self.golden(), self.M
        if img is None or M is None:
            raise ValueError("Add a board image first")
        ppm = vision.px_per_mm(M)
        r = vision.snap_part(img, px, py, ppm) or {"cx": px, "cy": py, "l": 2.0 * ppm, "w": 1.2 * ppm, "angle": 0.0}
        L, W = r["l"] / ppm, r["w"] / ppm
        name = f"TAUGHT_{L:.1f}x{W:.1f}"
        if name not in self.data["packages"]:
            self.data["packages"][name] = Package(name, round(L, 2), round(W, 2), [], False, False, "generic").to_dict()
        inv = cv2.invertAffineTransform(M)
        x, y = vision.apply(inv, [(r["cx"], r["cy"])])[0]
        yu = self.data["y_up"]
        n = len(self.data["components"]) + 1
        ref = ref or self.next_bom_ref() or f"T{n}"
        while any(c["ref"] == ref for c in self.data["components"]):
            n += 1
            ref = f"T{n}"
        self.data["components"].append({"ref": ref, "x": float(x), "y": float(-y if yu else y), "rot": (-r["angle"]) % 360,
                                        "part": name, "package": name, "side": "top", "fiducial": False, "enabled": True,
                                        "dnf": False, "dx": 0, "dy": 0, "checks": None, "th": {}, "mode": "presence",
                                        "ipn": self.data.get("bom", {}).get(ref, {}).get("ipn", "")})
        self.save()
        return ref

    # ------------------------------------------------ BOM without XY (IPN + designators)
    def set_bom(self, bom):
        self.data["bom"] = bom["refs"]
        for c in self.data["components"]:
            b = bom["refs"].get(c["ref"])
            if b:
                c["ipn"] = c.get("ipn") or b["ipn"]
                if c.get("from_layout"):
                    b["th"] = False  # the machine places it: SMD whatever the name suggests
                elif b["th"]:
                    c["enabled"] = False
        self.save()
        refs = bom["refs"]
        placed = {c["ref"] for c in self.data["components"]}
        mism = [f"{c['ref']}: layout {c['ipn']} / BOM {refs[c['ref']]['ipn']}" for c in self.data["components"]
                if c.get("ipn") and c["ref"] in refs and refs[c["ref"]]["ipn"] != c["ipn"]]
        return {"ipn_mismatch": mism,
                "smd_not_in_layout": sorted(r for r, v in refs.items() if not v["th"] and r not in placed) if any(c.get("ipn") for c in self.data["components"]) else [],
                "refs": len(refs), "smd": sum(not v["th"] for v in refs.values()),
                "placed": sum(1 for r in refs if r in placed), "warnings": bom["warnings"],
                "not_in_bom": [c["ref"] for c in self.data["components"] if not c["fiducial"] and c["ref"] not in refs]}

    def set_bom_th(self, ref, th):
        if ref in self.data.get("bom", {}):
            self.data["bom"][ref]["th"] = bool(th)
        for c in self.data["components"]:
            if c["ref"] == ref:
                c["enabled"] = not th
        self.save()

    def next_bom_ref(self):
        placed = {c["ref"] for c in self.data["components"]}
        key = lambda r: (re.sub(r"\d+", "", r), int(re.sub(r"\D", "", r) or 0))
        todo = sorted((r for r, v in self.data.get("bom", {}).items() if not v["th"] and r not in placed), key=key)
        return todo[0] if todo else None

    def bulk(self, action, refs=()):
        bom = self.data.get("bom", {})
        before = len(self.data["components"])
        keep_fid = lambda c: c["fiducial"]
        if action == "delete":
            s = set(refs)
            self.data["components"] = [c for c in self.data["components"] if c["ref"] not in s]
        elif action == "not_in_bom":
            self.data["components"] = [c for c in self.data["components"] if keep_fid(c) or c["ref"] in bom]
        elif action == "clear_all":
            self.data["components"] = [c for c in self.data["components"] if keep_fid(c)]
        elif action == "auto":  # boxes the AOI guessed (P#, T#, B#, U# from photo mode)
            self.data["components"] = [c for c in self.data["components"] if keep_fid(c)
                                       or not str(c["package"]).startswith(("AUTO_", "BARE_"))]
        elif action == "skip_th":
            for c in self.data["components"]:
                if bom.get(c["ref"], {}).get("th"):
                    c["enabled"] = False
        self.save()
        return before - len(self.data["components"])

    def remove_part(self, ref):
        self.data["components"] = [c for c in self.data["components"] if c["ref"] != ref]
        self.save()

    def rename_part(self, ref, new):
        if any(c["ref"] == new for c in self.data["components"]):
            raise ValueError(f"{new} already exists")
        for c in self.data["components"]:
            if c["ref"] == ref:
                c["ref"] = new
                c["ipn"] = self.data.get("bom", {}).get(new, {}).get("ipn", c.get("ipn", ""))
        self.save()

    @property
    def M0(self):
        return np.float64(self.data["transform"]) if self.data["transform"] else None

    @property
    def M(self):
        """Fiducial transform + the user's overlay adjustment (move / rotate / scale in image space)."""
        M = self.M0
        a = self.data.get("adjust") or {}
        if M is None or not any((a.get("dx"), a.get("dy"), a.get("rot"), (a.get("scale", 1) or 1) != 1)):
            return M
        ppm = vision.px_per_mm(M)
        pts = [vision.mm_src(c["x"], c["y"], self.data["y_up"]) for c in self.data["components"]] or [(0, 0)]
        cx, cy = vision.apply(M, pts).mean(0)
        r, k = math.radians(a.get("rot", 0)), a.get("scale", 1) or 1
        R = np.float64([[k * math.cos(r), -k * math.sin(r)], [k * math.sin(r), k * math.cos(r)]])
        t = np.float64([cx, cy]) - R @ [cx, cy] + np.float64([a.get("dx", 0), a.get("dy", 0)]) * ppm
        A = np.hstack([R, t[:, None]])
        return np.vstack([A, [0, 0, 1]])[:2] @ np.vstack([M, [0, 0, 1]])

    def origin_px(self):
        """Board origin (0,0) and +X / +Y 10 mm axis ends in image px, for drawing."""
        M = self.M
        if M is None:
            return None
        yu = self.data["y_up"]
        return vision.apply(M, [vision.mm_src(0, 0, yu), vision.mm_src(10, 0, yu), vision.mm_src(0, 10, yu)]).round(1).tolist()

    def set_adjust(self, **kw):
        a = {"dx": 0.0, "dy": 0.0, "rot": 0.0, "scale": 1.0, **(self.data.get("adjust") or {})}
        if kw.get("reset"):
            a = {"dx": 0.0, "dy": 0.0, "rot": 0.0, "scale": 1.0}
        for k in ("dx", "dy", "rot", "scale"):
            if k in kw:
                a[k] = float(kw[k])
            if "d" + k in kw:
                a[k] = a[k] + float(kw["d" + k])
        a["scale"] = min(5.0, max(0.2, a["scale"]))
        a["rot"] = (a["rot"] + 180) % 360 - 180
        self.data["adjust"] = a
        self.save()
        return a

    def rough_place(self, rotate=None):
        """First guess with no fiducials: fit the layout box into the golden image (turned 90 deg if that fits better)."""
        img = self.golden()
        if img is None:
            raise ValueError("Load the golden board image first")
        H, W = img.shape[:2]
        yu = self.data["y_up"]
        pts = np.float64([vision.mm_src(c["x"], c["y"], yu) for c in self.data["components"]])
        lo, hi = pts.min(0), pts.max(0)
        bw, bh = max(1.0, hi[0] - lo[0]), max(1.0, hi[1] - lo[1])
        if rotate is None:
            rotate = 90 if (W > H) != (bw > bh) else 0
        rw, rh = (bh, bw) if rotate % 180 else (bw, bh)
        s = 0.85 * min(W / rw, H / rh)
        r = math.radians(rotate)
        R = s * np.float64([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
        t = np.float64([W / 2, H / 2]) - R @ ((lo + hi) / 2)
        self.data["transform"] = np.hstack([R, t[:, None]]).tolist()
        self.data["adjust"] = {"dx": 0.0, "dy": 0.0, "rot": 0.0, "scale": 1.0}
        self.data["fid_marks"] = {}
        self.save()

    def bake_adjust(self):
        """Make the adjusted overlay the new base transform."""
        M = self.M
        self.data["transform"] = M.tolist() if M is not None else None
        self.data["adjust"] = {"dx": 0.0, "dy": 0.0, "rot": 0.0, "scale": 1.0}
        self.save()

    # ------------------------------------------------ fiducials
    FID_DEFAULTS = {"polarity": "auto", "threshold": None, "size_mm": None, "search_mm": 2.5, "shape": "auto", "min_score": 0.45}

    def fid_params(self):
        return {**self.FID_DEFAULTS, **(self.data.get("fid_params") or {})}

    def fid_list(self):
        return [c for c in self.data["components"] if c["fiducial"]]

    def _fid_geom(self, f, par):
        d = par["size_mm"] or f.get("fid_diam") or 1.0
        shape = par["shape"] if par["shape"] != "auto" else f.get("fid_shape") or \
            ("square" if "SQ" in (f.get("package") or "").upper() else "circle")
        return d, shape

    def find_fiducials(self, **params):
        """Locate every fiducial. With an existing transform: local search at the predicted spot.
        Otherwise: global hypothesis search first. Keeps manual marks unless overwrite."""
        par = {**self.fid_params(), **{k: v for k, v in params.items() if k in self.FID_DEFAULTS}}
        self.data["fid_params"] = par
        img = self.golden()
        if img is None:
            raise ValueError("Load the golden board image first")
        gray = vision.prep(img)
        fids = self.fid_list()
        if not fids:
            raise ValueError("No fiducials in the program - use 2 part centres instead (click them)")
        marks = self.data.setdefault("fid_marks", {})
        yu = self.data["y_up"]
        M = self.M
        if M is None or params.get("fresh"):
            M = None
            d0 = self._fid_geom(fids[0], par)[0]
            for y in (yu, not yu):
                M, _ = vision.auto_fiducials(img, fids, self.data["components"], y, d0)
                if M is not None:
                    self.data["y_up"] = yu = y
                    break
            if M is None:
                # partial manual marks can still give a coarse transform
                have = [f for f in fids if f["ref"] in marks]
                if len(have) >= 2:
                    M = vision.similarity_from_pairs([vision.mm_src(f["x"], f["y"], yu) for f in have],
                                                     [(marks[f["ref"]]["px"], marks[f["ref"]]["py"]) for f in have])
            if M is None:
                raise ValueError("Could not find the fiducials automatically - click each one on the image (or adjust threshold / polarity)")
        ppm = vision.px_per_mm(M)
        out = []
        for f in fids:
            if marks.get(f["ref"], {}).get("source") == "manual" and not params.get("overwrite"):
                out.append({"ref": f["ref"], **marks[f["ref"]]})
                continue
            d, shape = self._fid_geom(f, par)
            pred = vision.apply(M, [vision.mm_src(f["x"], f["y"], yu)])[0]
            r = None
            sr = par["search_mm"]
            while r is None and sr <= max(par["search_mm"], 24):  # widen the search until a good dot turns up
                r = vision.find_fiducial(gray, pred, d / 2 * ppm, sr * ppm, par["polarity"], par["threshold"], shape)
                if r and r["score"] < par["min_score"]:
                    r = None
                sr *= 2
            if r:
                marks[f["ref"]] = {**r, "source": "auto"}
            else:
                marks.pop(f["ref"], None)
            out.append({"ref": f["ref"], **(marks.get(f["ref"]) or {"missing": True, "pred": [float(pred[0]), float(pred[1])]})})
        # sanity: two auto dots must agree with the current scale / rotation guess
        got = [f for f in fids if f["ref"] in marks]
        if len(got) == 2 and not params.get("fresh"):
            src2 = [vision.mm_src(f["x"], f["y"], yu) for f in got]
            M2 = vision.similarity_from_pairs(src2, [(marks[f["ref"]]["px"], marks[f["ref"]]["py"]) for f in got])
            dr = abs((math.degrees(math.atan2(M2[1, 0], M2[0, 0]) - math.atan2(M[1, 0], M[0, 0]) * 180 / math.pi) + 180) % 360 - 180)
            if abs(vision.px_per_mm(M2) / ppm - 1) > 0.08 or dr > 4:
                for f in got:
                    if marks[f["ref"]].get("source") == "auto":
                        marks.pop(f["ref"], None)
                out = [{"ref": f["ref"], **(marks.get(f["ref"]) or {"missing": True})} for f in fids]
        self.data["fid_marks"] = marks
        fit = self.fit_fiducials() if sum(1 for f in fids if f["ref"] in marks) >= 2 else None
        return {"marks": out, "fit": fit, "params": par}

    def mark_fiducial(self, ref, px, py, snap=True, remove=False):
        """Manual fiducial position (click / nudge). snap=True refines to the blob under the click."""
        marks = self.data.setdefault("fid_marks", {})
        if remove:
            marks.pop(ref, None)
        else:
            f = next(c for c in self.fid_list() if c["ref"] == ref)
            m = {"px": float(px), "py": float(py), "score": None, "source": "manual"}
            if snap:
                par = self.fid_params()
                d, shape = self._fid_geom(f, par)
                M = self.M
                r_px = d / 2 * vision.px_per_mm(M) if M is not None else 8
                r = vision.find_fiducial(vision.prep(self.golden()), (px, py), r_px, max(3 * r_px, 12), par["polarity"], par["threshold"], shape)
                if r and math.dist((r["px"], r["py"]), (px, py)) < max(3 * r_px, 12):
                    m.update(px=r["px"], py=r["py"], score=r["score"], r=r["r"], snapped=True)
            marks[ref] = m
        self.save()
        have = [f for f in self.fid_list() if f["ref"] in marks]
        return self.fit_fiducials() if len(have) >= 2 else None

    def fit_fiducials(self):
        marks = self.data.get("fid_marks") or {}
        fids = [f for f in self.fid_list() if f["ref"] in marks]
        if len(fids) < 2:
            raise ValueError("Mark at least 2 fiducials")
        yu = self.data["y_up"]
        src = [vision.mm_src(f["x"], f["y"], yu) for f in fids]
        dst = [(marks[f["ref"]]["px"], marks[f["ref"]]["py"]) for f in fids]
        M, res, used = vision.fit_marks(src, dst, reject_mm=0.5 if len(fids) >= 3 else None)
        self.data["transform"] = M.tolist()
        self.data["adjust"] = {"dx": 0.0, "dy": 0.0, "rot": 0.0, "scale": 1.0}
        self.data["fiducials"] = [fids[i]["ref"] for i in used]
        info = {"residual_mm": {fids[i]["ref"]: round(res[i], 3) for i in range(len(fids))},
                "used": [fids[i]["ref"] for i in used], "ppm": round(vision.px_per_mm(M), 3),
                "rotation": round(math.degrees(math.atan2(M[1, 0], M[0, 0])), 3),
                "max_mm": round(max(res[i] for i in used), 3)}
        self.data["fid_fit"] = info
        self.save()
        return info

    def overlay(self):
        """Component ROIs for drawing in the UI (golden px frame)."""
        M = self.M
        if M is None:
            return []
        ppm = vision.px_per_mm(M)
        out = []
        for c0 in self.data["components"]:
            c, pkg = self.eff(c0)
            ctr, ang = vision.comp_pose(M, c, self.data["y_up"])
            out.append({"ocv_roi": pkg.ocv_roi, "pol_roi": pkg.pol_roi, "ref": c["ref"], "cx": ctr[0], "cy": ctr[1], "angle": ang, "ppm": ppm,
                        "body": [pkg.body_l, pkg.body_w], "pads": pkg.pads, "package": c["package"],
                        "enabled": c["enabled"], "fiducial": c["fiducial"], "part": c["part"]})
        return out

    def anchors(self):
        M = self.M
        comps = {c["ref"]: c for c in self.data["components"]}
        return [tuple(vision.comp_pose(M, comps[r], self.data["y_up"])[0]) for r in self.data["fiducials"] if r in comps]

    # ------------------------------------------------ learning
    def refs_for(self, ref):
        d = self.dir / "learn" / _safe(ref)
        return [cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) for p in sorted(d.glob("*.png"))] if d.exists() else []

    def learn(self, run_id, ref):
        src = self.dir / "runs" / run_id / f"{_safe(ref)}_learn.png"
        if not src.exists():
            src = self.dir / "runs" / run_id / f"{_safe(ref)}_test.png"
        if not src.exists():
            raise FileNotFoundError(ref)
        d = self.path("learn", _safe(ref), "x").parent
        files = sorted(d.glob("*.png"))
        for old in files[:max(0, len(files) - MAX_REFS + 1)]:
            old.unlink()
        cv2.imwrite(str(d / f"{int(time.time() * 1000)}.png"), cv2.imread(str(src), cv2.IMREAD_GRAYSCALE))

    # ------------------------------------------------ inspection
    def inspect(self, img, board_id="", log=True):
        t0 = time.time()
        gold = self.golden()
        if gold is None or self.M is None:
            raise ValueError("Program not ready: add board image and align fiducials first")
        warped, reg = vision.register(gold, img, self.anchors(), patch=int(vision.px_per_mm(self.M) * 1.5),
                                       prefer=self.data.get("align"))
        run_id = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
        rdir = self.path("runs", run_id, "x").parent
        result = {"run": run_id, "time": time.time(), "board": board_id, "registration": reg, "components": []}
        if warped is None:
            result.update(ok=False, fails=["ALIGN"], cycle_s=round(time.time() - t0, 3))
            self._log(result)
            return result
        cv2.imwrite(str(rdir / "board.jpg"), warped, [cv2.IMWRITE_JPEG_QUALITY, 88])
        g, t = vision.prep(gold), vision.prep(warped)
        lab = (cv2.cvtColor(gold, cv2.COLOR_BGR2LAB), cv2.cvtColor(warped, cv2.COLOR_BGR2LAB))
        M, ppm, yu = self.M, vision.px_per_mm(self.M), self.data["y_up"]
        bare = self.bare()
        for c in self.data["components"]:
            if not c["enabled"] or c["fiducial"]:
                continue
            c, pkg = self.eff(c)
            ctr, ang = vision.comp_pose(M, c, yu)
            th = self.tuning(c)
            if bare is not None and c.get("mode") != "presence":
                pb = vision.presence_vs_bare(warped, gold, bare, ctr, ang, pkg, ppm)
            else:
                pb = None
            if c.get("mode") == "presence" and bare is not None:
                pr = vision.presence_vs_bare(warped, gold, bare, ctr, ang, pkg, ppm)
                size = vision.roi_size(pkg, ppm, 1.0)
                r = {**pr, "ok": not pr["fails"], "offset_mm": [0, 0], "match": None,
                     "_golden": vision.crop_rot(g, ctr, ang, size), "_test": vision.crop_rot(t, ctr, ang, size)}
            elif c.get("mode") == "presence":
                pr = vision.presence_onpad(warped, ctr, ang, pkg, ppm, gold, th.get("min_on_pad", 0.5))
                size = vision.roi_size(pkg, ppm, 1.0)
                r = {**pr, "ok": not pr["fails"], "offset_mm": [0, 0], "match": None,
                     "_golden": vision.crop_rot(g, ctr, ang, size), "_test": vision.crop_rot(t, ctr, ang, size)}
            else:
                r = vision.inspect_component(g, t, ctr, ang, pkg, ppm, self.refs_for(c["ref"]), th, c.get("checks"), lab)
            if pb is not None and pb["fails"] == ["MISSING"] and "MISSING" not in r["fails"]:
                r["fails"] = ["MISSING"] + [f for f in r["fails"] if f not in ("TOMBSTONE", "BILLBOARD", "WRONG PART")]
                r["ok"] = False
            elif pb is not None and not pb["fails"] and r["fails"] and set(r["fails"]) <= {"MISSING"}:
                r["fails"], r["ok"] = ["WRONG PART"], False  # something is there, but not the golden part
            gt, tt = r.pop("_golden"), r.pop("_test")
            if not r["ok"]:
                cv2.imwrite(str(rdir / f"{_safe(c['ref'])}_golden.png"), vision.review_crop(gold, ctr, ang, pkg, ppm))
                cv2.imwrite(str(rdir / f"{_safe(c['ref'])}_test.png"), vision.review_crop(warped, ctr, ang, pkg, ppm))
                cv2.imwrite(str(rdir / f"{_safe(c['ref'])}_learn.png"), tt)  # grey crop used by false-call learning
            else:
                cv2.imwrite(str(rdir / f"{_safe(c['ref'])}_learn.png"), tt)
            result["components"].append({"ref": c["ref"], "package": c["package"], "part": c["part"], "ipn": c.get("ipn", ""),
                                         "cx": ctr[0], "cy": ctr[1], "angle": ang, **r})
        if self.data.get("compare", {}).get("enabled"):
            self._compare(gold, warped, rdir, result)
        fails = [c for c in result["components"] if not c["ok"]]
        result.update(ok=not fails, n_fail=len(fails), cycle_s=round(time.time() - t0, 3))
        (rdir / "result.json").write_text(json.dumps(result))
        if log:
            self._log(result)
        self._prune_runs()
        return result

    # ------------------------------------------------ whole-board golden compare
    def tol_map(self):
        p = self.dir / "tol.png"
        return cv2.imread(str(p), cv2.IMREAD_GRAYSCALE).astype(np.float32) if p.exists() else None

    def _compare(self, gold, warped, rdir, result):
        cfg = self.data["compare"]
        ppm = vision.px_per_mm(self.M)
        tol = self.tol_map()
        # only compare where the camera actually saw the board (ignore content shifted in from outside)
        reg = result["registration"]
        valid = cv2.warpAffine(np.full(reg["src_shape"], 255, np.uint8), np.float64(reg["M"]),
                               (gold.shape[1], gold.shape[0]), flags=cv2.INTER_NEAREST, borderValue=0)
        valid = cv2.erode(valid, np.ones((int(ppm * 0.8) | 1,) * 2, np.uint8))
        bo = vision.board_outline(gold)  # compare the board only, not the table around it
        if bo is not None:
            valid = np.where(cv2.erode(bo[1], np.ones((int(ppm * 0.8) | 1,) * 2, np.uint8)) > 0, valid, 0)
        # specular glare (flux / solder shine) is not a defect: ignore very bright, colourless spots
        glare = np.zeros(gold.shape[:2], np.uint8)
        for im in (gold, warped):
            lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB)
            glare |= ((lab[..., 0] > 200) & (np.abs(lab[..., 1].astype(int) - 128) + np.abs(lab[..., 2].astype(int) - 128) < 20)).astype(np.uint8)
        # only big shiny patches are glare; a small bright spot may be a solder ball
        n, lbl, st, _ = cv2.connectedComponentsWithStats(glare)
        big = np.zeros(n, np.uint8)
        big[1:] = st[1:, 4] > (1.2 * ppm) ** 2
        glare = cv2.dilate(big[lbl], np.ones((int(ppm * 0.4) | 1,) * 2, np.uint8))
        valid = np.where(glare > 0, 0, valid)
        valid = np.where(self.part_mask(gold) > 0, 0, valid)  # FOD = bare board only, not parts / connector pins / shadows
        tol = np.full(gold.shape[:2], 0, np.float32) if tol is None else tol
        tol = np.where(valid > 0, tol, 1e6).astype(np.float32)
        # FOD-style compare: compact, strong changes only (large diffuse ones are flux / shine / texture)
        sens = float(cfg.get("sensitivity", 0.5))  # 0 = only obvious objects, 1 = everything
        base = cfg.get("base", 110 - 80 * sens)
        peak = cfg.get("min_peak", 235 - 150 * sens)
        # compare at a fixed working scale so high-res cameras don't turn texture/shine into "objects"
        k = min(1.0, 9.0 / ppm)
        if k < 1.0:
            rs = lambda a, interp=cv2.INTER_AREA: cv2.resize(a, None, fx=k, fy=k, interpolation=interp)
            gold_s, warped_s, tol_s = rs(gold), rs(warped), rs(tol, cv2.INTER_NEAREST)
            ppm_s = ppm * k
        else:
            gold_s, warped_s, tol_s, ppm_s = gold, warped, tol, ppm
        blobs, d = vision.diff_defects(gold_s, warped_s, tol_s, base,
                                       max(20, int(cfg.get("min_area_mm2", 0.15) * ppm_s * ppm_s)), max(1, int(ppm_s * 0.1)),
                                       max(3, int(ppm_s * 0.35)), int(cfg.get("max_area_mm2", 2.5) * ppm_s * ppm_s), peak,
                                       cfg.get("big_mean", 150 - 40 * sens))
        if k < 1.0:
            d = cv2.resize(d, (gold.shape[1], gold.shape[0]), interpolation=cv2.INTER_NEAREST)
            for b in blobs:
                for key in ("x", "y", "w", "h", "cx", "cy"):
                    b[key] = type(b[key])(b[key] / k)
        cv2.imwrite(str(rdir / "diff.png"), d.clip(0, 255).astype(np.uint8))
        failed = [c for c in result["components"] if not c["ok"]]
        for i, b in enumerate(blobs):
            if any(abs(b["cx"] - c["cx"]) < b["w"] / 2 + 10 and abs(b["cy"] - c["cy"]) < b["h"] / 2 + 10 for c in failed):
                continue  # already reported by the part check
            near = min(result["components"] or [{"ref": "", "cx": 1e9, "cy": 1e9}],
                       key=lambda c: math.hypot(c["cx"] - b["cx"], c["cy"] - b["cy"]))
            ref = f"Δ{i + 1}" + (f" near {near['ref']}" if near["ref"] and math.hypot(near["cx"] - b["cx"], near["cy"] - b["cy"]) < 4 * ppm else "")
            pad = int(ppm * 1.0)
            x0, y0 = max(0, b["x"] - pad), max(0, b["y"] - pad)
            x1, y1 = min(gold.shape[1], b["x"] + b["w"] + pad), min(gold.shape[0], b["y"] + b["h"] + pad)
            cv2.imwrite(str(rdir / f"{_safe(ref)}_golden.png"), gold[y0:y1, x0:x1])
            cv2.imwrite(str(rdir / f"{_safe(ref)}_test.png"), warped[y0:y1, x0:x1])
            result["components"].append({"ref": ref, "package": "board", "part": "golden compare", "cx": b["cx"], "cy": b["cy"],
                                         "angle": 0, "presence": None, "match": None, "offset_mm": [0, 0],
                                         "fails": ["FOREIGN OBJECT"], "ok": False, "diff": b["score"],
                                         "box": [x0, y0, x1 - x0, y1 - y0]})

    def report_image(self, run_id, per_row=4, tile=200):
        """Review sheet: board overview with numbered calls + golden | this-board zoom pairs."""
        rdir = self.dir / "runs" / _safe(run_id)
        res = json.loads((rdir / "result.json").read_text())
        gold, board = self.golden(), cv2.imread(str(rdir / "board.jpg"))
        ppm = vision.px_per_mm(self.M)
        calls = [c for c in res["components"] if not c["ok"]]
        calls.sort(key=lambda c: -(c.get("diff") or 999))
        ov = board.copy()
        tiles = []
        for k, c in enumerate(calls):
            if c.get("box"):
                x, y, w, h = c["box"]
            else:
                pkg = self.pkg(c["package"]) if c["package"] in self.data["packages"] else None
                r = int((max(pkg.extent()) if pkg else 1.5) * ppm) + 6
                x, y, w, h = int(c["cx"]) - r, int(c["cy"]) - r, 2 * r, 2 * r
            cv2.rectangle(ov, (x, y), (x + w, y + h), (0, 0, 255), max(2, board.shape[1] // 800))
            cv2.putText(ov, str(k + 1), (x, max(15, y - 5)), cv2.FONT_HERSHEY_SIMPLEX, board.shape[1] / 1500, (0, 255, 255), 2)
            R = max(w, h) // 2 + int(ppm * 1.5)
            cx, cy = x + w // 2, y + h // 2
            x0, y0 = max(0, cx - R), max(0, cy - R)
            x1, y1 = min(board.shape[1], cx + R), min(board.shape[0], cy + R)
            t = np.full((tile + 40, 2 * tile + 10, 3), 30, np.uint8)
            t[40:, :tile] = cv2.resize(gold[y0:y1, x0:x1], (tile, tile))
            t[40:, tile + 10:] = cv2.resize(board[y0:y1, x0:x1], (tile, tile))
            cv2.putText(t, f"#{k + 1} {c['ref'].split()[0]} {c['fails'][0][:14]}", (5, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
            tiles.append(t)
        W = per_row * (2 * tile + 10)
        bo = vision.board_outline(board)
        if bo is not None:
            bx, by, bw, bh = cv2.boundingRect(cv2.boxPoints(bo[0]).astype(np.int32))
            ov = ov[max(0, by):by + bh, max(0, bx):bx + bw]
        ov = cv2.resize(ov, (W, int(ov.shape[0] * W / ov.shape[1])))
        while len(tiles) % per_row or not tiles:
            tiles.append(np.full((tile + 40, 2 * tile + 10, 3), 30, np.uint8))
        grid = np.vstack([np.hstack(tiles[j:j + per_row]) for j in range(0, len(tiles), per_row)])
        hdr = np.full((50, W, 3), 30, np.uint8)
        cv2.putText(hdr, f"{self.name}  {res['board'] or run_id}:  {'PASS' if res['ok'] else str(len(calls)) + ' calls'}   (left = golden, right = this board)",
                    (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        return cv2.imencode(".jpg", np.vstack([hdr, ov, grid]), [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tobytes()

    def part_mask(self, gold):
        """Areas the FOD check must ignore: every part box (+margin) and big dark bodies (connectors, headers)
        found on the golden, grown to cover their pins and shadows. Cached per golden image."""
        p = self.dir / "partmask.png"
        g = self.dir / "golden.png"
        if p.exists() and p.stat().st_mtime >= g.stat().st_mtime and p.stat().st_mtime >= self.file.stat().st_mtime - 1:
            return cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        ppm = vision.px_per_mm(self.M)
        m = np.zeros(gold.shape[:2], np.uint8)
        for o in self.overlay():
            if o["fiducial"]:
                continue
            hx = max(o["body"][0] / 2, *(abs(x) + l / 2 for x, y, l, w in o["pads"])) if o["pads"] else o["body"][0] / 2
            hy = max(o["body"][1] / 2, *(abs(y) + w / 2 for x, y, l, w in o["pads"])) if o["pads"] else o["body"][1] / 2
            box = cv2.boxPoints(((o["cx"], o["cy"]), (2 * (hx + 0.6) * ppm, 2 * (hy + 0.6) * ppm), o["angle"]))
            cv2.fillPoly(m, [np.int32(box)], 255)
        # big dark bodies (connector housings) with their pin rows and shadows
        lab = cv2.GaussianBlur(cv2.cvtColor(gold, cv2.COLOR_BGR2LAB), (5, 5), 0).astype(np.float32)
        bo = vision.board_outline(gold)
        on = bo[1] > 0 if bo is not None else np.ones(gold.shape[:2], bool)
        boardL = float(np.median(lab[..., 0][on]))
        chroma = np.abs(lab[..., 1] - 128) + np.abs(lab[..., 2] - 128)
        boardC = float(np.median(chroma[on]))
        # black plastic: clearly darker than the solder mask AND less coloured than it
        dark = (on & (lab[..., 0] < 0.6 * boardL) & (chroma < 0.6 * boardC + 4)).astype(np.uint8)
        dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((int(ppm * 0.8) | 1,) * 2, np.uint8))
        n, lbl, st, _ = cv2.connectedComponentsWithStats(dark)
        big = np.zeros(n, np.uint8)
        big[1:] = (st[1:, 4] > 25 * ppm * ppm) & (st[1:, 4] < 0.3 * dark.size)
        body = big[lbl]
        for i in np.nonzero(big)[0]:  # whole bounding box: pins sit between the dark latches
            x, y, w, h = st[i, :4]
            body[y:y + h, x:x + w] = 1
        m |= cv2.dilate(body, np.ones((int(ppm * 1.5) | 1,) * 2, np.uint8)) * 255
        cv2.imwrite(str(p), m)
        return m

    def train_good(self, img):
        """Learn normal variation from a known-good capture (lighting, focus, placement spread)."""
        gold = self.golden()
        warped, reg = vision.register(gold, img, self.anchors(), patch=int(vision.px_per_mm(self.M) * 1.5),
                                       prefer=self.data.get("align"))
        if warped is None:
            raise ValueError("Board not found in image")
        d = vision.diff_map(gold, warped, max(1, int(vision.px_per_mm(self.M) * 0.1)))
        d = cv2.dilate(d, np.ones((5, 5), np.uint8))
        tol = self.tol_map()
        tol = d if tol is None else np.maximum(tol, d)
        cv2.imwrite(str(self.path("tol.png")), tol.clip(0, 255).astype(np.uint8))
        cmp = self.data.setdefault("compare", {"enabled": False})
        cmp["trained"] = cmp.get("trained", 0) + 1
        self.save()
        # self-check every part on this known-good board: fix small ROI offsets, learn the rest as normal
        r = self.inspect(img, "train", log=False)
        fixed = learned = 0
        comps = {c["ref"]: c for c in self.data["components"]}
        M = self.M
        for c in r["components"]:
            if c["ok"] or c["ref"] not in comps:
                continue
            pc = comps[c["ref"]]
            if c["fails"] == ["OFFSET"] and math.hypot(*c["offset_mm"]) >= 0.5:
                # big jump on a GOOD board = matched a look-alike neighbour: search less far for this part
                pc.setdefault("th", {})["search_mm"] = 0.3
                pc["th"]["offset_mm"] = max(pc["th"].get("offset_mm", 0), 0.25)
                fixed += 1
            elif c["fails"] == ["OFFSET"]:
                a = math.radians(c["angle"])
                ox, oy = (v * vision.px_per_mm(M) for v in c["offset_mm"])
                v_img = np.float64([ox * math.cos(a) - oy * math.sin(a), ox * math.sin(a) + oy * math.cos(a)])
                dx, ys = np.linalg.solve(M[:, :2], v_img)
                pc["dx"] = round(pc.get("dx", 0) + dx, 3)
                pc["dy"] = round(pc.get("dy", 0) + (-ys if self.data["y_up"] else ys), 3)
                fixed += 1
            else:
                if c["fails"] == ["MARKING"] and c.get("ocv") is not None:  # this part's text is just hard to see
                    pc.setdefault("th", {})["ocv"] = round(max(0.05, c["ocv"] * 0.75), 3)
                self.learn(r["run"], c["ref"])
                learned += 1
        self.save()
        return {"trained": cmp["trained"], "roi_fixed": fixed, "learned": learned}

    def _learn_diff(self, run_id, ref):
        rdir = self.dir / "runs" / run_id
        res = json.loads((rdir / "result.json").read_text())
        c = next(c for c in res["components"] if c["ref"] == ref)
        d = cv2.imread(str(rdir / "diff.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32)
        tol = self.tol_map()
        tol = np.zeros_like(d) if tol is None else tol
        x, y, w, h = c["box"]
        tol[y:y + h, x:x + w] = np.maximum(tol[y:y + h, x:x + w], d[y:y + h, x:x + w])
        cv2.imwrite(str(self.path("tol.png")), tol.clip(0, 255).astype(np.uint8))

    def _prune_runs(self, keep=200):
        runs = sorted((self.dir / "runs").iterdir())
        for r in runs[:-keep]:
            for f in r.iterdir():
                f.unlink()
            r.rmdir()

    # ------------------------------------------------ history / stats
    def _log(self, result):
        slim = {k: result[k] for k in ("run", "time", "board", "ok", "cycle_s") if k in result}
        slim["fails"] = [{"ref": c["ref"], "package": c["package"], "type": c["fails"]} for c in result.get("components", []) if not c["ok"]]
        if result.get("fails") == ["ALIGN"]:
            slim["fails"] = [{"ref": "BOARD", "package": "", "type": ["ALIGN"]}]
        with open(self.path("history.jsonl"), "a") as f:
            f.write(json.dumps(slim) + "\n")

    def feedback(self, run_id, ref, verdict, reason=""):
        with open(self.path("feedback.jsonl"), "a") as f:
            f.write(json.dumps({"run": run_id, "ref": ref, "verdict": verdict, "reason": reason, "time": time.time()}) + "\n")
        if verdict == "false_call":
            if ref.startswith("Δ"):
                self._learn_diff(run_id, ref)
            else:
                self.learn(run_id, ref)

    def _read(self, fname):
        p = self.dir / fname
        return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []

    def export_csv(self):
        """One row per board and per failed part - for Excel / management reports."""
        import csv
        import io
        fbl = self._read("feedback.jsonl")
        ipns = {c["ref"]: c.get("ipn", "") for c in self.data["components"]}
        fb = {(f["run"], f["ref"]): f["verdict"] for f in fbl}
        why = {(f["run"], f["ref"]): f.get("reason", "") for f in fbl}
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["date", "time", "run", "board", "result", "cycle_s", "ref", "ipn", "package", "defect", "operator_verdict", "reason"])
        for h in self._read("history.jsonl"):
            t = time.localtime(h["time"])
            base = [time.strftime("%Y-%m-%d", t), time.strftime("%H:%M:%S", t), h["run"], h.get("board", ""),
                    "PASS" if h["ok"] else "FAIL", h.get("cycle_s", "")]
            if not h["fails"]:
                w.writerow(base + ["", "", "", "", "", ""])
            for f in h["fails"]:
                w.writerow(base + [f["ref"], ipns.get(f["ref"], ""), f["package"], "/".join(f["type"]),
                                   {"false_call": "false call", "defect": "real defect"}.get(fb.get((h["run"], f["ref"])), ""),
                                   why.get((h["run"], f["ref"]), "")])
        return out.getvalue()

    def stats(self):
        hist, fb = self._read("history.jsonl"), self._read("feedback.jsonl")
        n = len(hist)
        by_ref, by_type, by_pkg = {}, {}, {}
        for h in hist:
            for f in h["fails"]:
                by_ref[f["ref"]] = by_ref.get(f["ref"], 0) + 1
                by_pkg[f["package"]] = by_pkg.get(f["package"], 0) + 1
                for t in f["type"]:
                    by_type[t] = by_type.get(t, 0) + 1
        fc = sum(1 for f in fb if f["verdict"] == "false_call")
        real = sum(1 for f in fb if f["verdict"] == "defect")
        cyc = [h["cycle_s"] for h in hist if "cycle_s" in h]
        top = lambda d: sorted(d.items(), key=lambda kv: -kv[1])[:10]
        return {"boards": n, "passed": sum(1 for h in hist if h["ok"]),
                "fpy": round(100 * sum(1 for h in hist if h["ok"]) / n, 1) if n else None,
                "false_calls": fc, "confirmed_defects": real,
                "false_call_rate": round(100 * fc / (fc + real), 1) if fc + real else None,
                "avg_cycle_s": round(sum(cyc) / len(cyc), 2) if cyc else None,
                "false_call_reasons": top({r: sum(1 for f in fb if f["verdict"] == "false_call" and (f.get("reason") or "other") == r)
                                           for r in {f.get("reason") or "other" for f in fb if f["verdict"] == "false_call"}}),
                "top_refs": top(by_ref), "by_type": top(by_type), "by_package": top(by_pkg),
                "recent": [{"run": h["run"], "ok": h["ok"], "n": len(h["fails"])} for h in hist[-30:]]}
