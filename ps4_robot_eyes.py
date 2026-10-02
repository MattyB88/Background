#!/usr/bin/env python3
"""
PS4 Camera Robot Eyes
AR robot-vision overlay: phosphor/thermal/night modes, edge detection,
scanlines, face targeting HUD, motion alerts, and stereo depth map.

Usage:
    python ps4_robot_eyes.py [camera_index]

Keys:
    m - cycle vision mode (PHOSPHOR / THERMAL / NIGHT / RAW)
    e - toggle edge overlay
    s - toggle scanlines
    t - toggle face targeting
    h - toggle HUD
    d - toggle depth map (stereo only)
    v - toggle vignette
    q / Esc - quit
"""

import cv2
import numpy as np
import time
import sys

# ── Vision mode pipeline ──────────────────────────────────────────────────────

MODE_NAMES = ["PHOSPHOR", "THERMAL", "NIGHT", "RAW"]


def _phosphor(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    out = np.zeros_like(frame)
    out[:, :, 1] = gray
    return out


def _thermal(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.applyColorMap(gray, cv2.COLORMAP_INFERNO)


def _night(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    boosted = clahe.apply(gray)
    out = np.zeros_like(frame)
    out[:, :, 1] = boosted
    return out


MODES = {
    "PHOSPHOR": _phosphor,
    "THERMAL":  _thermal,
    "NIGHT":    _night,
    "RAW":      lambda f: f.copy(),
}

# Mode-matched edge tint: (B, G, R)
EDGE_TINT = {
    "PHOSPHOR": (0, 255, 80),
    "THERMAL":  (255, 100, 0),
    "NIGHT":    (0, 200, 255),
    "RAW":      (0, 220, 255),
}

HUD_COLOR = {
    "PHOSPHOR": (0, 200, 80),
    "THERMAL":  (200, 80, 0),
    "NIGHT":    (0, 180, 220),
    "RAW":      (0, 200, 80),
}


# ── Robot Eyes ────────────────────────────────────────────────────────────────

class RobotEyes:
    def __init__(self, camera_index: int = 0):
        self.cap = cv2.VideoCapture(camera_index)
        if not self.cap.isOpened():
            raise RuntimeError(f"Cannot open camera {camera_index}")

        self.mode_idx = 0
        self.show_edges = True
        self.show_scanlines = True
        self.show_hud = True
        self.show_depth = True
        self.show_tracking = True
        self.show_vignette = True

        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

        self.prev_gray = None
        self.motion_detected = False
        self.motion_flash = 0
        self.lock_flash = 0
        self.frame_count = 0
        self.fps = 0.0
        self._fps_tick = time.time()

        # Stereo depth matcher
        self._stereo_matcher = cv2.StereoBM_create(numDisparities=64, blockSize=15)

        # Detect stereo by aspect ratio on first frame
        ret, frame = self.cap.read()
        if not ret:
            raise RuntimeError("Camera returned no frames")
        h, w = frame.shape[:2]
        self.stereo = (w / h) > 2.5
        if self.stereo:
            print(f"Stereo frame detected ({w}x{h}) — splitting eyes")
        else:
            print(f"Mono camera ({w}x{h})")

        # Pre-build vignette mask (rebuilt if frame size changes)
        self._vignette = self._make_vignette(h, w if not self.stereo else w // 2)
        self._last_size = (h, w)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _make_vignette(self, h, w):
        cy, cx = h / 2, w / 2
        Y, X = np.ogrid[:h, :w]
        dist = np.sqrt(((X - cx) / cx) ** 2 + ((Y - cy) / cy) ** 2)
        mask = np.clip(1 - dist * 0.6, 0, 1).astype(np.float32)
        return np.dstack([mask, mask, mask])

    def _split_stereo(self, frame):
        w = frame.shape[1] // 2
        return frame[:, :w], frame[:, w:]

    def _apply_scanlines(self, frame):
        out = frame.copy()
        out[::3] = (out[::3] * 0.5).astype(np.uint8)
        return out

    def _apply_edges(self, original, processed, tint):
        gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 60, 140)
        edge_layer = np.zeros_like(processed)
        for i, c in enumerate(tint):
            edge_layer[:, :, i] = (edges.astype(np.float32) * (c / 255)).astype(np.uint8)
        return cv2.addWeighted(processed, 0.85, edge_layer, 0.55, 0)

    def _apply_vignette(self, frame):
        h, w = frame.shape[:2]
        if (h, w) != self._last_size:
            self._vignette = self._make_vignette(h, w)
            self._last_size = (h, w)
        return (frame.astype(np.float32) * self._vignette).astype(np.uint8)

    def _detect_motion(self, gray):
        if self.prev_gray is None or self.prev_gray.shape != gray.shape:
            self.prev_gray = gray
            return False
        diff = cv2.absdiff(self.prev_gray, gray)
        _, thresh = cv2.threshold(diff, 20, 255, cv2.THRESH_BINARY)
        self.prev_gray = gray
        return cv2.countNonZero(thresh) > 800

    def _draw_targeting(self, frame, faces, hud_color):
        if len(faces) > 0:
            self.lock_flash = 6
        for (x, y, w, h) in faces:
            cx, cy = x + w // 2, y + h // 2
            corner = min(w, h) // 4
            lw = 2

            # Corner brackets
            for (px, py), (dx, dy) in [
                ((x,     y    ), (+1, +1)),
                ((x + w, y    ), (-1, +1)),
                ((x,     y + h), (+1, -1)),
                ((x + w, y + h), (-1, -1)),
            ]:
                cv2.line(frame, (px, py), (px + dx * corner, py), hud_color, lw)
                cv2.line(frame, (px, py), (px, py + dy * corner), hud_color, lw)

            # Center pip
            cv2.line(frame, (cx - 6, cy), (cx + 6, cy), hud_color, 1)
            cv2.line(frame, (cx, cy - 6), (cx, cy + 6), hud_color, 1)

            # Distance estimate (rough, based on face width vs frame width)
            dist_label = f"{max(1, int(500 / (w + 1))):3d}cm"
            cv2.putText(frame, f"LOCK  {dist_label}", (x, y - 6),
                        cv2.FONT_HERSHEY_PLAIN, 0.85, (0, 60, 255), 1)
        return frame

    def _compute_depth(self, left_gray, right_gray):
        disp = self._stereo_matcher.compute(left_gray, right_gray)
        norm = cv2.normalize(disp, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8U)
        colored = cv2.applyColorMap(norm, cv2.COLORMAP_PLASMA)
        cv2.putText(colored, "DEPTH MAP", (8, 18),
                    cv2.FONT_HERSHEY_PLAIN, 1.0, (220, 220, 220), 1)
        return colored

    def _draw_hud(self, frame, mode_name, hud_color, motion):
        h, w = frame.shape[:2]
        dim = tuple(max(0, int(c * 0.45)) for c in hud_color)
        now = time.strftime("%H:%M:%S")

        # FPS + mode
        cv2.putText(frame, f"FPS {self.fps:4.1f}", (8, 18),
                    cv2.FONT_HERSHEY_PLAIN, 1.0, hud_color, 1)
        cv2.putText(frame, f"[ {mode_name} ]", (8, 34),
                    cv2.FONT_HERSHEY_PLAIN, 1.0, hud_color, 1)

        # Timestamp top-right
        cv2.putText(frame, now, (w - 72, 18),
                    cv2.FONT_HERSHEY_PLAIN, 1.0, hud_color, 1)

        # Bottom bar
        cv2.putText(frame, "ROBOT EYES v1.0", (8, h - 8),
                    cv2.FONT_HERSHEY_PLAIN, 0.85, dim, 1)

        # Outer border
        cv2.rectangle(frame, (1, 1), (w - 2, h - 2), dim, 1)

        # Central reticle
        cx, cy = w // 2, h // 2
        cv2.circle(frame, (cx, cy), 22, dim, 1)
        cv2.line(frame, (cx - 32, cy), (cx - 24, cy), dim, 1)
        cv2.line(frame, (cx + 24, cy), (cx + 32, cy), dim, 1)
        cv2.line(frame, (cx, cy - 32), (cx, cy - 24), dim, 1)
        cv2.line(frame, (cx, cy + 24), (cx, cy + 32), dim, 1)

        # Motion alert
        if motion and self.motion_flash > 0:
            alert_color = (0, 40, 255)
            cv2.putText(frame, "! MOTION DETECTED !", (w // 2 - 90, 52),
                        cv2.FONT_HERSHEY_PLAIN, 1.4, alert_color, 2)
            self.motion_flash -= 1

        # Lock flash
        if self.lock_flash > 0:
            cv2.putText(frame, "TARGET ACQUIRED", (w // 2 - 70, h - 24),
                        cv2.FONT_HERSHEY_PLAIN, 1.1, (0, 60, 255), 1)
            self.lock_flash -= 1

        return frame

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self):
        print("\n=== ROBOT EYES — ONLINE ===")
        print("  m  cycle mode   e  edges   s  scanlines")
        print("  t  targeting    h  HUD     d  depth")
        print("  v  vignette     q  quit\n")

        while True:
            ret, frame = self.cap.read()
            if not ret:
                break

            self.frame_count += 1
            now = time.time()
            if now - self._fps_tick >= 1.0:
                self.fps = self.frame_count / (now - self._fps_tick)
                self.frame_count = 0
                self._fps_tick = now

            mode_name = MODE_NAMES[self.mode_idx]
            hud_color = HUD_COLOR[mode_name]
            edge_tint = EDGE_TINT[mode_name]

            # Split stereo if needed
            if self.stereo:
                left, right = self._split_stereo(frame)
                display = left
            else:
                display = frame
                right = None

            gray = cv2.cvtColor(display, cv2.COLOR_BGR2GRAY)

            # Motion detection
            if self._detect_motion(gray):
                self.motion_detected = True
                self.motion_flash = 12
            else:
                self.motion_detected = False

            # Color grade
            processed = MODES[mode_name](display)

            # Edge overlay
            if self.show_edges:
                processed = self._apply_edges(display, processed, edge_tint)

            # Scanlines
            if self.show_scanlines:
                processed = self._apply_scanlines(processed)

            # Vignette
            if self.show_vignette:
                processed = self._apply_vignette(processed)

            # Face targeting
            if self.show_tracking:
                faces = self.face_cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=4, minSize=(50, 50)
                )
                processed = self._draw_targeting(processed, faces, hud_color)

            # HUD
            if self.show_hud:
                processed = self._draw_hud(processed, mode_name, hud_color,
                                           self.motion_detected)

            # Stereo depth panel
            if self.stereo and self.show_depth and right is not None:
                right_gray = cv2.cvtColor(right, cv2.COLOR_BGR2GRAY)
                depth = self._compute_depth(gray, right_gray)
                dh = processed.shape[0]
                dw = int(depth.shape[1] * dh / depth.shape[0])
                depth = cv2.resize(depth, (dw, dh))
                output = np.hstack([processed, depth])
            else:
                output = processed

            cv2.imshow("ROBOT EYES", output)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            elif key == ord("m"):
                self.mode_idx = (self.mode_idx + 1) % len(MODE_NAMES)
            elif key == ord("e"):
                self.show_edges = not self.show_edges
            elif key == ord("s"):
                self.show_scanlines = not self.show_scanlines
            elif key == ord("t"):
                self.show_tracking = not self.show_tracking
            elif key == ord("h"):
                self.show_hud = not self.show_hud
            elif key == ord("d"):
                self.show_depth = not self.show_depth
            elif key == ord("v"):
                self.show_vignette = not self.show_vignette

        self.cap.release()
        cv2.destroyAllWindows()
        print("ROBOT EYES — OFFLINE")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    cam = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    try:
        RobotEyes(camera_index=cam).run()
    except RuntimeError as e:
        print(f"Error: {e}")
        print("Try a different camera index:  python ps4_robot_eyes.py 1")
        sys.exit(1)


if __name__ == "__main__":
    main()
