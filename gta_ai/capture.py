"""Frame capture from the Remote Play window, without a capture card.

Sources (the `capture.source` setting):
  window:<title text>   Windows only. Captures the client area of the first visible
                        window whose title contains the text. Use "PS Remote Play"
                        or "chiaki". The window must be on screen, NOT minimised.
  monitor:<n>           Whole monitor n (1 = primary).
  region:x,y,w,h        A fixed screen rectangle.
  file:<path>           A still image, for testing without a console.
"""
from __future__ import annotations

import base64
import io
import logging
import sys
import time
from dataclasses import dataclass

from PIL import Image, ImageStat

log = logging.getLogger(__name__)


@dataclass
class Frame:
    image: Image.Image          # resized RGB frame that was sent to the model
    jpeg: bytes
    captured_at: float
    source_size: tuple[int, int]
    mean_brightness: float

    @property
    def b64(self) -> str:
        return base64.standard_b64encode(self.jpeg).decode("ascii")


def _set_dpi_aware() -> None:
    if sys.platform != "win32":
        return
    import ctypes

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # per-monitor
    except Exception:  # noqa: BLE001
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:  # noqa: BLE001
            pass


def find_window_region(title_substr: str) -> dict:
    """Return the mss region of the largest visible window whose title matches."""
    if sys.platform != "win32":
        raise RuntimeError("window:<title> capture is Windows-only; use monitor: or region:")
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    own_console = ctypes.windll.kernel32.GetConsoleWindow()
    needle = title_substr.lower()
    found: list[tuple[int, int, str]] = []

    proc_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def cb(hwnd, _lparam):
        if hwnd == own_console or not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n == 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        title = buf.value
        # Skip consoles/editors that merely mention the title (e.g. our own command line).
        if needle in title.lower() and "gta_ai" not in title.lower():
            r = wintypes.RECT()
            user32.GetClientRect(hwnd, ctypes.byref(r))
            found.append((r.right * r.bottom, hwnd, title))
        return True

    user32.EnumWindows(proc_type(cb), 0)
    if not found:
        raise RuntimeError(f"no visible window with {title_substr!r} in its title")
    _, hwnd, title = max(found)
    if user32.IsIconic(hwnd):
        raise RuntimeError(f"window {title!r} is minimised; restore it (capture needs it on screen)")
    rect = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rect))
    pt = wintypes.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    if rect.right <= 0 or rect.bottom <= 0:
        raise RuntimeError(f"window {title!r} has an empty client area")
    return {"left": pt.x, "top": pt.y, "width": rect.right, "height": rect.bottom}


class Capturer:
    def __init__(self, source: str, max_width: int = 1280, jpeg_quality: int = 70) -> None:
        self.source = source
        self.max_width = max_width
        self.jpeg_quality = jpeg_quality
        self._sct = None
        self._file_img: Image.Image | None = None
        kind, _, arg = source.partition(":")
        self.kind, self.arg = kind.lower(), arg
        if self.kind not in {"window", "monitor", "region", "file"}:
            raise ValueError(f"bad capture source {source!r}")
        _set_dpi_aware()

    def _mss(self):
        # mss instances are per-thread; create lazily on the thread that grabs.
        if self._sct is None:
            import mss

            self._sct = mss.mss()
        return self._sct

    def _region(self) -> dict:
        if self.kind == "window":
            return find_window_region(self.arg)
        if self.kind == "monitor":
            idx = int(self.arg or 1)
            return dict(self._mss().monitors[idx])
        x, y, w, h = (int(v) for v in self.arg.split(","))
        return {"left": x, "top": y, "width": w, "height": h}

    def grab_raw(self) -> Image.Image:
        if self.kind == "file":
            if self._file_img is None:
                self._file_img = Image.open(self.arg).convert("RGB")
            return self._file_img.copy()
        shot = self._mss().grab(self._region())
        return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

    def grab(self) -> Frame:
        t = time.time()
        img = self.grab_raw()
        src_size = img.size
        if img.width > self.max_width:
            h = round(img.height * self.max_width / img.width)
            img = img.resize((self.max_width, h), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=self.jpeg_quality)
        brightness = ImageStat.Stat(img.convert("L")).mean[0]
        if brightness < 3:
            log.warning(
                "captured frame is almost black (%.1f). Is the window covered/minimised, "
                "or is the game on a loading screen?", brightness
            )
        return Frame(img, buf.getvalue(), t, src_size, brightness)
