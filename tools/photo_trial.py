"""Stress-test the AOI on real/AI photos without placement files.

    python tools/photo_trial.py photo1.jpg photo2.jpg ... [--out DIR]

Per photo: program from image -> 5 good training captures -> 10 repeat captures (must PASS)
-> 1 board with 5 injected faults (missing / reversed / shifted / wrong part / solder ball) that must be found.
Every "capture" is re-shot: random shift, rotation, lighting, blur, noise and JPEG.
"""
import argparse, json, math, shutil, sys, tempfile
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import aoi.program as P  # noqa: E402
from aoi import autodetect  # noqa: E402


def capture(img, seed, strength=1.0):
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), rng.uniform(-1, 1) * strength, 1 + rng.uniform(-0.004, 0.004) * strength)
    M[:, 2] += rng.uniform(-15, 15, 2) * strength
    out = cv2.warpAffine(img, M, (w, h), borderMode=cv2.BORDER_REFLECT)
    gain = 1 + rng.uniform(-0.15, 0.15) * strength
    grad = np.linspace(1 - 0.08 * strength, 1 + 0.08 * strength, w)[None, :, None] if rng.random() < .5 else 1
    out = out.astype(np.float32) * gain * grad + rng.uniform(-8, 8) * strength
    s = rng.uniform(0, 0.8) * strength
    if s > 0.2:
        out = cv2.GaussianBlur(out, (0, 0), s)
    out = np.clip(out + rng.normal(0, 3 * strength, out.shape), 0, 255).astype(np.uint8)
    q = int(rng.uniform(80, 93))
    return cv2.imdecode(cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, q])[1], cv2.IMREAD_COLOR)


def board_mask(img):
    lab = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2LAB), (9, 9), 0)
    bg = autodetect.board_colour(lab)
    m = (np.linalg.norm(lab.astype(np.float32)[..., 1:] - bg[1:], axis=2) < 20).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    n, lbl, st, _ = cv2.connectedComponentsWithStats(m)
    big = 1 + int(np.argmax(st[1:, 4]))
    hull = cv2.convexHull(cv2.findNonZero((lbl == big).astype(np.uint8)))
    out = np.zeros(m.shape, np.uint8)
    cv2.fillConvexPoly(out, hull, 1)
    return cv2.erode(out, np.ones((41, 41), np.uint8))


def inject(img, parts, ppm, seed):
    """Apply 5 faults to a copy of img. Returns (img, [(kind, x, y, radius)])."""
    rng = np.random.default_rng(seed)
    out = img.copy()
    h, w = img.shape[:2]
    bm = board_mask(img)
    ok = [p for p in parts if 1.2 * ppm < p["l"] < 12 * ppm and bm[int(p["cy"]), int(p["cx"])]]
    rng.shuffle(ok)
    chosen = []
    for p in ok:  # keep targets apart
        if all(math.hypot(p["cx"] - q["cx"], p["cy"] - q["cy"]) > 6 * ppm for q in chosen):
            chosen.append(p)
        if len(chosen) == 4:
            break
    faults = []

    def box(p, grow):
        b = cv2.boxPoints(((p["cx"], p["cy"]), (p["l"] + grow, p["w"] + grow), p["angle"]))
        x0, y0 = np.int32(b.min(0)); x1, y1 = np.int32(b.max(0))
        return max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    for kind, p in zip(["missing", "reversed", "shifted", "wrong part"], chosen):
        x0, y0, x1, y1 = box(p, 0.3 * ppm)
        patch = out[y0:y1, x0:x1].copy()
        if kind == "missing":
            m = np.zeros(out.shape[:2], np.uint8); m[y0:y1, x0:x1] = 255
            out = cv2.inpaint(out, m, 7, cv2.INPAINT_TELEA)
        elif kind == "reversed":
            out[y0:y1, x0:x1] = cv2.rotate(patch, cv2.ROTATE_180)
        elif kind == "shifted":
            m = np.zeros(out.shape[:2], np.uint8); m[y0:y1, x0:x1] = 255
            out = cv2.inpaint(out, m, 7, cv2.INPAINT_TELEA)
            d = int(0.5 * ppm)
            out[y0:y1, x0 + d:x1 + d] = patch[:, :max(0, min(x1 + d, w) - (x0 + d))]
        else:
            hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
            hsv[..., 0] = (hsv[..., 0].astype(int) + 60) % 180
            hsv[..., 1] = np.clip(hsv[..., 1].astype(int) + 60, 0, 255)
            out[y0:y1, x0:x1] = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
        faults.append((kind, p["cx"], p["cy"], max(p["l"], p["w"]) / 2 + (0.5 * ppm if kind == "shifted" else 0)))
    # solder ball on bare board
    for _ in range(200):
        x, y = rng.uniform(4 * ppm, w - 4 * ppm), rng.uniform(4 * ppm, h - 4 * ppm)
        if bm[int(y), int(x)] and all(math.hypot(x - p["cx"], y - p["cy"]) > max(p["l"], p["w"]) + 2 * ppm for p in parts):
            cv2.circle(out, (int(x), int(y)), int(0.25 * ppm), (205, 205, 210), -1, cv2.LINE_AA)
            faults.append(("solder ball", x, y, 0.25 * ppm))
            break
    return out, faults


def trial(photo, outdir, ppm=20.0):
    img = cv2.imread(str(photo))
    root = Path(tempfile.mkdtemp())
    P.ROOT = root
    prog = P.Program(Path(photo).stem)
    info = autodetect.program_from_image(prog, img, ppm)
    for s in range(5):
        prog.train_good(capture(img, 100 + s))
    fc, fc_parts = 0, []
    for s in range(10):
        r = prog.inspect(capture(img, 200 + s), f"good{s}")
        bad = [c for c in r["components"] if not c["ok"]]
        fc += bool(bad)
        fc_parts += [c["ref"] for c in bad]
    parts, _ = autodetect.detect(img, ppm=ppm)
    faulty, faults = inject(img, parts, ppm, 7)
    r = prog.inspect(capture(faulty, 300), "faulty")
    found = []
    for kind, x, y, rad in faults:
        hit = any(math.hypot(c["cx"] - x, c["cy"] - y) < rad + 2.0 * ppm for c in r["components"] if not c["ok"])
        found.append((kind, hit))
    extra = [c for c in r["components"] if not c["ok"] and
             all(math.hypot(c["cx"] - x, c["cy"] - y) >= rad + 2.0 * ppm for _, x, y, rad in faults)]
    # save a picture of the faulty result
    vis = cv2.imread(str(prog.dir / "runs" / r["run"] / "board.jpg"))
    for c in r["components"]:
        if not c["ok"]:
            cv2.circle(vis, (int(c["cx"]), int(c["cy"])), int(1.6 * ppm), (0, 0, 255), 3)
    for kind, x, y, _ in faults:
        cv2.putText(vis, kind, (int(x) + 30, int(y)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
    outdir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(outdir / f"{Path(photo).stem}_faulty_result.jpg"), vis)
    res = {"photo": Path(photo).name, "parts": info["parts"], "holes": info["holes"],
           "good_boards_with_false_calls": fc, "false_call_spots": len(fc_parts),
           "faults_found": sum(h for _, h in found), "faults": len(found), "detail": found,
           "extra_calls_on_faulty": len(extra), "cycle_s": r["cycle_s"]}
    shutil.rmtree(root, ignore_errors=True)
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("photos", nargs="+")
    ap.add_argument("--out", default="trial_out")
    a = ap.parse_args()
    rows = []
    for ph in a.photos:
        r = trial(ph, Path(a.out))
        rows.append(r)
        print(f"{r['photo']:<12} parts {r['parts']:>3} holes {r['holes']:>2} | good boards w/ false call {r['good_boards_with_false_calls']}/10 "
              f"({r['false_call_spots']} spots) | faults found {r['faults_found']}/{r['faults']} "
              f"{[k for k, h in r['detail'] if not h]} | extra calls {r['extra_calls_on_faulty']} | {r['cycle_s']}s", flush=True)
    Path(a.out, "results.json").write_text(json.dumps(rows, indent=1))
