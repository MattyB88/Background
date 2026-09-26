"""Core vision: board alignment (fiducials / features) and per-component inspection."""
from __future__ import annotations

import math
import itertools

import cv2
import numpy as np

from .packages import Package

_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))


def prep(img):
    """Lighting-robust grayscale: CLAHE + light blur."""
    g = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(_clahe.apply(g), (3, 3), 0)


# ---------------------------------------------------------------- mm <-> px
def similarity_from_pairs(src, dst):
    """2x3 similarity (rot, uniform scale, translation) from >=2 point pairs."""
    src, dst = np.float32(src), np.float32(dst)
    if len(src) == 2:
        (a, b), (c, d) = src
        (e, f), (g, h) = dst
        vs, vd = complex(c - a, d - b), complex(g - e, h - f)
        if abs(vs) < 1e-9:
            raise ValueError("Reference points coincide")
        k = vd / vs
        t = complex(e, f) - k * complex(a, b)
        return np.float64([[k.real, -k.imag, t.real], [k.imag, k.real, t.imag]])
    M, _ = cv2.estimateAffinePartial2D(src, dst, method=cv2.LMEDS)
    if M is None:
        raise ValueError("Could not fit transform")
    return M


def mm_src(x, y, y_up=True):
    return (x, -y if y_up else y)


def apply(M, pts):
    pts = np.float64(pts).reshape(-1, 2)
    return pts @ M[:, :2].T + M[:, 2]


def px_per_mm(M):
    return float(math.hypot(M[0, 0], M[1, 0]))


def comp_pose(M, comp, y_up=True):
    """Centre (px) and image-frame angle (deg) of a component."""
    c = apply(M, [mm_src(comp["x"] + comp.get("dx", 0), comp["y"] + comp.get("dy", 0), y_up)])[0]
    r = math.radians(comp["rot"])
    v = np.float64([math.cos(r), -math.sin(r) if y_up else math.sin(r)])
    v = M[:, :2] @ v
    return c, math.degrees(math.atan2(v[1], v[0]))


# ---------------------------------------------------------------- fiducials
def find_round_marks(gray, r_px):
    """Candidate fiducial centres (bright or dark round blobs) near radius r_px."""
    g = cv2.GaussianBlur(gray, (5, 5), 0)
    circles = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, 1.2, max(8, r_px * 3), param1=100, param2=18,
                               minRadius=max(2, int(r_px * 0.6)), maxRadius=int(r_px * 1.6) + 2)
    return [] if circles is None else [(float(x), float(y)) for x, y, _ in circles[0][:25]]


def auto_fiducials(img, fids, comps, y_up=True, fid_diam_mm=1.0):
    """Find fiducials without a known scale: try candidate assignments, keep best fit.

    Returns (M, matched_px) or (None, []).
    """
    gray = prep(img)
    h, w = gray.shape
    src = [mm_src(f["x"], f["y"], y_up) for f in fids]
    all_src = [mm_src(c["x"], c["y"], y_up) for c in comps]
    best = (1e18, None, None)
    for r_px in (4, 6, 9, 13, 18, 25, 35):
        cands = find_round_marks(gray, r_px)
        if len(cands) < 2:
            continue
        for combo in itertools.permutations(cands, min(len(fids), 3)):
            if len(combo) < 2:
                continue
            try:
                M = similarity_from_pairs(src[:len(combo)], combo)
            except ValueError:
                continue
            s = px_per_mm(M)
            if not (0.5 * r_px < s * fid_diam_mm / 2 < 2.0 * r_px):
                continue
            p = apply(M, all_src)
            inside = np.mean((p[:, 0] > 0) & (p[:, 0] < w) & (p[:, 1] > 0) & (p[:, 1] < h))
            if inside < 0.98:
                continue
            resid = 0.0
            if len(fids) > len(combo):
                extra = apply(M, src[len(combo):])
                resid = sum(min(math.dist(e, c) for c in cands) for e in extra)
            # prefer consistent fit, then darker-contrast marks (more fiducial-like)
            score = resid - s * 0.01
            if score < best[0]:
                best = (score, M, list(combo))
    return best[1], best[2] or []


# ---------------------------------------------------------------- registration
def register(golden, test, anchors_px, patch=60):
    """Warp *test* into golden frame. anchors_px: fiducial/feature points in golden.

    Returns (warped_test, info). Uses template matching at anchors, falls back to ORB.
    """
    g, t = prep(golden), prep(test)
    H, W = g.shape
    src, dst, scores = [], [], []
    for (x, y) in anchors_px:
        x0, y0 = int(max(0, x - patch)), int(max(0, y - patch))
        x1, y1 = int(min(W, x + patch)), int(min(H, y + patch))
        tpl = g[y0:y1, x0:x1]
        if tpl.size == 0:
            continue
        sr = int(max(W, H) * 0.12)
        sx0, sy0 = max(0, x0 - sr), max(0, y0 - sr)
        win = t[sy0:min(t.shape[0], y1 + sr), sx0:min(t.shape[1], x1 + sr)]
        if win.shape[0] < tpl.shape[0] or win.shape[1] < tpl.shape[1]:
            continue
        res = cv2.matchTemplate(win, tpl, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        if mv > 0.5:
            src.append((x, y))
            dst.append((sx0 + ml[0] + (x - x0), sy0 + ml[1] + (y - y0)))
            scores.append(float(mv))
    method = "fiducial"
    M = None
    if len(src) >= 2:
        M = similarity_from_pairs(dst, src)  # test -> golden
    else:
        method = "features"
        orb = cv2.ORB_create(3000)
        k1, d1 = orb.detectAndCompute(t, None)
        k2, d2 = orb.detectAndCompute(g, None)
        if d1 is not None and d2 is not None:
            matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2)
            if len(matches) >= 8:
                a = np.float32([k1[m.queryIdx].pt for m in matches])
                b = np.float32([k2[m.trainIdx].pt for m in matches])
                M, _ = cv2.estimateAffinePartial2D(a, b, method=cv2.RANSAC, ransacReprojThreshold=3)
    if M is None:
        return None, {"ok": False, "method": "none", "msg": "Board not found - check position / lighting"}
    warped = cv2.warpAffine(test, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    ang = math.degrees(math.atan2(M[1, 0], M[0, 0]))
    return warped, {"ok": True, "method": method, "shift_px": [float(M[0, 2]), float(M[1, 2])],
                    "angle": ang, "scale": px_per_mm(M), "scores": scores}


# ---------------------------------------------------------------- crops
def crop_rot(img, center, angle, size):
    """Upright crop of size (w,h) centred at *center*, component axis -> +x."""
    w, h = int(round(size[0])), int(round(size[1]))
    M = cv2.getRotationMatrix2D((float(center[0]), float(center[1])), angle, 1.0)
    M[0, 2] += w / 2 - center[0]
    M[1, 2] += h / 2 - center[1]
    return cv2.warpAffine(img, M, (max(w, 4), max(h, 4)), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def roi_size(pkg: Package, ppm, margin_mm=0.25):
    hx, hy = pkg.extent()
    return (2 * (hx + margin_mm) * ppm, 2 * (hy + margin_mm) * ppm)


def ncc(a, b):
    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]))
    a = a.astype(np.float32) - a.mean()
    b = b.astype(np.float32) - b.mean()
    d = math.sqrt(float((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / d) if d > 1e-6 else 0.0


def grad(g):
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1)
    return cv2.magnitude(gx, gy)


DEFAULTS = {"bridge": 1.2, "presence": 0.6, "polarity_margin": 0.08, "ocv": 0.45, "offset_mm": 0.35, "search_mm": 0.8}


def _body_slice(shape, pkg, ppm, frac=0.8):
    hx, hy = pkg.body_l * ppm * frac / 2, pkg.body_w * ppm * frac / 2
    cx, cy = shape[1] / 2, shape[0] / 2
    return (slice(max(0, int(cy - hy)), int(cy + hy) + 1), slice(max(0, int(cx - hx)), int(cx + hx) + 1))


def _z(a, floor=8.0):
    a = a.astype(np.float32)
    return (a - a.mean()) / max(float(a.std()), floor)


def body_similarity(found, tpl, sl):
    """1.0 = body looks like golden, ~0 = body region changed (missing / wrong part).

    Uses mean level + texture of the body in z-normalised ROI (lighting invariant).
    """
    zf, zt = _z(found), _z(tpl)
    bf, bt = zf[sl], zt[sl]
    if bf.size < 4:
        return 1.0
    level = abs(float(bf.mean() - bt.mean()))
    tex = abs(float(bf.std() - bt.std()))
    return float(max(0.0, 1.0 - 0.9 * level - 0.5 * tex))


def inspect_component(golden, test, center, angle, pkg: Package, ppm, refs=(), th=None, checks=None, color=None):
    """Inspect one component. golden/test are prepped grayscale images in the same frame.

    refs: extra accepted crops (learned from false calls), same size as golden crop.
    Returns dict with scores, pass/fail per check and the crops.
    """
    th = {**DEFAULTS, **(th or {})}
    checks = checks or {"presence": True, "polarity": pkg.polarized, "ocv": pkg.marking, "offset": True}
    size = roi_size(pkg, ppm)
    s = int(th["search_mm"] * ppm) + 2
    tpl = crop_rot(golden, center, angle, size)
    win = crop_rot(test, center, angle, (size[0] + 2 * s, size[1] + 2 * s))
    templates = [tpl] + [r for r in refs if r.shape == tpl.shape]
    sl = _body_slice(tpl.shape, pkg, ppm)

    def match(tp):
        res = cv2.matchTemplate(win, tp, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(res)
        return mv, ml

    best = (-2, (s, s), 0)
    for i, tp in enumerate(templates):
        mv, ml = match(tp)
        if mv > best[0]:
            best = (mv, ml, i)
    score, loc, ti = best
    crop = lambda l: win[l[1]:l[1] + tpl.shape[0], l[0]:l[0] + tpl.shape[1]]
    found = crop(loc)
    nominal = crop((s, s))
    out = {"match": round(score, 3), "ref_used": ti}
    fails = []
    # polarity: does the 180-degree turned golden fit better?
    pol_fail = False
    if checks.get("polarity"):
        flip = cv2.rotate(tpl, cv2.ROTATE_180)
        fv, fl = match(flip)
        ff = crop(fl)
        g_n = ncc(grad(found[sl]), grad(tpl[sl])) if ti == 0 else 1.0
        g_f = ncc(grad(ff[sl]), grad(flip[sl]))
        out["polarity"] = round(min(score - fv, g_n - g_f), 3)
        if ti == 0 and (fv > score + th["polarity_margin"] or g_f > g_n + th["polarity_margin"]):
            pol_fail = True
            found, loc = ff, fl
    presence = min(max(score, max(ncc(t, nominal) for t in templates)),
                   max(body_similarity(found, t, sl) for t in templates))
    if color is not None and ti == 0:
        # colour check: a part can have the same grey level as the board (e.g. brown caps on green)
        gc = crop_rot(color[0], center, angle, size)
        tw = crop_rot(color[1], center, angle, (size[0] + 2 * s, size[1] + 2 * s))
        tc = tw[loc[1]:loc[1] + tpl.shape[0], loc[0]:loc[0] + tpl.shape[1]]
        if tc.shape == gc.shape:
            for ch in (1, 2):
                presence = min(presence, body_similarity(tc[..., ch], gc[..., ch], sl))
    dx_mm, dy_mm = (loc[0] - s) / ppm, (loc[1] - s) / ppm
    out.update(presence=round(presence, 3), offset_mm=[round(dx_mm, 3), round(dy_mm, 3)])
    if checks.get("presence") and presence < th["presence"]:
        fails.append("MISSING")
    elif pol_fail:
        fails.append("POLARITY")
    else:
        if checks.get("offset") and math.hypot(dx_mm, dy_mm) > th["offset_mm"]:
            fails.append("OFFSET")
        if checks.get("ocv"):
            bs = _body_slice(tpl.shape, pkg, ppm, 0.7)
            ocv = max(ncc(grad(found[bs]), grad(t[bs])) for t in templates) if found[bs].size > 16 else 1.0
            out["ocv"] = round(ocv, 3)
            if ocv < th["ocv"]:
                fails.append("MARKING")
    if checks.get("bridge", len(pkg.pads) >= 4) and "MISSING" not in fails:
        b = bridge_score(found, tpl, pkg, ppm)
        out["bridge"] = round(b, 2)
        if b > th["bridge"]:
            fails.append("BRIDGE")
    out["fails"] = fails
    out["ok"] = not fails
    out["_golden"], out["_test"] = tpl, (found if found.shape == tpl.shape else nominal)
    return out


def pad_gaps(pkg: Package):
    """Gap rectangles (cx, cy, l, w in mm, body frame) between neighbouring pads of a row."""
    gaps = []
    rows = {}
    for cx, cy, l, w in pkg.pads:
        key = ("y", round(cy, 2)) if l <= w else ("x", round(cx, 2))
        rows.setdefault(key, []).append((cx, cy, l, w))
    for (axis, _), pads in rows.items():
        i = 0 if axis == "y" else 1
        pads.sort(key=lambda p: p[i])
        for a, b in zip(pads, pads[1:]):
            gap = (b[i] - b[2 + i] / 2) - (a[i] + a[2 + i] / 2)
            if gap <= 0.05:
                continue
            c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
            size = [gap * 0.6, a[3] * 0.6] if axis == "y" else [a[2] * 0.6, gap * 0.6]
            gaps.append((c[0], c[1], size[0], size[1]))
    return gaps


def bridge_score(found, tpl, pkg: Package, ppm):
    """Max brightness rise (in ROI std units) of any lead gap vs golden. Solder bridge = bright gap."""
    zf, zt = _z(found), _z(tpl)
    h, w = tpl.shape
    worst = 0.0
    for cx, cy, l, gw in pad_gaps(pkg):
        x0, x1 = int(w / 2 + (cx - l / 2) * ppm), int(w / 2 + (cx + l / 2) * ppm) + 1
        y0, y1 = int(h / 2 + (-cy - gw / 2) * ppm), int(h / 2 + (-cy + gw / 2) * ppm) + 1
        if x0 < 0 or y0 < 0 or x1 > w or y1 > h or (x1 - x0) * (y1 - y0) < 2:
            continue
        worst = max(worst, float(zf[y0:y1, x0:x1].mean() - zt[y0:y1, x0:x1].mean()))
    return worst


def ocr_text(crop):
    """Optional OCR (pytesseract). Returns '' if not installed."""
    try:
        import pytesseract
        return pytesseract.image_to_string(crop, config="--psm 7").strip()
    except Exception:
        return ""
