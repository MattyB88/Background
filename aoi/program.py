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
        ref = ref or f"T{n}"
        while any(c["ref"] == ref for c in self.data["components"]):
            n += 1
            ref = f"T{n}"
        self.data["components"].append({"ref": ref, "x": float(x), "y": float(-y if yu else y), "rot": (-r["angle"]) % 360,
                                        "part": name, "package": name, "side": "top", "fiducial": False, "enabled": True,
                                        "dnf": False, "dx": 0, "dy": 0, "checks": None, "th": {}, "mode": "presence"})
        self.save()
        return ref

    def remove_part(self, ref):
        self.data["components"] = [c for c in self.data["components"] if c["ref"] != ref]
        self.save()

    def rename_part(self, ref, new):
        if any(c["ref"] == new for c in self.data["components"]):
            raise ValueError(f"{new} already exists")
        for c in self.data["components"]:
            if c["ref"] == ref:
                c["ref"] = new
        self.save()

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
        for c in self.data["components"]:
            if not c["enabled"] or c["fiducial"]:
                continue
            ctr, ang = vision.comp_pose(M, c, yu)
            pkg = self.pkg(c["package"])
            th = {**self.data["thresholds"], **c.get("th", {})}
            if c.get("mode") == "presence":
                pr = vision.presence_onpad(warped, ctr, ang, pkg, ppm, gold, th.get("min_on_pad", 0.5))
                size = vision.roi_size(pkg, ppm, 1.0)
                r = {**pr, "ok": not pr["fails"], "offset_mm": [0, 0], "match": None,
                     "_golden": vision.crop_rot(g, ctr, ang, size), "_test": vision.crop_rot(t, ctr, ang, size)}
            else:
                r = vision.inspect_component(g, t, ctr, ang, pkg, ppm, self.refs_for(c["ref"]), th, c.get("checks"), lab)
            cv2.imwrite(str(rdir / f"{_safe(c['ref'])}_golden.png"), r.pop("_golden"))
            cv2.imwrite(str(rdir / f"{_safe(c['ref'])}_test.png"), r.pop("_test"))
            result["components"].append({"ref": c["ref"], "package": c["package"], "part": c["part"],
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
        tol = np.full(gold.shape[:2], 0, np.float32) if tol is None else tol
        tol = np.where(valid > 0, tol, 1e6).astype(np.float32)
        # FOD-style compare: compact, strong changes only (large diffuse ones are flux / shine / texture)
        sens = float(cfg.get("sensitivity", 0.5))  # 0 = only obvious objects, 1 = everything
        base = cfg.get("base", 110 - 80 * sens)
        peak = cfg.get("min_peak", 235 - 150 * sens)
        blobs, d = vision.diff_defects(gold, warped, tol, base,
                                       max(20, int(cfg.get("min_area_mm2", 0.15) * ppm * ppm)), max(1, int(ppm * 0.1)),
                                       max(3, int(ppm * 0.35)), int(cfg.get("max_area_mm2", 2.5) * ppm * ppm), peak,
                                       cfg.get("big_mean", 150 - 40 * sens))
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

    def feedback(self, run_id, ref, verdict):
        with open(self.path("feedback.jsonl"), "a") as f:
            f.write(json.dumps({"run": run_id, "ref": ref, "verdict": verdict, "time": time.time()}) + "\n")
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
        fb = {(f["run"], f["ref"]): f["verdict"] for f in self._read("feedback.jsonl")}
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["date", "time", "run", "board", "result", "cycle_s", "ref", "package", "defect", "operator_verdict"])
        for h in self._read("history.jsonl"):
            t = time.localtime(h["time"])
            base = [time.strftime("%Y-%m-%d", t), time.strftime("%H:%M:%S", t), h["run"], h.get("board", ""),
                    "PASS" if h["ok"] else "FAIL", h.get("cycle_s", "")]
            if not h["fails"]:
                w.writerow(base + ["", "", "", ""])
            for f in h["fails"]:
                w.writerow(base + [f["ref"], f["package"], "/".join(f["type"]),
                                   {"false_call": "false call", "defect": "real defect"}.get(fb.get((h["run"], f["ref"])), "")])
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
                "top_refs": top(by_ref), "by_type": top(by_type), "by_package": top(by_pkg),
                "recent": [{"run": h["run"], "ok": h["ok"], "n": len(h["fails"])} for h in hist[-30:]]}
