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
    # least-squares similarity (all points count equally)
    zs = src[:, 0].astype(np.float64) + 1j * src[:, 1]
    zd = dst[:, 0].astype(np.float64) + 1j * dst[:, 1]
    ms, md = zs.mean(), zd.mean()
    den = float(np.sum(np.abs(zs - ms) ** 2))
    if den < 1e-12:
        raise ValueError("Reference points coincide")
    k = np.sum(np.conj(zs - ms) * (zd - md)) / den
    t = md - k * ms
    return np.float64([[k.real, -k.imag, t.real], [k.imag, k.real, t.imag]])


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


def blob_candidates(gray, max_r, polarity="auto"):
    """Round, isolated bright/dark blobs at several threshold levels: (x, y, r, quality)."""
    g = cv2.GaussianBlur(gray, (3, 3), 0)
    h, w = g.shape
    out = []
    pols = ("bright", "dark") if polarity == "auto" else (polarity,)
    for pol in pols:
        im = g if pol == "bright" else 255 - g
        levels = sorted({int(np.percentile(im, q)) for q in (80, 90, 96, 99, 99.7)} |
                        {int(cv2.threshold(im, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0])})
        for t in levels:
            _, bw = cv2.threshold(im, t, 255, cv2.THRESH_BINARY)
            cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
            for c in cnts:
                a = cv2.contourArea(c)
                if a < 10 or a > math.pi * max_r * max_r:
                    continue
                per = cv2.arcLength(c, True) + 1e-6
                circ = 4 * math.pi * a / per ** 2
                (bx, by), (bw_, bh_), _ = cv2.minAreaRect(c)
                asp = min(bw_, bh_) / max(1e-6, max(bw_, bh_))
                fill = a / max(1e-6, bw_ * bh_)
                if asp < 0.7 or (circ < 0.65 and fill < 0.85):
                    continue
                m = cv2.moments(c)
                x, y, r = m["m10"] / m["m00"], m["m01"] / m["m00"], math.sqrt(a / math.pi)
                # isolation: ring around the blob should be clearly darker (bright) / lighter (dark)
                R = int(r * 2.2) + 2
                x0, y0, x1, y1 = max(0, int(x) - R), max(0, int(y) - R), min(w, int(x) + R + 1), min(h, int(y) + R + 1)
                patch = im[y0:y1, x0:x1].astype(np.float32)
                yy, xx = np.mgrid[y0:y1, x0:x1]
                d = np.hypot(xx - x, yy - y)
                inner, ring = patch[d < r * 0.7], patch[(d > r * 1.4) & (d < r * 2.2)]
                if ring.size > 8:  # a board edge next to the mark: judge against the brighter half of the ring
                    ring = ring[ring >= np.median(ring)] if np.ptp(ring) > 60 else ring
                if inner.size < 3 or ring.size < 3:
                    continue
                con = (inner.mean() - ring.mean()) / 255
                if con < 0.04:
                    continue
                out.append((float(x), float(y), float(r), float(min(circ, 1) * asp * min(1, con * 3))))
    out.sort(key=lambda c: -c[3])
    keep = []
    for c in out:
        if all(math.dist(c[:2], k[:2]) > max(3, k[2]) for k in keep):
            keep.append(c)
    return keep


def evidence_map(gray, k=15):
    """Where soldered pads are: small bright metal spots (white top-hat). Soldered leads / terminals are shiny,
    solder mask, part bodies and silkscreen-free areas are not."""
    g = gray.astype(np.float32)
    k = max(5, int(k) | 1)
    th = cv2.morphologyEx(g, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    th = cv2.GaussianBlur(th, (0, 0), 1.5)
    return th / (np.percentile(th, 99.5) + 1e-6)


def layout_evidence(E, M, pts_src, shift_mm=1.5):
    """How much better the layout's pads land on image detail than the same pattern nudged a few mm away.
    ~1.0 = no better than chance (wrong alignment); >1.4 = the parts really are where the layout says."""
    if pts_src is None or len(pts_src) < 5:
        return None
    h, w = E.shape
    ppm = px_per_mm(M)
    base = apply(M, pts_src)

    def sample(p):
        ok = (p[:, 0] >= 0) & (p[:, 0] < w - 1) & (p[:, 1] >= 0) & (p[:, 1] < h - 1)
        if ok.mean() < 0.5:
            return None
        q = p[ok].astype(int)
        return float(E[q[:, 1], q[:, 0]].mean())

    on = sample(base)
    if on is None:
        return 0.0
    off = [sample(base + np.float64([dx, dy]) * shift_mm * ppm) for dx, dy in
           ((1, 0), (-1, 0), (0, 1), (0, -1), (0.7, 0.7), (-0.7, 0.7), (0.7, -0.7), (-0.7, -0.7))]
    off = [o for o in off if o is not None]
    return round(on / (np.mean(off) + 1e-6), 3) if off else None


def _layout_search(E, pts_by_yup, f, scales, angles, blob_mm=0.5):
    h, w = E.shape
    best = None
    for yu, pts in pts_by_yup.items():
        P0 = np.float64(pts)
        if len(P0) < 8:
            continue
        mean = P0.mean(0)
        P = P0 - mean
        for ang in angles:
            r = math.radians(ang)
            Rm = np.float64([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
            for sc in scales:
                k = sc * f
                q = P @ Rm.T * k
                mn = q.min(0)
                tw, th = np.ceil(q.max(0) - mn).astype(int) + 7
                if tw >= w or th >= h or tw < 12 or th < 12:
                    continue
                T = np.zeros((th, tw), np.float32)
                rad = max(1, int(round(blob_mm * k)))
                for x, y in (q - mn + 3).astype(int):
                    cv2.circle(T, (int(x), int(y)), rad, 1.0, -1)
                T = cv2.GaussianBlur(T, (0, 0), 1.2)
                T -= T.mean()
                res = cv2.matchTemplate(E, T, cv2.TM_CCORR_NORMED)
                _, mv, _, ml = cv2.minMaxLoc(res)
                if best is None or mv > best[0]:
                    c = np.float64(ml) + (-mn + 3)   # where the layout centroid lands (small px)
                    A = np.hstack([Rm * k, c[:, None]])
                    A[:, 2] -= A[:, :2] @ mean
                    best = (mv, A / f, yu, sc, ang)
    return best


def layout_register(img, pts_by_yup, ppm_range, angle_hint=None, work=520):
    """Coarse CAD-to-image alignment using every part: the layout's pad pattern is drawn and correlated with the
    image's detail map over plausible scales / rotations / mirror, then refined at a higher resolution.
    Needs no fiducial to be visible. pts_by_yup: {True: [...], False: [...]} pad points (mm_src frame).
    Returns (M full-res, y_up, score) or None."""
    gray = prep(img)
    H0, W0 = gray.shape

    def emap(work_px):
        f = min(1.0, work_px / max(H0, W0))
        E = evidence_map(cv2.resize(gray, None, fx=f, fy=f, interpolation=cv2.INTER_AREA), k=15 * f * 2)
        return (E - E.mean()).astype(np.float32), f

    E, f = emap(work)
    lo, hi = ppm_range
    angles = [angle_hint + k * 90 for k in range(4)] if angle_hint is not None else list(range(0, 360, 10))
    best = _layout_search(E, pts_by_yup, f, np.geomspace(lo, hi, 16), angles)
    if best is None:
        return None
    # fine pass around the winner: +-3 % scale, +-1.5 deg, twice the resolution
    _, A, yu, sc, ang = best
    E2, f2 = emap(work * 2)
    fine = _layout_search(E2, {yu: pts_by_yup[yu]}, f2, sc * np.linspace(0.97, 1.03, 13), ang + np.linspace(-1.5, 1.5, 7))
    if fine is not None:
        best = fine
    mv, A, yu, _, _ = best
    return A, yu, float(mv)


def _radial_profile(chans, p, r):
    x, y = p
    R = int(r * 2.5) + 2
    out = []
    for im in chans.values():
        xi, yi = int(round(x)), int(round(y))
        pat = im[yi - R:yi + R + 1, xi - R:xi + R + 1].astype(np.float32)
        if pat.shape != (2 * R + 1, 2 * R + 1):
            return None
        yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
        d = np.hypot(xx, yy) / max(r, 1.0)
        out += [float(pat[(d >= a) & (d < a + 0.25)].mean()) for a in np.arange(0, 2.5, 0.25)]
    v = np.float32(out)
    return (v - v.mean()) / (v.std() + 1e-3)


def fid_look_alike(chans, pts, r):
    """Real fiducials on a board all look the same (size, colour, ring around them); a wrong set usually mixes a
    via, a hole and a pad. Minimum pairwise similarity of rotation-free radial profiles, -1..1 (true sets ~0.7)."""
    P = [_radial_profile(chans, p, r) for p in pts]
    if len(P) < 2 or any(v is None for v in P):
        return 0.0
    return float(min((a * b).mean() for i, a in enumerate(P) for b in P[i + 1:]))


def auto_fiducials(img, fids, comps, y_up=True, fid_diam_mm=1.0, polarity="auto", max_cands=120, ppm_range=None, angle_hint=None,
                   evidence_src=None, pool_out=None):
    """Find fiducials without a known scale: hypothesise from candidate pairs, verify on all fiducials.

    Works on a downscaled copy for speed; returns (M, matched_px) in full-resolution px or (None, [])."""
    gray = prep(img)
    H0, W0 = gray.shape
    f = min(1.0, 1600.0 / max(H0, W0))
    gs = cv2.resize(gray, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else gray
    h, w = gs.shape
    src = [mm_src(q["x"], q["y"], y_up) for q in fids]
    all_src = np.float64([mm_src(c["x"], c["y"], y_up) for c in comps])
    cands = blob_candidates(gs, max_r=min(h, w) / 25, polarity=polarity)[:max_cands]
    if img.ndim == 3:
        cu = fid_channels(cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA))["copper"]
        for c in blob_candidates(cu, max_r=min(h, w) / 25, polarity="bright")[:max_cands]:
            if all(math.dist(c[:2], k[:2]) > max(3, k[2]) for k in cands):
                cands.append(c)
    for x, y, r in find_round_marks(gs, max_r=int(min(h, w) / 25))[:60]:
        if all(math.dist((x, y), c[:2]) > max(3, r) for c in cands):
            cands.append((x, y, r, 0.3))
    if len(cands) < 2:
        return None, []
    cxy = np.float64([(c[0], c[1]) for c in cands])
    cq = np.float64([c[3] for c in cands])
    i0, i1 = max(itertools.combinations(range(len(src)), 2), key=lambda ij: math.dist(src[ij[0]], src[ij[1]]))
    dsrc = math.dist(src[i0], src[i1])
    best = (-1, -1e18, None, None)
    hyps = []
    for a, b in itertools.permutations(range(len(cands)), 2):
        ra, rb = cands[a][2], cands[b][2]
        if not 0.6 < ra / rb < 1.66:
            continue
        s = math.dist(cxy[a], cxy[b]) / dsrc
        if not 0.3 < s * fid_diam_mm / (ra + rb) < 3.0:
            continue
        if ppm_range and not ppm_range[0] * f <= s <= ppm_range[1] * f:
            continue
        M = similarity_from_pairs([src[i0], src[i1]], [cxy[a], cxy[b]])
        if angle_hint is not None:
            da = (math.degrees(math.atan2(M[1, 0], M[0, 0])) - angle_hint) % 90
            if min(da, 90 - da) > 6:
                continue
        p = apply(M, all_src)
        span = np.ptp(p, axis=0)
        if max(span[0] / w, span[1] / h) < (0.25 if ppm_range else 0.5):  # the layout must fill a sensible part of the photo
            continue
        if np.mean((p[:, 0] > -2) & (p[:, 0] < w + 2) & (p[:, 1] > -2) & (p[:, 1] < h + 2)) < 0.9:
            continue
        pf = apply(M, src)
        dd = np.linalg.norm(pf[:, None, :] - cxy[None, :, :], axis=2)
        j = dd.argmin(1)
        d = dd[np.arange(len(src)), j]
        tol = max(2.0, 0.5 * (ra + rb) / 2, 0.8 * px_per_mm(M))  # layouts / lenses are rarely perfect: ~0.8 mm
        ok = d < tol
        score = float(cq[j[ok]].sum() - (d[ok] / tol).sum() * 0.2)
        hyps.append((int(ok.sum()), score, M, [tuple(cxy[k]) for k in j]))
        if (int(ok.sum()), score) > (best[0], best[1]):
            best = (int(ok.sum()), score, M, [tuple(cxy[k]) for k in j])
    auto_fiducials.confidence = None
    auto_fiducials.geom_ok = False
    auto_fiducials.look = None
    if hyps and len(src) >= 2:
        # among the geometric fits, the real set is the one whose dots all look alike
        chans = fid_channels(img)
        top_n = max(h_[0] for h_ in hyps)
        pool = sorted([h_ for h_ in hyps if h_[0] == top_n], key=lambda h_: -h_[1])[:3000]
        scored = []
        for h_ in pool:
            pts = [(q[0] / f, q[1] / f) for q in h_[3]]
            r_px = 0.5 * fid_diam_mm * px_per_mm(h_[2]) / f
            pf = apply(h_[2], src)
            res_mm = max(math.dist(pf[i], h_[3][i]) for i in range(len(src))) / px_per_mm(h_[2])
            scored.append((fid_look_alike(chans, pts, max(2.5, r_px * 1.2)), -res_mm, h_))
        scored.sort(key=lambda t: (-t[0], -t[1]))
        alike = [t for t in scored if t[0] >= 0.4][:200]
        if pool_out is not None:  # full-resolution candidate transforms for the caller to judge
            for t in (alike or scored)[:12]:
                Mt = t[2][2].copy() / f
                pool_out.append(Mt)
        if alike and evidence_src is not None and len(evidence_src) >= 5:
            # look-alike dots in the right geometry can still be holes / vias: the parts must land on soldered pads
            E = evidence_map(gs, k=15 * f)
            ev = [layout_evidence(E, t[2][2], np.float64(evidence_src)) or 0 for t in alike]
            k = int(np.argmax([e_ + 0.3 * t[0] for e_, t in zip(ev, alike)]))
            look, nres, h_ = alike[k]
            best = h_
            auto_fiducials.look, auto_fiducials.confidence = round(look, 3), ev[k]
            auto_fiducials.geom_ok = top_n >= min(3, len(src)) and -nres < 0.5 and ev[k] >= 1.08
        elif alike:
            look, nres, h_ = alike[0]
            best = h_
            auto_fiducials.look = round(look, 3)
            auto_fiducials.geom_ok = top_n >= min(3, len(src)) and -nres < 0.5
        elif top_n >= 3:
            best = (-1, -1e18, None, None)  # no set of look-alike dots in the right geometry
    if hyps and evidence_src is not None and len(evidence_src) >= 5 and not auto_fiducials.geom_ok and best[2] is not None:
        # several dot patterns can fit the fiducials; the right one is where the whole layout lands on real parts
        E = evidence_map(gs, k=15 * f)
        top_n = max(h_[0] for h_ in hyps)
        pool = sorted([h_ for h_ in hyps if h_[0] >= max(2, top_n - 1)], key=lambda h_: (-h_[0], -h_[1]))[:60]
        ev = [(layout_evidence(E, h_[2], np.float64(evidence_src)) or 0) for h_ in pool]
        k = int(np.argmax([e_ + 0.15 * h_[0] for e_, h_ in zip(ev, pool)]))
        best = pool[k]
        auto_fiducials.confidence = ev[k]
    if best[2] is None:
        return None, []
    M = best[2].copy()
    M /= 1.0  # to full resolution
    M[:, :] = M / f
    r_px = 0.5 * fid_diam_mm * px_per_mm(M)
    pts = [refine_center(gray, (p[0] / f, p[1] / f), r_px) for p in best[3]]
    pf = apply(M, src)
    keep = [i for i in range(len(src)) if math.dist(pf[i], pts[i]) < max(3.0, 0.3 * px_per_mm(M))]
    if len(keep) >= 2:
        M = similarity_from_pairs([src[i] for i in keep], [pts[i] for i in keep])
    return M, [pts[i] if i in keep else tuple(apply(M, [src[i]])[0]) for i in range(len(src))]


def fid_binary(win, polarity, thresh, blur):
    """Thresholded view of a search window (mark = white). Returns (binary, threshold used)."""
    b = int(blur) | 1
    w = cv2.GaussianBlur(win, (b, b), 0) if b > 1 else win
    img = w if polarity != "dark" else 255 - w
    if thresh is None:
        t, bw = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    else:
        t = thresh if polarity != "dark" else 255 - thresh
        _, bw = cv2.threshold(img, t, 255, cv2.THRESH_BINARY)
    return bw, int(t if polarity != "dark" else 255 - t)


def fid_channels(img):
    """Images the fiducial finder can work on: 'gray' (brightness) and 'copper' (bare copper / gold vs green or
    blue solder mask: LAB a*+b*, so a dull pad that is the same grey as the mask still stands out)."""
    if img.ndim == 2:
        return {"gray": img}
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    cu = np.clip((lab[..., 1] - 128) * 3 + (lab[..., 2] - 128) * 2 + 128, 0, 255).astype(np.uint8)
    return {"gray": prep(img), "copper": cu}


def find_fiducial(gray, pred, r_px, search_px, polarity="auto", thresh=None, shape="circle",
                  blur=3, rmin=None, rmax=None, roundness=0.55, template=None, min_match=0.0, channel="auto", topk=0):
    if topk:  # several candidates (distinct places), best first - for choosing a geometrically consistent set
        out = []
        chans = gray if isinstance(gray, dict) else {"gray": gray}
        for n, im in chans.items():
            if channel not in ("auto", n):
                continue
            tp = template.get(n) if isinstance(template, dict) else (template if n == "gray" else None)
            for r in _find_fiducial(im, pred, r_px, search_px, polarity, thresh, shape, blur, rmin, rmax, roundness,
                                    tp, min_match if tp is not None else 0.0, allc=True):
                out.append({**r, "channel": n})
        out.sort(key=lambda r: -r["score"])
        keep = []
        for r in out:
            if all(math.dist((r["px"], r["py"]), (k["px"], k["py"])) > max(2.0, r_px) for k in keep):
                keep.append(r)
        return keep[:topk]
    if isinstance(gray, dict):  # several channels: use the chosen one, or the best of all
        names = [c for c in gray if channel in ("auto", c)] or list(gray)
        best = None
        for n in names:
            tp = template.get(n) if isinstance(template, dict) else (template if n == "gray" else None)
            r = find_fiducial(gray[n], pred, r_px, search_px, polarity, thresh, shape, blur, rmin, rmax, roundness,
                              tp, min_match if tp is not None else 0.0)
            if r and (best is None or r["score"] > best["score"] * (1.15 if n != "gray" else 1 / 1.15)):
                best = {**r, "channel": n}
        return best
    return _find_fiducial(gray, pred, r_px, search_px, polarity, thresh, shape, blur, rmin, rmax, roundness, template, min_match)


def _find_fiducial(gray, pred, r_px, search_px, polarity="auto", thresh=None, shape="circle",
                   blur=3, rmin=None, rmax=None, roundness=0.55, template=None, min_match=0.0, allc=False):
    """Best fiducial blob near *pred* (px). r_px = expected radius (half side for squares).

    polarity: bright | dark | auto; thresh: 0-255 or None (Otsu + a few brighter levels).
    rmin/rmax: allowed radius window (default 0.6-1.5 x r_px) - every hit is size-validated.
    template: taught grey patch of the mark; when given, the hit must also correlate >= min_match.
    Returns {px, py, score 0-1, r, thresh, polarity, match} or None."""
    H, W = gray.shape
    x, y, R = int(round(pred[0])), int(round(pred[1])), int(max(search_px, r_px * 2.5, 8))
    x0, y0, x1, y1 = max(0, x - R), max(0, y - R), min(W, x + R + 1), min(H, y + R + 1)
    win = gray[y0:y1, x0:x1]
    if win.size < 25:
        return [] if allc else None
    rmin = rmin if rmin else r_px * 0.6
    rmax = rmax if rmax else r_px * 1.5
    exp_area = (4.0 if shape == "square" else math.pi) * r_px * r_px
    b = int(blur) | 1
    wb = cv2.GaussianBlur(win, (b, b), 0) if b > 1 else win
    best = None
    allr = []
    for pol in (("bright", "dark") if polarity == "auto" else (polarity,)):
        img = wb if pol == "bright" else 255 - wb
        ts = [int(thresh) if pol == "bright" else 255 - int(thresh)] if thresh is not None else \
            [int(cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0])]
        if thresh is None:
            ts += [min(250, ts[0] + d) for d in (20, 40, 70)]
        for t in ts:
            _, bw = cv2.threshold(img, t, 255, cv2.THRESH_BINARY)
            cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
            for c in cnts:
                a = cv2.contourArea(c)
                if a < 6:
                    continue
                req = math.sqrt(a / (4.0 if shape == "square" else math.pi))
                if not rmin <= req <= rmax:
                    continue  # size-validated against the taught radius
                per = cv2.arcLength(c, True) + 1e-6
                circ = 4 * math.pi * a / per ** 2
                (bx, by), (bw_, bh_), _ = cv2.minAreaRect(c)
                fill = a / max(1e-6, bw_ * bh_)
                aspect = min(bw_, bh_) / max(1e-6, max(bw_, bh_))
                rnd = (min(1.0, fill / 0.85) if shape == "square" else min(1.0, circ / 0.85)) * aspect
                if rnd < roundness:
                    continue
                size = math.exp(-1.2 * abs(math.sqrt(a / exp_area) - 1))
                m = cv2.moments(c)
                if m["m00"] <= 0:
                    continue
                cx, cy = x0 + m["m10"] / m["m00"], y0 + m["m01"] / m["m00"]
                dist = math.dist((cx, cy), pred) / max(1.0, R)
                mask = np.zeros(win.shape, np.uint8)
                cv2.drawContours(mask, [c], -1, 255, -1)
                ring = cv2.dilate(mask, np.ones((max(3, int(r_px)) | 1,) * 2, np.uint8)) & ~mask
                inside, outside = cv2.mean(img, mask)[0], cv2.mean(img, ring)[0] if ring.any() else 0
                con = min(1.0, max(0.0, (inside - outside) / max(25.0, 2.5 * float(win.std()))))
                score = rnd * size * (0.4 + 0.6 * con) * (1 - 0.5 * min(1, dist))
                mt = None
                if template is not None:
                    th_, tw_ = template.shape
                    qx0, qy0 = int(round(cx - tw_ / 2)), int(round(cy - th_ / 2))
                    patch = gray[max(0, qy0):qy0 + th_, max(0, qx0):qx0 + tw_]
                    mt = ncc(patch, template) if patch.shape == template.shape else 0.0
                    if mt < min_match:
                        continue
                    score = score * (0.5 + 0.5 * max(0.0, mt))
                cand = {"px": float(cx), "py": float(cy), "score": round(float(score), 3), "r": round(req, 1),
                            "thresh": int(t if pol == "bright" else 255 - t), "polarity": pol,
                            "roundness": round(float(rnd), 2), "match": round(float(mt), 3) if mt is not None else None}
                allr.append(cand)
                if best is None or score > best["score"]:
                    best = cand
    return allr if allc else best


def suggest_fid(gray, p, r_guess=12):
    """Measure the mark under/near p: polarity, radius, Otsu threshold -> suggested finder settings."""
    x, y, R = int(p[0]), int(p[1]), int(max(12, r_guess * 3))
    H, W = gray.shape
    win = gray[max(0, y - R):min(H, y + R + 1), max(0, x - R):min(W, x + R + 1)]
    if win.size < 25:
        return None
    best = None
    for pol in ("bright", "dark"):
        img = cv2.GaussianBlur(win, (3, 3), 0)
        img = img if pol == "bright" else 255 - img
        t, bw = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        n, lab, st, cen = cv2.connectedComponentsWithStats(bw)
        for i in range(1, n):
            a = st[i, cv2.CC_STAT_AREA]
            if a < 8 or a > 0.5 * win.size:
                continue
            w_, h_ = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
            asp = min(w_, h_) / max(w_, h_)
            d = math.dist(cen[i], (min(x, R), min(y, R)))
            q = asp * (a / max(1, w_ * h_)) - d / R
            if best is None or q > best[0]:
                best = (q, pol, math.sqrt(a / math.pi), int(t if pol == "bright" else 255 - t))
    if not best:
        return None
    _, pol, r, t = best
    return {"polarity": pol, "r_px": round(r, 1), "threshold": t, "rmin_px": round(r * 0.6, 1), "rmax_px": round(r * 1.5, 1)}


def fit_marks(src, dst, reject_mm=None):
    """Similarity fit with residuals. Drops the worst point while it is > reject_mm off and >2 points remain."""
    idx = list(range(len(src)))
    while True:
        M = similarity_from_pairs([src[i] for i in idx], [dst[i] for i in idx])
        ppm = px_per_mm(M)
        res = [math.dist(apply(M, [src[i]])[0], dst[i]) / ppm for i in range(len(src))]
        worst = max(idx, key=lambda i: res[i])
        if reject_mm is None or len(idx) <= 2 or res[worst] <= reject_mm:
            return M, res, idx
        idx.remove(worst)


# ---------------------------------------------------------------- registration
def _h3(M):
    M = np.float64(M)
    return M if M.shape == (3, 3) else np.vstack([M, [0, 0, 1]])


def happly(H, pts):
    pts = np.float64(pts).reshape(-1, 2)
    q = np.hstack([pts, np.ones((len(pts), 1))]) @ _h3(H).T
    return q[:, :2] / q[:, 2:3]


def _orb_homography(g, t, f):
    """test -> golden homography from ORB features (handles a tilted camera). Returns (H, inliers)."""
    gs = cv2.resize(g, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else g
    ts = cv2.resize(t, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else t
    orb = cv2.ORB_create(6000, fastThreshold=10)
    k1, d1 = orb.detectAndCompute(cv2.equalizeHist(ts), None)
    k2, d2 = orb.detectAndCompute(cv2.equalizeHist(gs), None)
    if d1 is None or d2 is None or len(k1) < 10 or len(k2) < 10:
        return None, 0
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(d1, d2, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.8 * n.distance]
    if len(good) < 12:
        return None, 0
    a = np.float32([k1[m.queryIdx].pt for m in good]) / f
    b = np.float32([k2[m.trainIdx].pt for m in good]) / f
    H, inl = cv2.findHomography(a, b, cv2.RANSAC, 4 / f, maxIters=5000, confidence=0.999)
    if H is None:
        return None, 0
    return H, int(inl.sum())


def refine_ecc_h(g, t, H, scale=0.5):
    """ECC refinement of a test->golden homography. Returns (H, ok)."""
    try:
        S = np.diag([scale, scale, 1.0])
        gs = cv2.resize(g, None, fx=scale, fy=scale).astype(np.float32)
        ts = cv2.resize(t, None, fx=scale, fy=scale).astype(np.float32)
        W0 = (S @ np.linalg.inv(_h3(H)) @ np.linalg.inv(S)).astype(np.float32)
        W0 /= W0[2, 2]
        _, W1 = cv2.findTransformECC(gs, ts, W0, cv2.MOTION_HOMOGRAPHY,
                                     (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-5), None, 5)
        H2 = np.linalg.inv(np.linalg.inv(S) @ W1.astype(np.float64) @ S)
        H2 /= H2[2, 2]
        corners = np.float64([[0, 0], [g.shape[1], 0], [0, g.shape[0]], [g.shape[1], g.shape[0]]])
        if np.abs(happly(H2, happly(np.linalg.inv(_h3(H)), corners)) - corners).max() > 0.03 * max(g.shape):
            return H, False
        return H2, True
    except (cv2.error, np.linalg.LinAlgError):
        return H, False


def _fid_refine(t, H, fids, chans=None):
    """Find the program fiducials in the test image where H (test->golden) predicts them, then correct H so they
    land exactly on the golden fiducials. Returns (H, max residual px, n) or None."""
    if not fids or H is None:
        return None
    Hi = np.linalg.inv(_h3(H))
    got_t, got_g = [], []
    details = []
    for f in fids:
        pred = happly(Hi, [f["px"]])[0]
        best = None
        for sr in (f["search"], f["search"] * 3):
            best = find_fiducial(chans or t, pred, f["r"], sr, f.get("polarity", "auto"), f.get("threshold"), f.get("shape", "circle"),
                                 blur=f.get("blur", 3), rmin=f.get("rmin"), rmax=f.get("rmax"), roundness=f.get("roundness", 0.55),
                                 template=f.get("template"), min_match=f.get("min_match", 0.0), channel=f.get("channel", "auto"))
            if best and best["score"] >= f.get("min_score", 0.3):
                break
            best = None
        details.append({"ref": f.get("ref"), "found": bool(best), **({k: best[k] for k in ("score", "match", "r")} if best else {})})
        if best:
            got_t.append((best["px"], best["py"]))
            got_g.append(tuple(f["px"]))
    _fid_refine.last = details
    if len(got_t) < 2:
        return None
    a = happly(H, got_t)  # where H puts the found dots (golden frame)
    b = np.float64(got_g)
    if len(a) >= 3:
        C, _ = cv2.estimateAffine2D(a, b, method=cv2.LMEDS)
        if C is None:
            C = similarity_from_pairs(a, b)
    else:
        C = similarity_from_pairs(a, b)
    lin = C[:, :2]
    sv = np.linalg.svd(lin, compute_uv=False)
    if sv.max() > 1.05 or sv.min() < 0.95 or abs(math.degrees(math.atan2(lin[1, 0], lin[0, 0]))) > 3:
        return None  # dots found don't agree with the board estimate - ignore them
    H2 = _h3(C) @ _h3(H)
    res = np.linalg.norm(happly(H2, got_t) - b, axis=1)
    return H2 / H2[2, 2], float(res.max()), len(got_t)


def consistent_fids(src, cand_lists, max_res_mm=0.8, ppm_hint=None, chans=None, r_px=4.0):
    """Pick one candidate per fiducial (or none) so the set fits a similarity best.
    src: mm_src points; cand_lists: per fiducial [{px, py, score}...]. Returns list of chosen dicts / None."""
    idx = [i for i, c in enumerate(cand_lists) if c]
    if len(idx) < 2:
        return [c[0] if c else None for c in cand_lists]
    best = None
    for combo in itertools.product(*[range(len(cand_lists[i])) for i in idx]):
        pts = [(cand_lists[i][k]["px"], cand_lists[i][k]["py"]) for i, k in zip(idx, combo)]
        ss = [src[i] for i in idx]
        M = similarity_from_pairs(ss, pts)
        ppm = px_per_mm(M)
        if ppm_hint and not 0.85 < ppm / ppm_hint < 1.15:
            continue
        res = [math.dist(apply(M, [a])[0], b) / ppm for a, b in zip(ss, pts)]
        sc = sum(cand_lists[i][k]["score"] for i, k in zip(idx, combo))
        look = fid_look_alike(chans, pts, r_px) if chans is not None else 0.0
        key = (max(res) if len(idx) > 2 else 0) - 0.2 * sc - 0.6 * look
        if len(idx) > 2 and max(res) > max_res_mm:
            continue
        if best is None or key < best[0]:
            best = (key, dict(zip(idx, combo)))
    if best is None:
        return [None] * len(cand_lists)
    return [cand_lists[i][best[1][i]] if i in best[1] else None for i in range(len(cand_lists))]


def align_score(g, t, H, f=0.25):
    """How well test warped by H matches golden (gradient NCC on a small copy), -1..1."""
    Hh, W = g.shape
    S = np.diag([f, f, 1.0])
    gs = cv2.resize(g, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    ws = cv2.warpPerspective(cv2.resize(t, None, fx=f, fy=f, interpolation=cv2.INTER_AREA), S @ _h3(H) @ np.linalg.inv(S),
                             (gs.shape[1], gs.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    return ncc(grad(cv2.GaussianBlur(gs, (3, 3), 0)), grad(cv2.GaussianBlur(ws, (3, 3), 0)))


def register(golden, test, anchors_px, patch=60, prefer=None, fids=None, min_score=0.25):
    """Warp *test* into golden frame (perspective-correct, so a tilted camera is fine).

    Coarse estimates from fiducial templates, ORB features and the board outline; each is refined by ECC and
    locked onto the program fiducials found in the test image. The estimate whose warped image matches the
    golden best wins; below *min_score* the board is reported as not aligned instead of failing every part.
    fids: [{px:(x,y) golden, r: radius px, search: px, shape, polarity, threshold}]."""
    g, t = prep(golden), prep(test)
    H0, W = g.shape
    cands = []
    src, dst, scores = [], [], []
    for (x, y) in anchors_px:
        x0, y0 = int(max(0, x - patch)), int(max(0, y - patch))
        x1, y1 = int(min(W, x + patch)), int(min(H0, y + patch))
        tpl = g[y0:y1, x0:x1]
        if tpl.size == 0:
            continue
        sr = int(max(W, H0) * 0.12)
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
    if len(src) >= 2 and prefer != "features":
        cands.append(("fiducial", _h3(similarity_from_pairs(dst, src))))
    f = min(1.0, 1400.0 / max(t.shape))
    Ho, inl = _orb_homography(g, t, f)
    if Ho is not None and inl >= 15:
        cands.append(("features", Ho))
    Mb = register_outline(golden, test, g, t)
    if Mb is not None:
        cands.append(("outline", _h3(Mb)))
    if t.shape == g.shape:
        cands.append(("identity", np.eye(3)))
    if not cands:
        return None, {"ok": False, "method": "none", "msg": "Board not found - check position / lighting"}
    best, tried = None, []
    chans = fid_channels(test) if fids else None
    _fid_refine.last = []
    fid_detail = []
    for name, H in cands:
        method = name
        s0 = align_score(g, t, H)
        H2, refined = refine_ecc_h(g, t, H)
        if refined and align_score(g, t, H2) >= s0 - 0.01:
            H, method = H2, method + "+ecc"
        fr = _fid_refine(t, H, fids, chans)
        det = list(getattr(_fid_refine, "last", []))
        fid_res = None
        if fr and align_score(g, t, fr[0]) >= align_score(g, t, H) - 0.02:
            H, fid_res = fr[0], fr[1]
            method += f"+fid{fr[2]}"
        sc = align_score(g, t, H)
        tried.append({"method": method, "score": round(sc, 3)})
        if best is None or sc > best[0]:
            best = (sc, H, method, fid_res)
            fid_detail = det
        if sc > 0.75:
            break
    sc, H, method, fid_res = best
    A = H[:2] / H[2, 2]
    ang = math.degrees(math.atan2(A[1, 0], A[0, 0]))
    info = {"method": method, "M": H.tolist(), "src_shape": list(test.shape[:2]), "shift_px": [float(A[0, 2]), float(A[1, 2])],
            "angle": ang, "scale": px_per_mm(A), "scores": scores, "match": round(sc, 3), "tried": tried,
            "fid_residual_px": round(fid_res, 2) if fid_res is not None else None, "fids": fid_detail}
    if sc < min_score:
        return None, {**info, "ok": False, "msg": f"Alignment failed (match {sc:.2f}) - check fiducials / board position, or re-teach the golden"}
    warped = cv2.warpPerspective(test, H, (W, H0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return warped, {**info, "ok": True}


def board_rect(img):
    """Board rectangle by its solder-mask colour (the colour at the middle of the photo), so tape, fixtures or a
    same-brightness background don't join it. Returns ((cx, cy), (w, h), angle), mask or None."""
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(cv2.GaussianBlur(img, (5, 5), 0), cv2.COLOR_BGR2HSV)
    c = hsv[int(h * .3):int(h * .7), int(w * .3):int(w * .7)].reshape(-1, 3)
    H0, S0 = np.median(c[:, 0]), np.median(c[:, 1])
    dh = np.abs(hsv[..., 0].astype(np.int16) - int(H0))
    dh = np.minimum(dh, 180 - dh)
    m = ((dh < 14) & (hsv[..., 1] > max(40, 0.45 * S0)) & (hsv[..., 2] > 25)).astype(np.uint8)
    k = max(5, int(min(h, w) / 100)) | 1
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k * 3, k * 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    n, lbl, st, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        return None
    i = 1 + int(np.argmax(st[1:, 4]))
    if st[i, 4] < 0.05 * h * w:
        return None
    cnts, _ = cv2.findContours((lbl == i).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnt = max(cnts, key=cv2.contourArea)
    full = np.zeros((h, w), np.uint8)
    cv2.drawContours(full, [cnt], -1, 1, -1)
    return cv2.minAreaRect(cnt), full


def board_outline(img):
    """Board rectangle ((cx, cy), (w, h), angle) + mask, found against a plain background. None if unclear."""
    lab = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2LAB), (7, 7), 0).astype(np.float32)
    h, w = lab.shape[:2]
    border = np.concatenate([lab[:10].reshape(-1, 3), lab[-10:].reshape(-1, 3), lab[:, :10].reshape(-1, 3), lab[:, -10:].reshape(-1, 3)])
    bg = np.median(border, 0)
    spread = np.percentile(np.linalg.norm(border - bg, axis=1), 60)  # tape / board touching the edge must not dominate
    m = (np.linalg.norm(lab - bg, axis=2) > min(45.0, max(18.0, 2.5 * spread))).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    n, lbl, st, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        return None
    i = 1 + int(np.argmax(st[1:, 4]))
    if st[i, 4] < 0.05 * h * w or st[i, 4] > 0.95 * h * w:
        return None
    mask = (lbl == i).astype(np.uint8)
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull = cv2.convexHull(max(cnts, key=cv2.contourArea))
    full = np.zeros_like(mask)
    cv2.fillConvexPoly(full, hull, 1)
    return cv2.minAreaRect(hull), full


def register_outline(g_img, t_img, g, t):
    """test->golden transform from the board outlines (tries 0/90/180/270 corner orders, keeps best NCC)."""
    go, to = board_outline(g_img), board_outline(t_img)
    if go is None or to is None:
        return None
    gb, tb = cv2.boxPoints(go[0]), cv2.boxPoints(to[0])
    if abs(max(go[0][1]) / min(go[0][1]) - max(to[0][1]) / min(to[0][1])) > 0.15 * max(go[0][1]) / min(go[0][1]):
        return None  # different shape: not the same board view
    best = (-2, None)
    small = lambda a: cv2.resize(a, None, fx=0.25, fy=0.25)
    for k in range(4):
        M, _ = cv2.estimateAffinePartial2D(np.roll(tb, k, axis=0), gb)
        if M is None:
            continue
        wt = cv2.warpAffine(t, M, (g.shape[1], g.shape[0]))
        sc = ncc(small(g), small(wt))
        if sc > best[0]:
            best = (sc, M)
    return best[1] if best[0] > 0.3 else None


def match_lighting(gold, test, sigma_frac=0.04):
    """Make *test* look lit like *gold*: per LAB channel, match the local mean and contrast (large-scale gain and
    offset), so a darker / warmer / unevenly lit shot compares like-for-like. Small detail is untouched."""
    lg = cv2.cvtColor(gold, cv2.COLOR_BGR2LAB).astype(np.float32)
    lt = cv2.cvtColor(test, cv2.COLOR_BGR2LAB).astype(np.float32)
    sig = max(8.0, sigma_frac * max(gold.shape[:2]))
    out = np.empty_like(lt)
    for c in range(3):
        mg, mt = cv2.GaussianBlur(lg[..., c], (0, 0), sig), cv2.GaussianBlur(lt[..., c], (0, 0), sig)
        sg = np.sqrt(np.maximum(cv2.GaussianBlur((lg[..., c] - mg) ** 2, (0, 0), sig), 1.0))
        st = np.sqrt(np.maximum(cv2.GaussianBlur((lt[..., c] - mt) ** 2, (0, 0), sig), 1.0))
        gain = np.clip(sg / st, 0.5, 2.5) if c == 0 else np.clip(sg / st, 0.7, 1.4)
        out[..., c] = (lt[..., c] - mt) * gain + mg
    return cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def sharpness(img):
    g = prep(img) if img.ndim == 3 else img
    return float(cv2.Laplacian(cv2.GaussianBlur(g, (3, 3), 0), cv2.CV_32F).var())


def match_sharpness(a, b, tol=1.25):
    """Blur whichever of a / b is sharper until both have similar detail. Returns (a, b, info)."""
    sa, sb = sharpness(a), sharpness(b)
    info = {"golden": round(sa, 1), "board": round(sb, 1), "blurred": None}
    if min(sa, sb) <= 0 or max(sa, sb) / min(sa, sb) < tol:
        return a, b, info
    sharp_is_a = sa > sb
    src, target = (a, sb) if sharp_is_a else (b, sa)
    out, sig = src, 0.0
    for s_ in (0.5, 0.7, 0.9, 1.1, 1.4, 1.8, 2.3, 3.0):
        cand = cv2.GaussianBlur(src, (0, 0), s_)
        out, sig = cand, s_
        if sharpness(cand) <= target * 1.05:
            break
    info["blurred"] = {"image": "golden" if sharp_is_a else "board", "sigma": sig}
    return (out, b, info) if sharp_is_a else (a, out, info)


def refine_ecc(g, t, M, scale=0.5):
    """Sub-pixel whole-image refinement of test->golden affine M (ECC). Returns (M, ok)."""
    try:
        gs = cv2.resize(g, None, fx=scale, fy=scale).astype(np.float32)
        ts = cv2.resize(t, None, fx=scale, fy=scale).astype(np.float32)
        # ECC wants warp mapping template(golden) coords -> input(test) coords
        Ms = cv2.invertAffineTransform(M).astype(np.float32)
        Ms[:, 2] *= scale
        _, Ms = cv2.findTransformECC(gs, ts, Ms, cv2.MOTION_AFFINE,
                                     (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), None, 5)
        Ms[:, 2] /= scale
        M2 = cv2.invertAffineTransform(Ms)
        # reject a refinement that wanders far from the initial estimate
        corners = np.float64([[0, 0], [g.shape[1], 0], [0, g.shape[0]], [g.shape[1], g.shape[0]]])
        if np.abs(apply(M2, corners) - apply(M, corners)).max() > 0.02 * max(g.shape):
            return M, False
        return M2, True
    except cv2.error:
        return M, False


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


DEFAULTS = {"bridge": 1.2, "presence": 0.6, "polarity_margin": 0.08, "ocv": 0.45, "offset_mm": 0.35, "search_mm": 0.8,
            "ocv_min_ppm": 12.0, "bridge_min_gap_px": 3.0}


def _body_slice(shape, pkg, ppm, frac=0.8):
    hx, hy = pkg.body_l * ppm * frac / 2, pkg.body_w * ppm * frac / 2
    cx, cy = shape[1] / 2, shape[0] / 2
    return (slice(max(0, int(cy - hy)), int(cy + hy) + 1), slice(max(0, int(cx - hx)), int(cx + hx) + 1))


def _mm_slice(shape, roi, ppm):
    """[cx, cy, w, h] mm (body frame, y up) -> slices in an upright crop centred on the body."""
    cx, cy, w, h = roi
    x0 = shape[1] / 2 + (cx - w / 2) * ppm
    y0 = shape[0] / 2 - (cy + h / 2) * ppm
    return (slice(max(0, int(y0)), max(1, int(y0 + h * ppm) + 1)), slice(max(0, int(x0)), max(1, int(x0 + w * ppm) + 1)))


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
        if pkg.pol_roi:
            # user-placed marker box: compare it with the same box on the part turned 180 deg
            ps = _mm_slice(tpl.shape, pkg.pol_roi, ppm)
            a, b, g0 = found[ps], cv2.rotate(found, cv2.ROTATE_180)[ps], tpl[ps]
            if g0.size > 9:
                n0, n1 = ncc(grad(a), grad(g0)), ncc(grad(b), grad(g0))
                out["polarity"] = round(n0 - n1, 3)
                if ti == 0 and n1 > n0 + th["polarity_margin"]:
                    pol_fail = True
        elif ti == 0 and g_f > g_n + th["polarity_margin"] and fv > score - th["polarity_margin"]:  # body must flip; neighbours ignored
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
        if checks.get("ocv") and ppm < th.get("ocv_min_ppm", 12):
            out["ocv_skipped"] = f"image resolution {ppm:.1f} px/mm is too low to read markings (needs ~{th.get('ocv_min_ppm', 12):g})"
        elif checks.get("ocv"):
            bs = _mm_slice(tpl.shape, pkg.ocv_roi, ppm) if pkg.ocv_roi else _body_slice(tpl.shape, pkg, ppm, 0.7)
            sm = lambda a: cv2.GaussianBlur(a, (0, 0), 1.2)  # tolerate focus / JPEG differences
            ocv = max(ncc(grad(sm(found[bs])), grad(sm(t[bs]))) for t in templates) if found[bs].size > 16 else 1.0
            out["ocv"] = round(ocv, 3)
            if ocv < th["ocv"]:
                fails.append("MARKING")
    gaps = pad_gaps(pkg) if checks.get("bridge", len(pkg.pads) >= 4) else []
    min_gap_px = min((min(g[2], g[3]) / 0.6 for g in gaps), default=0) * ppm
    if gaps and min_gap_px < th.get("bridge_min_gap_px", 3.0):
        out["bridge_skipped"] = f"lead gap is only {min_gap_px:.1f} px at this resolution - too small to judge bridges"
    elif checks.get("bridge", len(pkg.pads) >= 4) and "MISSING" not in fails:
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


def fit_body(img_bgr, center, angle, ppm, search_mm=20.0, end_caps=False, min_area_mm2=0.0):
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
        if area < min_area_mm2 * ppm * ppm:
            continue  # a marking letter or pin-1 dot, not the body
        if best is None or area > best[4]:
            best = (x, y, w, h, area, t)
    if best is None:
        return None
    x, y, w, h, _, t = best
    if end_caps:  # 2-terminal: overall length incl. terminations + pads (anything not board) along the axis
        rows = slice(y + h // 4, y + 3 * h // 4 + 1)
        notbg = np.median(np.linalg.norm(lab[rows] - bg, axis=2), 0) > t
        x0, x1 = x, x + w - 1
        lim = max(2, int(0.45 * w))  # terminations+pads never add more than ~45% per side
        while x0 > 1 and notbg[x0 - 1] and x - x0 < lim:
            x0 -= 1
        while x1 < S - 2 and notbg[x1 + 1] and x1 - (x + w - 1) < lim:
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


# ---------------------------------------------------------------- whole-board golden compare
def _cmp_planes(img):
    """Lighting-normalised planes for comparison: CLAHE lightness + two chroma channels."""
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (3, 3), 0), cv2.COLOR_BGR2LAB)
    L = _clahe.apply(lab[..., 0])
    return [L.astype(np.float32), lab[..., 1].astype(np.float32) * 2, lab[..., 2].astype(np.float32) * 2]


def diff_map(golden, test, slack_px=2):
    """Per-pixel difference that tolerates +/- slack_px misregistration (min-max comparison)."""
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2 * slack_px + 1,) * 2)
    out = None
    for g, t in zip(_cmp_planes(golden), _cmp_planes(test)):
        t = t - np.median(t - g)  # global brightness offset
        hi, lo = cv2.dilate(g, k), cv2.erode(g, k)
        d = np.maximum(t - hi, lo - t).clip(0)
        out = d if out is None else np.maximum(out, d)
    return out


def diff_defects(golden, test, tol=None, base=28.0, min_area_px=40, slack_px=2, merge_px=12, max_area_px=None, min_peak=0.0, big_mean=None):
    """Blobs where *test* differs from *golden* beyond the learned tolerance map."""
    d = diff_map(golden, test, slack_px)
    thr = base if tol is None else np.maximum(base, tol * 1.3 + 8)
    m = (d > thr).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    core = m.copy()
    m = cv2.dilate(m, np.ones((merge_px | 1,) * 2, np.uint8))  # one call per defect, not per fragment
    n, lbl, st, cen = cv2.connectedComponentsWithStats(m)
    out = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        blob = lbl == i
        core_area = int(core[blob].sum())
        if core_area < min_area_px // 3:
            continue
        if max_area_px and core_area > max_area_px:
            # large change: keep only if strong throughout (missing / wrong part), drop patchy flux / shine / texture
            if big_mean is None or float(d[blob & (core > 0)].mean()) < big_mean:
                continue
        if float(d[blob].max()) < min_peak:
            continue
        out.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h), "area": int(a),
                    "cx": float(cen[i][0]), "cy": float(cen[i][1]), "score": round(float(d[lbl == i].max()), 1)})
    return out, d


# ---------------------------------------------------------------- teach: snap a box onto a part
def snap_part(img, x, y, ppm, sizes_mm=(3, 4.5, 7, 10, 15, 22)):
    """Find the part under (x, y). In growing windows: board colour = window border, part = pixels far from it
    (Otsu), keep the blob at the click once it sits fully inside the window. Returns dict(cx, cy, l, w, angle) px."""
    h, w = img.shape[:2]
    per_win_all = []
    core = None
    for s_mm in sizes_mm:
        r = int(s_mm * ppm / 2)
        x0, y0, x1, y1 = max(0, int(x) - r), max(0, int(y) - r), min(w, int(x) + r), min(h, int(y) + r)
        if x1 - x0 < 10 or y1 - y0 < 10:
            continue
        lab = cv2.GaussianBlur(cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2LAB), (3, 3), 0).astype(np.float32)
        b = 2
        border = np.concatenate([lab[:b].reshape(-1, 3), lab[-b:].reshape(-1, 3), lab[:, :b].reshape(-1, 3), lab[:, -b:].reshape(-1, 3)])
        bg = np.median(border, 0)
        d = np.linalg.norm((lab - bg) * (1.0, 1.4, 1.4), axis=2)
        d8 = np.clip(d * 2, 0, 255).astype(np.uint8)
        t, _ = cv2.threshold(d8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        cx, cy = int(x) - x0, int(y) - y0
        k = max(3, int(ppm * 0.25)) | 1
        gL = cv2.GaussianBlur(lab[..., 0], (0, 0), 1.0)
        gmag = cv2.magnitude(cv2.Sobel(gL, cv2.CV_32F, 1, 0), cv2.Sobel(gL, cv2.CV_32F, 0, 1))
        gmag = cv2.dilate(gmag, np.ones((3, 3), np.uint8))
        cands = []
        for level in (t, t * 0.6, t * 0.4, t * 0.25):  # dark part on dark board: marking text beats the body at Otsu
            m = (d8 > max(level, 14)).astype(np.uint8)
            m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
            m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for cnt in cnts:
                if cv2.pointPolygonTest(cnt, (cx, cy), True) < -0.6 * ppm:
                    continue  # must contain (or touch) the click
                area = cv2.contourArea(cnt)
                if area < (0.7 * ppm) ** 2:
                    continue
                bx, by, bw, bh = cv2.boundingRect(cnt)
                inside = bx > 1 and by > 1 and bx + bw < (x1 - x0) - 1 and by + bh < (y1 - y0) - 1
                (mx, my), (a, bb), ang = cv2.minAreaRect(cnt)
                rot_area, box_area = a * bb, bw * bh
                if rot_area > 0.85 * box_area:  # a rotated box is not clearly tighter: keep it square to the board
                    mx, my, a, bb, ang = bx + bw / 2, by + bh / 2, bw, bh, 0.0
                    rect_fill = area / max(1.0, box_area)
                else:
                    rect_fill = area / max(1.0, rot_area)
                if a < bb:
                    a, bb, ang = bb, a, ang + 90
                pts = cnt.reshape(-1, 2)
                edge = float(gmag[pts[:, 1].clip(0, gmag.shape[0] - 1), pts[:, 0].clip(0, gmag.shape[1] - 1)].mean())
                cands.append((inside, rect_fill > 0.7, edge * rect_fill, {"cx": float(mx + x0), "cy": float(my + y0), "l": float(a), "w": float(bb), "angle": float(ang)}, 0, area))
        good = [c for c in cands if c[0] and c[1]]
        if good:
            g = max(good, key=lambda c: c[5])
            if core is None:
                core = g  # smallest clean, fully-seen blob: at least part of the body
            elif g[5] <= 8 * core[5] and abs(g[3]["cx"] - core[3]["cx"]) < g[3]["l"] / 2 and abs(g[3]["cy"] - core[3]["cy"]) < g[3]["l"] / 2 \
                    and g[2] >= 0.8 * core[2]:
                core = g  # grew to a bigger clean outline around the core with an edge as strong: the full body
            else:
                return core[3]
        elif core is not None:
            return core[3]
        per_win_all.append(cands)
    if core is not None:
        return core[3]
    for cands in per_win_all:  # nothing fully inside any window: best guess from the smallest window that saw something
        if cands:
            return max(cands, key=lambda c: (c[1], c[5]))[3]
    return None


def presence_onpad(test_bgr, center, angle, pkg, ppm, gold_bgr, min_on=0.5, search_mm=None):
    """Acceptance-style check: is a part there, and is at least `min_on` of it on its footprint?

    Ignores marking, vendor, colour of the body and 180-degree turns of non-polar parts.
    The part is 'what is not bare board' in the footprint; bare-board colour is sampled around it.
    """
    L, W = pkg.body_l * ppm, pkg.body_w * ppm
    m = int(max(1.5 * ppm, 0.6 * min(L, W)))
    size = (L + 2 * m, W + 2 * m)

    def part_mask(img):
        crop = crop_rot(img, center, angle, size)
        lab = cv2.GaussianBlur(cv2.cvtColor(crop, cv2.COLOR_BGR2LAB), (3, 3), 0).astype(np.float32)
        ring = np.ones(lab.shape[:2], bool)
        ring[m // 2:-m // 2 or None, m // 2:-m // 2 or None] = False
        bare = np.median(lab[ring].reshape(-1, 3), 0)
        d = np.linalg.norm((lab - bare) * (1.0, 1.4, 1.4), axis=2)
        return d, crop.shape[:2]
    dg, shp = part_mask(gold_bgr)
    dt, _ = part_mask(test_bgr)
    thr = max(18.0, 0.35 * float(np.percentile(dg[m:-m or None, m:-m or None], 60)))
    g = dg > thr
    t = dt > thr
    body = np.zeros(shp, bool)
    body[m:m + int(W), m:m + int(L)] = True
    golden_cover = g[body].mean()  # how much of the footprint the part covered on the golden
    test_cover = t[body].mean()
    present = test_cover >= 0.4 * golden_cover
    # on-pad: overlap of test part with golden part region (dilated a little for tolerance)
    gp = cv2.dilate(g.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    overlap = (t & gp & body).sum() / max(1, (g & body).sum())
    return {"presence": round(float(test_cover / max(golden_cover, 1e-3)), 3), "on_pad": round(float(overlap), 3),
            "fails": [] if present and overlap >= min_on else (["MISSING"] if not present else ["OFF PAD"])}


# ---------------------------------------------------------------- bare board helpers
def part_blobs(gold, bare, ppm, min_mm2=0.3):
    """Parts = compact regions where the populated golden differs from the bare board."""
    d = diff_map(bare, gold, max(1, int(ppm * 0.1)))
    m = (d > 45).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((max(3, int(ppm * 0.3)) | 1,) * 2, np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for cn in cnts:
        area = cv2.contourArea(cn)
        if area < min_mm2 * ppm * ppm or area > 0.25 * m.size:
            continue
        (cx, cy), (a, b), ang = cv2.minAreaRect(cn)
        if a < b:
            a, b, ang = b, a, ang + 90
        norm = ((ang + 45) % 90) - 45
        if abs(norm) < 8:
            ang -= norm
        out.append({"cx": float(cx), "cy": float(cy), "l": float(a), "w": float(b), "angle": float(ang), "area": float(area)})
    return out


def presence_vs_bare(test, gold, bare, center, angle, pkg, ppm):
    """Present = the part area looks more like the golden than like the bare board (lighting-normalised)."""
    size = roi_size(pkg, ppm, 0.3)
    sl = _body_slice((int(round(size[1])), int(round(size[0]))), pkg, ppm, 0.9)
    crops = [cv2.cvtColor(crop_rot(im, center, angle, size), cv2.COLOR_BGR2LAB).astype(np.float32) for im in (test, gold, bare)]
    def norm(c):  # per-channel normalise on the whole crop (body + surrounding board): removes gain/offset
        return (c - c.reshape(-1, 3).mean(0)) / (c.reshape(-1, 3).std(0) + 4.0)
    crops = [norm(c) for c in crops]
    t, g, b = (c[sl] for c in crops)
    if t.size < 12:
        return {"presence": 1.0, "fails": []}
    dg = float(np.linalg.norm(t - g, axis=2).mean())
    db = float(np.linalg.norm(t - b, axis=2).mean())
    score = db / max(dg + db, 1e-3)  # 1 = like golden, 0 = like bare
    return {"presence": round(score, 3), "fails": [] if score >= 0.5 else ["MISSING"]}


def review_crop(img, center, angle, pkg, ppm, out=260):
    """Colour zoom for the operator: part + 2 mm of surroundings, upright, with the ROI outlined."""
    hx, hy = pkg.extent()
    side = 2 * (max(hx, hy) + 2.0) * ppm
    crop = crop_rot(img, center, angle, (side, side))
    k = out / crop.shape[1]
    crop = cv2.resize(crop, (out, out), interpolation=cv2.INTER_CUBIC if k > 1 else cv2.INTER_AREA)
    c, s = out / 2, ppm * k
    cv2.rectangle(crop, (int(c - hx * s), int(c - hy * s)), (int(c + hx * s), int(c + hy * s)), (255, 200, 0), 1, cv2.LINE_AA)
    return crop
