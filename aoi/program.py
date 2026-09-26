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
from .packages import Package, derive, resize

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
    def import_placements(self, parsed):
        comps = []
        for c in parsed["components"]:
            pkg_name = c["package"] or "UNKNOWN"
            if pkg_name not in self.data["packages"]:
                self.data["packages"][pkg_name] = derive(pkg_name, c["part"]).to_dict()
            fid = self.data["packages"][pkg_name]["kind"] == "fiducial" or c["ref"].upper().startswith("FID")
            kind = self.data["packages"][pkg_name]["kind"]
            dnf = bool(re.search(r"\bDNF\b|\bDNP\b|\bNF\b", c["part"].upper()))
            comps.append({**c, "package": pkg_name, "fiducial": fid, "enabled": not (fid or dnf or kind == "generic"),
                          "dnf": dnf, "dx": 0, "dy": 0,
                          "checks": None, "th": {}})
        self.data["components"] = comps
        self.data["transform"] = None
        self.save()

    def pkg(self, name) -> Package:
        return Package.from_dict(self.data["packages"][name])

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
        img = self.golden()
        comps = self.data["components"]
        fids = [c for c in comps if c["fiducial"]]
        if len(fids) < 2:
            raise ValueError("Need 2+ fiducials in the program - click 2 parts instead")
        for yu in (self.data["y_up"], not self.data["y_up"]):
            M, pts = vision.auto_fiducials(img, fids, comps, yu)
            if M is not None:
                self.data["y_up"] = yu
                return self.teach([{"ref": f["ref"], "px": p[0], "py": p[1]} for f, p in zip(fids, pts)])
        raise ValueError("Fiducials not found automatically - click them on the image")

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
                r = vision.fit_body(img, ctr, ang, ppm, min(25.0, max(6.0, 3 * max(pkg.body_l, pkg.body_w))), len(pkg.pads) == 2)
                if r:
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

    @property
    def M(self):
        return np.float64(self.data["transform"]) if self.data["transform"] else None

    def overlay(self):
        """Component ROIs for drawing in the UI (golden px frame)."""
        M = self.M
        if M is None:
            return []
        ppm = vision.px_per_mm(M)
        out = []
        for c in self.data["components"]:
            ctr, ang = vision.comp_pose(M, c, self.data["y_up"])
            pkg = self.pkg(c["package"])
            out.append({"ref": c["ref"], "cx": ctr[0], "cy": ctr[1], "angle": ang, "ppm": ppm,
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
        src = self.dir / "runs" / run_id / f"{_safe(ref)}_test.png"
        if not src.exists():
            raise FileNotFoundError(ref)
        d = self.path("learn", _safe(ref), "x").parent
        files = sorted(d.glob("*.png"))
        for old in files[:max(0, len(files) - MAX_REFS + 1)]:
            old.unlink()
        cv2.imwrite(str(d / f"{int(time.time() * 1000)}.png"), cv2.imread(str(src), cv2.IMREAD_GRAYSCALE))

    # ------------------------------------------------ inspection
    def inspect(self, img, board_id=""):
        t0 = time.time()
        gold = self.golden()
        if gold is None or self.M is None:
            raise ValueError("Program not ready: add board image and align fiducials first")
        warped, reg = vision.register(gold, img, self.anchors(), patch=int(vision.px_per_mm(self.M) * 1.5))
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
        for c in self.data["components"]:
            if not c["enabled"] or c["fiducial"]:
                continue
            ctr, ang = vision.comp_pose(M, c, yu)
            pkg = self.pkg(c["package"])
            th = {**self.data["thresholds"], **c.get("th", {})}
            r = vision.inspect_component(g, t, ctr, ang, pkg, ppm, self.refs_for(c["ref"]), th, c.get("checks"), lab)
            cv2.imwrite(str(rdir / f"{_safe(c['ref'])}_golden.png"), r.pop("_golden"))
            cv2.imwrite(str(rdir / f"{_safe(c['ref'])}_test.png"), r.pop("_test"))
            result["components"].append({"ref": c["ref"], "package": c["package"], "part": c["part"],
                                         "cx": ctr[0], "cy": ctr[1], "angle": ang, **r})
        fails = [c for c in result["components"] if not c["ok"]]
        result.update(ok=not fails, n_fail=len(fails), cycle_s=round(time.time() - t0, 3))
        (rdir / "result.json").write_text(json.dumps(result))
        self._log(result)
        self._prune_runs()
        return result

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

    def feedback(self, run_id, ref, verdict):
        with open(self.path("feedback.jsonl"), "a") as f:
            f.write(json.dumps({"run": run_id, "ref": ref, "verdict": verdict, "time": time.time()}) + "\n")
        if verdict == "false_call":
            self.learn(run_id, ref)

    def _read(self, fname):
        p = self.dir / fname
        return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []

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
                "top_refs": top(by_ref), "by_type": top(by_type), "by_package": top(by_pkg),
                "recent": [{"run": h["run"], "ok": h["ok"], "n": len(h["fails"])} for h in hist[-30:]]}
