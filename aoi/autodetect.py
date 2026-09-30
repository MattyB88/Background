"""Build an AOI program straight from a golden photo (no placement file).

Finds component bodies as 'not board colour' blobs and mounting holes / round marks as fiducials.
Positions are stored in mm using a nominal scale (default 20 px/mm), so tolerances stay sensible.
"""
from __future__ import annotations

import cv2
import numpy as np

from .packages import Package


def board_colour(lab):
    cv2.setRNGSeed(1)  # repeatable
    h, w = lab.shape[:2]
    lab = lab[h // 5:4 * h // 5, w // 5:4 * w // 5]  # centre: avoid fixture / background
    small = cv2.resize(lab, (160, int(160 * lab.shape[0] / lab.shape[1]))).reshape(-1, 3).astype(np.float32)
    _, lbl, centers = cv2.kmeans(small, 4, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 3,
                                 cv2.KMEANS_PP_CENTERS)
    return centers[np.bincount(lbl.ravel()).argmax()]


def is_hole(lab, cx, cy, r, bg):
    """Centre of the round blob looks like background seen THROUGH the board (not board colour, not
    part-black): i.e. differs from the ring around it, which is plated copper / pad."""
    h, w = lab.shape[:2]
    ri = max(2, int(r * 0.35))
    x, y = int(cx), int(cy)
    if x - ri < 0 or y - ri < 0 or x + ri >= w or y + ri >= h:
        return False
    ctr = lab[y - ri:y + ri + 1, x - ri:x + ri + 1].reshape(-1, 3).astype(np.float32).mean(0)
    ring = []
    for t in np.linspace(0, 2 * np.pi, 16, endpoint=False):
        px, py = int(cx + 0.85 * r * np.cos(t)), int(cy + 0.85 * r * np.sin(t))
        if 0 <= px < w and 0 <= py < h:
            ring.append(lab[py, px].astype(np.float32))
    if not ring:
        return False
    ring = np.mean(ring, 0)
    chroma_c = abs(ctr[1] - 128) + abs(ctr[2] - 128)
    return float(np.linalg.norm(ctr - ring)) > 25 and (chroma_c > 12 or ctr[0] > 150 or ctr[0] < 50)


def board_mask_from_samples(labf, samples, tol=None):
    """Pixels that look like bare board, from a few operator clicks (lightest to darkest board areas)."""
    h, w = labf.shape[:2]
    cols = []
    for x, y in samples:
        x, y = int(x), int(y)
        p = labf[max(0, y - 4):y + 5, max(0, x - 4):x + 5].reshape(-1, 3)
        if len(p):
            cols.append(p.mean(0))
    if not cols:
        return None
    cols = np.float32(cols)
    wgt = np.float32([0.6, 1.0, 1.0])  # brightness varies more than colour across a board (tracks, copper pour)
    d = np.min(np.linalg.norm((labf[..., None, :] - cols[None, None, :, :]) * wgt, axis=3), axis=2)
    if tol is None:
        spread = max((np.linalg.norm((a - b) * wgt) for i, a in enumerate(cols) for b in cols[i + 1:]), default=0.0)
        tol = max(14.0, min(30.0, 10.0 + 0.3 * spread))
    return d < tol


def detect(img, min_mm=0.6, ppm=20.0, samples=None):
    """Return (parts, holes). parts: dicts cx, cy, angle, l, w (px), dark(bool), conf 0-1; holes: (x, y, r).
    samples: optional operator clicks on bare board (x, y) - then 'not board' is learned from them."""
    h, w = img.shape[:2]
    lab = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2LAB), (5, 5), 0)
    bg = board_colour(lab)
    labf = lab.astype(np.float32)
    chroma = np.linalg.norm(labf[..., 1:] - bg[1:], axis=2)
    dL = labf[..., 0] - bg[0]
    # adapt to this board: how much do plain board pixels (incl. tracks) vary?
    near = (chroma < 25) & (np.abs(dL) < 40)
    c_thr = max(18.0, float(np.percentile(chroma[near], 97)) * 1.6) if near.any() else 18.0
    l_lo = min(-35.0, float(np.percentile(dL[near], 3)) * 1.6) if near.any() else -35.0
    l_hi = max(70.0, float(np.percentile(dL[near], 97)) * 2.5) if near.any() else 70.0
    neutral = np.abs(labf[..., 1] - 128) + np.abs(labf[..., 2] - 128)
    # greenness (solder mask is green / blue; part bodies, pads and terminations are grey, black, white, tan)
    g_bg = abs(128.0 - float(bg[1])) + abs(128.0 - float(bg[2])) * 0.5
    g = np.abs(128.0 - labf[..., 1]) + np.abs(128.0 - labf[..., 2]) * 0.5
    lowchroma = (g < g_bg * 0.45) if g_bg > 12 else np.zeros_like(dL, bool)
    mask = ((dL < l_lo) | ((dL < -10) & (neutral < 14) & (chroma > c_thr * 0.6)) |  # black / grey bodies
            (chroma > c_thr) | (dL > l_hi) | lowchroma).astype(np.uint8)
    if samples:
        bmask = board_mask_from_samples(labf, samples)
        if bmask is not None:
            mask = (~bmask).astype(np.uint8)
    k = max(3, int(ppm * 0.4)) | 1  # removes silkscreen lines and tracks
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    holes = []
    c = cv2.HoughCircles(cv2.GaussianBlur(gray, (7, 7), 0), cv2.HOUGH_GRADIENT, 1.2, int(ppm * 3), param1=120,
                         param2=40, minRadius=int(ppm * 0.6), maxRadius=int(ppm * 3.5))
    if c is not None:
        for x, y, r in c[0]:
            ri = int(r)
            xi, yi = int(round(x)), int(round(y))
            if xi - ri < 0 or yi - ri < 0 or xi + ri >= w or yi + ri >= h:
                continue
            ring = lab[yi - ri:yi + ri, xi - ri:xi + ri].astype(np.float32)
            yy, xx = np.mgrid[-ri:ri, -ri:ri]
            rr = xx * xx + yy * yy
            ann = ring[(rr > (0.6 * r) ** 2) & (rr < (0.95 * r) ** 2)]
            ctr = ring[rr < (0.3 * r) ** 2]
            gold = ann[:, 2].mean() > 142 and ann[:, 0].mean() > 100  # plated ring: bright + yellow
            hole = abs(float(ctr[:, 0].mean()) - float(ann[:, 0].mean())) > 25  # drilled centre differs
            if gold and hole:
                holes.append((float(x), float(y), float(r)))
    # every blob, including those sitting inside a background frame (not just outermost contours)
    n, lbl, st, _ = cv2.connectedComponentsWithStats(mask)
    cnts = []
    for i in range(1, n):
        x, y, bw, bh, a = st[i]
        if a < (min_mm * ppm) ** 2 or bw * bh > 0.2 * h * w:
            continue
        sub = (lbl[y:y + bh, x:x + bw] == i).astype(np.uint8)
        c, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE, offset=(int(x), int(y)))
        cnts.append(max(c, key=cv2.contourArea))
    parts = []
    edge = int(ppm * 0.5)
    for cn in cnts:
        (cx, cy), (a, b), ang = cv2.minAreaRect(cn)
        area = cv2.contourArea(cn)
        if min(a, b) < min_mm * ppm or area < 0.35 * a * b or max(a, b) > 0.45 * max(h, w):
            continue
        fill = area / max(a * b, 1.0)
        box = cv2.boxPoints(((cx, cy), (a, b), ang))
        if box[:, 0].min() < edge or box[:, 1].min() < edge or box[:, 0].max() > w - edge or box[:, 1].max() > h - edge:
            continue  # cut off by the photo edge
        if any(np.hypot(cx - x, cy - y) < r * 1.3 for x, y, r in holes):
            continue
        if a < b:
            a, b, ang = b, a, ang + 90
        ang = ((ang + 45) % 90) - 45 + (0 if a >= b else 90)
        # empty through-hole / via: round blob whose centre shows whatever is under the board (not a part)
        per = cv2.arcLength(cn, True)
        circ = 4 * np.pi * area / max(per * per, 1)
        if circ > 0.72 and a / max(b, 1) < 1.3 and is_hole(lab, cx, cy, min(a, b) / 2, bg):
            continue
        m = np.zeros(mask.shape, np.uint8)
        cv2.drawContours(m, [cn], -1, 1, -1)
        dark = cv2.mean(gray, m)[0] < 80
        # confidence: a clean filled rectangle of a plausible size is a part; ragged / tiny blobs are "maybe"
        conf = min(1.0, max(0.0, (fill - 0.35) / 0.4)) * (1.0 if min(a, b) >= 0.9 * ppm else 0.6)
        parts.append({"cx": float(cx), "cy": float(cy), "angle": float(ang), "l": float(a), "w": float(b), "dark": dark,
                      "conf": round(float(conf), 2)})
    return parts, holes


def program_from_image(prog, img, ppm=None, board_mm=None, samples=None, min_conf=0.55):
    """Fill *prog* (aoi.program.Program) from a golden photo. Returns counts.

    Scale: board_mm (board length) measured against the board outline, else ppm, else 20 px/mm.
    """
    if board_mm:
        from .vision import board_outline
        bo = board_outline(img)
        if bo is not None:
            ppm = max(bo[0][1]) / float(board_mm)
    ppm = float(ppm or 20.0)
    parts, holes = detect(img, ppm=ppm, samples=samples)
    from .vision import board_outline
    bo = board_outline(img)
    if bo is not None:  # ignore anything off the board (fixture, overlay text from camera software)
        inside = cv2.erode(bo[1], np.ones((int(ppm * 1.0) | 1,) * 2, np.uint8))
        parts = [p for p in parts if inside[int(p["cy"]), int(p["cx"])]]
        holes = [hh for hh in holes if bo[1][int(hh[1]), int(hh[0])]]
    comps, pkgs = [], {}
    unsure = [p for p in parts if p["conf"] < min_conf]
    parts = [p for p in parts if p["conf"] >= min_conf]
    for j, p in enumerate(unsure):  # not sure: a dot the operator resolves (pick a package / teach / delete)
        pkgs.setdefault("UNSURE", Package("UNSURE", 1.0, 1.0, [], False, False, "generic"))
        comps.append({"ref": f"Q{j + 1}", "x": p["cx"] / ppm, "y": p["cy"] / ppm, "rot": (-p["angle"]) % 360,
                      "part": "unsure", "package": "UNSURE", "side": "top", "fiducial": False, "enabled": False, "dnf": False,
                      "dx": 0, "dy": 0, "checks": None, "th": {}, "unsure": True, "conf": p["conf"],
                      "size_mm": [round(p["l"] / ppm, 2), round(p["w"] / ppm, 2)]})
    for i, p in enumerate(sorted(parts, key=lambda p: (round(p["cy"] / (ppm * 3)), p["cx"]))):
        L, W = p["l"] / ppm, p["w"] / ppm
        ic = p["dark"] and L * W > 6
        name = f"AUTO_{'IC' if ic else 'P'}_{L:.1f}x{W:.1f}"
        if name not in pkgs:
            if ic or L / max(W, 0.1) < 1.3 or L > 8:
                pkgs[name] = Package(name, L * 0.95, W * 0.95, [], polarized=ic, marking=ic, kind="ic" if ic else "generic")
            else:  # 2-terminal: body + end terminations
                pkgs[name] = Package(name, L * 0.8, W * 0.95, [[-L * 0.4, 0, L * 0.2, W * 0.95], [L * 0.4, 0, L * 0.2, W * 0.95]],
                                     False, False, "chip")
        comps.append({"ref": f"{'A'}{i + 1}", "x": p["cx"] / ppm, "y": p["cy"] / ppm, "rot": (-p["angle"]) % 360,
                      "part": name, "package": name, "side": "top", "fiducial": False, "enabled": True, "dnf": False,
                      "dx": 0, "dy": 0, "checks": None, "th": {}})
    fids = []
    for j, (x, y, r) in enumerate(holes):
        name = "HOLE_FID"
        pkgs.setdefault(name, Package(name, 2 * r / ppm, 2 * r / ppm, [], False, False, "fiducial"))
        comps.append({"ref": f"H{j + 1}", "x": x / ppm, "y": y / ppm, "rot": 0, "part": "hole", "package": name,
                      "side": "top", "fiducial": True, "enabled": False, "dnf": False, "dx": 0, "dy": 0, "checks": None, "th": {}})
        fids.append(f"H{j + 1}")
    if len(fids) < 2:  # no holes: use the biggest parts as alignment anchors
        big = sorted((c for c in comps if not c["fiducial"]), key=lambda c: -pkgs[c["package"]].body_l * pkgs[c["package"]].body_w)
        fids = [c["ref"] for c in big[:3]]
    prog.data["components"] = comps
    prog.data["packages"] = {k: v.to_dict() for k, v in pkgs.items()}
    prog.data["y_up"] = False
    prog.data["transform"] = [[ppm, 0.0, 0.0], [0.0, ppm, 0.0]]
    prog.data["fiducials"] = fids
    prog.data["source"] = "photo"
    prog.data["board_samples"] = [list(map(float, q)) for q in (samples or [])]
    prog.data["compare"] = {"enabled": True, "sensitivity": 0.0}
    prog.data["align"] = "features"
    import cv2 as _cv
    _cv.imwrite(str(prog.path("golden.png")), img)
    prog.save()
    return {"parts": len(parts), "unsure": len(unsure), "holes": len(holes), "ppm": round(ppm, 2)}
