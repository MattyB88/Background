"""Synthetic demo board generator (for demos, tests and training without a camera)."""
from __future__ import annotations

import math
import cv2
import numpy as np

from .packages import derive
from . import vision

PPM = 20.0  # px per mm
BOARD = (60.0, 40.0)

DEMO = [
    ("FID1", 3, 3, 0, "FIDUCIAL", "FID1MM"), ("FID2", 57, 37, 0, "FIDUCIAL", "FID1MM"), ("FID3", 57, 3, 0, "FIDUCIAL", "FID1MM"),
    ("U1", 20, 25, 0, "LM358", "SOIC-8"), ("U2", 42, 26, 90, "ATTINY", "SOIC-14"), ("Q1", 12, 10, 0, "BC847", "SOT-23"),
    ("D1", 30, 10, 0, "1N4148", "SOD-123"), ("LED1", 48, 10, 180, "RED LED", "LED 0805"),
    ("R1", 10, 30, 0, "10K", "0603"), ("R2", 10, 20, 90, "4K7", "0603"), ("C1", 30, 33, 0, "100N", "0805"),
    ("C2", 52, 33, 90, "10U", "1206"), ("R3", 38, 16, 0, "1K", "0402"), ("C3", 22, 16, 45, "1U", "0805"),
]


def csv_text():
    lines = ["Designator,Mid X,Mid Y,Rotation,Comment,Footprint"]
    lines += [f"{r},{x},{y},{a},{p},{k}" for r, x, y, a, p, k in DEMO]
    return "\n".join(lines)


def _M(offset=(40, 30), angle=0.0, board=BOARD):
    a = math.radians(angle)
    s = PPM
    return np.float64([[s * math.cos(a), -s * math.sin(a), offset[0]], [s * math.sin(a), s * math.cos(a), offset[1] + board[1] * s]])


def layout_from(components, margin=3.0):
    """Turn imported program components into a synth layout (shifted so the board starts at 0,0)."""
    x0 = min(c["x"] for c in components) - margin
    y0 = min(c["y"] for c in components) - margin
    lay = [(c["ref"], c["x"] - x0, c["y"] - y0, c["rot"], c["part"] or c["ref"], c["package"]) for c in components]
    board = (max(c[1] for c in lay) + margin, max(c[2] for c in lay) + margin)
    return lay, board


def render(defects=None, light=1.0, angle=0.0, offset=(40, 30), noise=4, seed=0, layout=None, board=None):
    """defects: {ref: 'missing'|'polarity'|'offset'|'marking'}"""
    BOARD = board or globals()["BOARD"]
    defects = defects or {}
    rng = np.random.default_rng(seed)
    W, H = int(BOARD[0] * PPM + 80), int(BOARD[1] * PPM + 60)
    img = np.full((H, W, 3), (30, 30, 30), np.uint8)
    M = _M(offset, angle, BOARD)
    corners = vision.apply(M, [vision.mm_src(x, y) for x, y in [(0, 0), (BOARD[0], 0), BOARD, (0, BOARD[1])]])
    cv2.fillPoly(img, [np.int32(corners)], (40, 110, 40))
    for ref, x, y, rot, part, pk in (layout or DEMO):
        pkg = derive(pk, part)
        comp = {"x": x, "y": y, "rot": rot}
        d = defects.get(ref)
        if d == "offset":
            comp["x"] += 0.6
        if d == "polarity":
            comp["rot"] = (rot + 180) % 360
        c, ang = vision.comp_pose(M, comp)
        if pkg.kind == "fiducial":
            cv2.circle(img, tuple(np.int32(c)), int(0.5 * PPM), (200, 210, 210), -1, cv2.LINE_AA)
            continue
        R = cv2.getRotationMatrix2D((0, 0), -ang, 1)[:, :2]

        def poly(cx, cy, l, w):
            pts = np.float64([[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]]) + (cx, -cy)
            return np.int32(pts * PPM @ R.T + c)
        # pads (nominal location; for offset defect pads stay put)
        pc, _ = vision.comp_pose(M, {"x": x, "y": y, "rot": rot})
        for px_, py_, l, w in pkg.pads:
            pts = np.float64([[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]]) + (px_, -py_)
            Rn = cv2.getRotationMatrix2D((0, 0), -vision.comp_pose(M, {"x": x, "y": y, "rot": rot})[1], 1)[:, :2]
            cv2.fillPoly(img, [np.int32(pts * PPM @ Rn.T + pc)], (170, 180, 185), cv2.LINE_AA)
        if d == "missing":
            continue
        body_col = (35, 35, 35) if pkg.kind in ("ic", "sot", "diode", "qfp") else ((60, 100, 150) if pkg.kind == "chip" and part[0].isdigit() and "U" not in part and "N" not in part else (40, 75, 120))
        if pkg.kind == "led":
            body_col = (220, 220, 230)
        cv2.fillPoly(img, [poly(0, 0, pkg.body_l, pkg.body_w)], body_col, cv2.LINE_AA)
        for px_, py_, l, w in pkg.pads:  # leads / end caps
            cv2.fillPoly(img, [poly(px_, py_, l * 0.7, w * 0.7)], (200, 200, 205), cv2.LINE_AA)
        if pkg.polarized:
            if pkg.kind in ("diode", "led"):
                cv2.fillPoly(img, [poly(-pkg.body_l * 0.3, 0, pkg.body_l * 0.12, pkg.body_w * 0.9)], (220, 220, 220) if pkg.kind != "led" else (40, 150, 40), cv2.LINE_AA)
            else:
                p1 = poly(-pkg.body_l * 0.35, -pkg.body_w * 0.25, 0.01, 0.01)[0]
                cv2.circle(img, tuple(int(v) for v in p1), max(2, int(0.18 * PPM)), (120, 120, 120), -1, cv2.LINE_AA)
        if pkg.marking and pkg.body_l > 2.5:
            txt = "XXXX" if d == "marking" else part[:6]
            canvas = np.zeros((int(pkg.body_w * PPM), int(pkg.body_l * PPM), 3), np.uint8)
            fs = min(canvas.shape[1] / (len(txt) * 22), canvas.shape[0] / 40)
            cv2.putText(canvas, txt, (int(canvas.shape[1] * 0.2), int(canvas.shape[0] * 0.65)), cv2.FONT_HERSHEY_SIMPLEX, fs, (190, 190, 190), 1, cv2.LINE_AA)
            Mt = cv2.getRotationMatrix2D((canvas.shape[1] / 2, canvas.shape[0] / 2), -ang, 1)
            Mt[0, 2] += c[0] - canvas.shape[1] / 2
            Mt[1, 2] += c[1] - canvas.shape[0] / 2
            warped = cv2.warpAffine(canvas, Mt, (W, H))
            mask = warped.max(axis=2) > 60
            img[mask] = warped[mask]
    img = np.clip(img.astype(np.float32) * light + rng.normal(0, noise, img.shape), 0, 255).astype(np.uint8)
    return img
