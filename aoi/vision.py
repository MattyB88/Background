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
def find_round_marks(gray, max_r=60):
    """Candidate fiducial centres + radii (bright or dark round blobs) across scales."""
    g = cv2.GaussianBlur(gray, (5, 5), 0)
    out = []
    r = 3
    while r <= max_r:
        c = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, 1.2, max(8, r * 3), param1=100, param2=max(12, int(r * 1.2)),
                             minRadius=r, maxRadius=int(r * 1.6) + 1)
        if c is not None:
            for x, y, rr in c[0][:40]:
                if all(math.dist((x, y), (o[0], o[1])) > max(4, rr * 0.5) for o in out):
                    out.append((float(x), float(y), float(rr)))
        r = int(r * 1.5) + 1
    return out


def refine_center(gray, p, r):
    """Sub-pixel centroid of the round blob near p (bright or dark)."""
    x, y, R = int(round(p[0])), int(round(p[1])), int(max(4, r * 2))
    y0, x0 = max(0, y - R), max(0, x - R)
    patch = gray[y0:y + R + 1, x0:x + R + 1]
    if patch.size < 16:
        return p
    _, th = cv2.threshold(patch, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    cy, cx = y - y0, x - x0
    if th[min(cy, th.shape[0] - 1), min(cx, th.shape[1] - 1)] == 0:
        th = 255 - th
    n, lab = cv2.connectedComponents(th)
    k = lab[min(cy, lab.shape[0] - 1), min(cx, lab.shape[1] - 1)]
    m = cv2.moments((lab == k).astype(np.uint8))
    if m["m00"] < 4 or m["m00"] > 0.8 * patch.size:
        return p
    return (x0 + m["m10"] / m["m00"], y0 + m["m01"] / m["m00"])


def auto_fiducials(img, fids, comps, y_up=True, fid_diam_mm=1.0):
    """Find fiducials without a known scale: hypothesise from candidate pairs, verify on all fiducials.

    Returns (M, matched_px) or (None, []).
    """
    gray = prep(img)
    h, w = gray.shape
    src = [mm_src(f["x"], f["y"], y_up) for f in fids]
    all_src = np.float64([mm_src(c["x"], c["y"], y_up) for c in comps])
    cands = find_round_marks(gray, max_r=int(min(h, w) / 25))
    if len(cands) < 2:
        return None, []
    cxy = np.float64([(c[0], c[1]) for c in cands])
    # anchor on the two fiducials furthest apart
    i0, i1 = max(itertools.combinations(range(len(src)), 2), key=lambda ij: math.dist(src[ij[0]], src[ij[1]]))
    best = (-1, 1e18, None, None)
    for a, b in itertools.permutations(range(len(cands)), 2):
        ra, rb = cands[a][2], cands[b][2]
        if not 0.66 < ra / rb < 1.5:
            continue
        try:
            M = similarity_from_pairs([src[i0], src[i1]], [cxy[a], cxy[b]])
        except ValueError:
            continue
        s = px_per_mm(M)
        if not 0.4 < s * fid_diam_mm / (ra + rb) < 2.5:
            continue
        p = apply(M, all_src)
        if np.mean((p[:, 0] > 0) & (p[:, 0] < w) & (p[:, 1] > 0) & (p[:, 1] < h)) < 0.98:
            continue
        pf = apply(M, src)
        d = np.linalg.norm(pf[:, None, :] - cxy[None, :, :], axis=2).min(1)
        tol = max(3.0, 0.4 * (ra + rb) / 2)
        inl = int((d < tol).sum())
        res = float(d[d < tol].sum())
        if (inl, -res) > (best[0], -best[1]):
            best = (inl, res, M, [tuple(cxy[np.linalg.norm(cxy - q, axis=1).argmin()]) for q in pf])
    if best[2] is None:
        return None, []
    # refine on all inlier fiducials (sub-pixel blob centroids)
    M = best[2]
    r_px = 0.5 * fid_diam_mm * px_per_mm(M)
    pts = [refine_center(gray, p, r_px) for p in best[3]]
    pf = apply(M, src)
    keep = [i for i in range(len(src)) if math.dist(pf[i], pts[i]) < max(3.0, 0.2 * px_per_mm(M))]
    if len(keep) >= 2:
        M = similarity_from_pairs([src[i] for i in keep], [pts[i] for i in keep])
    return M, [pts[i] if i in keep else tuple(apply(M, [src[i]])[0]) for i in range(len(src))]


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
    tc = gc = None
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
        fails.append(classify_absent(tc if color is not None and ti == 0 and tc.shape == gc.shape else None,
                                     gc if color is not None else None, pkg, ppm, score))
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


def _masks(shape, pkg, ppm):
    """Body mask and 'bare board' mask (ROI minus body and pads) in crop coordinates."""
    h, w = shape[:2]
    body = np.zeros((h, w), np.uint8)
    cover = np.zeros((h, w), np.uint8)

    def rect(m, cx, cy, l, wd, grow=0.0):
        x0, x1 = int(w / 2 + (cx - l / 2 - grow) * ppm), int(w / 2 + (cx + l / 2 + grow) * ppm)
        y0, y1 = int(h / 2 + (-cy - wd / 2 - grow) * ppm), int(h / 2 + (-cy + wd / 2 + grow) * ppm)
        m[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 1
    rect(body, 0, 0, pkg.body_l * 0.6, pkg.body_w * 0.7)
    rect(cover, 0, 0, pkg.body_l, pkg.body_w, 0.1)
    for p in pkg.pads:
        rect(cover, *p, grow=0.1)
    return body.astype(bool), ~cover.astype(bool)


def classify_absent(tc, gc, pkg: Package, ppm, match):
    """Name a low-presence result: MISSING / TOMBSTONE / BILLBOARD / WRONG PART (needs Lab crops)."""
    if tc is None:
        return "MISSING"
    body, board = _masks(gc.shape, pkg, ppm)
    if board.sum() < 10 or body.sum() < 4:
        return "MISSING"
    bare = gc[board].reshape(-1, 3).astype(np.float32).mean(0)
    tb = tc[body].reshape(-1, 3).astype(np.float32)
    gb = gc[body].reshape(-1, 3).astype(np.float32).mean(0)
    dist = lambda a, b: float(np.linalg.norm(a - b))
    scale = max(dist(gb, bare), 10.0)
    frac_bare = dist(tb.mean(0), tc[board].reshape(-1, 3).astype(np.float32).mean(0)) / scale
    pad_diff = []
    if len(pkg.pads) == 2:
        for cx, cy, l, wd in pkg.pads:
            m = np.zeros(body.shape, np.uint8)
            h, w = body.shape
            x0, x1 = int(w / 2 + (cx - l / 2) * ppm), int(w / 2 + (cx + l / 2) * ppm)
            y0, y1 = int(h / 2 + (-cy - wd / 2) * ppm), int(h / 2 + (-cy + wd / 2) * ppm)
            m[max(0, y0):y1, max(0, x0):x1] = 1
            m = m.astype(bool)
            pad_diff.append(dist(tc[m].reshape(-1, 3).astype(np.float32).mean(0),
                                 gc[m].reshape(-1, 3).astype(np.float32).mean(0)) / scale if m.any() else 0)
    if pkg.kind in ("chip", "led", "tant", "generic") and pad_diff and \
            max(pad_diff) > 0.35 and max(pad_diff) > 1.7 * max(min(pad_diff), 0.05):
        return "TOMBSTONE"
    if frac_bare < 0.45:
        return "MISSING"
    if match >= 0.85:
        return "WRONG PART"
    if pkg.kind in ("chip", "led", "tant", "generic"):
        return "BILLBOARD"
    return "WRONG PART"


def fit_body(img_bgr, center, angle, ppm, search_mm=20.0, end_caps=False):
    """Measure the body (length along component axis, width) in mm from the golden image.

    Grows the region whose colour matches the centre of the part, bounded by the search window.
    Returns (l_mm, w_mm) or None.
    """
    S = int(search_mm * ppm)
    win = crop_rot(img_bgr, center, angle, (S, S))
    lab = cv2.GaussianBlur(cv2.cvtColor(win, cv2.COLOR_BGR2LAB), (5, 5), 0).astype(np.float32)
    c = S // 2
    k = max(3, int(0.6 * ppm))
    patch = lab[c - k:c + k + 1, c - k:c + k + 1].reshape(-1, 3)
    border = np.concatenate([lab[:3].reshape(-1, 3), lab[-3:].reshape(-1, 3), lab[:, :3].reshape(-1, 3), lab[:, -3:].reshape(-1, 3)])
    bg = np.median(border, 0)
    _, _, centers = cv2.kmeans(patch.astype(np.float32), 3, None,
                               (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5), 3, cv2.KMEANS_PP_CENTERS)
    ker = cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, int(ppm * 0.25)) | 1,) * 2)
    best = None
    for body in centers:  # marking text can dominate the centre: try each colour, keep the biggest solid blob
        if np.linalg.norm(body - bg) < 15:
            continue
        t = max(12.0, 0.45 * float(np.linalg.norm(body - bg)))
        mask = (np.linalg.norm(lab - body, axis=2) < t).astype(np.uint8)
        mask = cv2.morphologyEx(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, ker), cv2.MORPH_OPEN, ker)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        mask = np.zeros_like(mask)
        cv2.drawContours(mask, cnts, -1, 1, -1)  # fill holes (text, pin-1 dot)
        n, lab_img, stats, _ = cv2.connectedComponentsWithStats(mask)
        cen = lab_img[c - k // 2:c + k // 2 + 1, c - k // 2:c + k // 2 + 1].ravel()
        cen = cen[cen > 0]
        if cen.size == 0:
            continue
        idx = np.bincount(cen).argmax()
        x, y, w, h, area = stats[idx]
        if x <= 1 or y <= 1 or x + w >= S - 1 or y + h >= S - 1 or area < 0.6 * w * h:
            continue  # leaked into the board / not a solid body
        if best is None or area > best[4]:
            best = (x, y, w, h, area, t)
    if best is None:
        return None
    x, y, w, h, _, t = best
    if end_caps:  # 2-terminal: overall length incl. terminations + pads (anything not board) along the axis
        rows = slice(y + h // 4, y + 3 * h // 4 + 1)
        notbg = np.median(np.linalg.norm(lab[rows] - bg, axis=2), 0) > t
        x0, x1 = x, x + w - 1
        while x0 > 1 and notbg[x0 - 1]:
            x0 -= 1
        while x1 < S - 2 and notbg[x1 + 1]:
            x1 += 1
        return round((x1 - x0 + 1) / ppm, 2), round(h / ppm, 2), "extent"
    return round(w / ppm, 2), round(h / ppm, 2)


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
