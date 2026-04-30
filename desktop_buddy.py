"""Desktop Buddy prototype in staged complexity.

Stages:
1) Transparent/click-through overlay window foundation.
2) Sprite-like animated buddy with finite state machine.
3) Local memory + adaptive behavior via SQLite.
4) Polish hooks (tray-ready commands, throttled render loop).

Windows-only due to Win32 APIs.
"""
from __future__ import annotations

import ctypes
import random
import sqlite3
import time
from dataclasses import dataclass
from enum import Enum, auto
from pathlib import Path
from ctypes import wintypes

# Win32 handles
user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32

# Win messages/constants
WM_DESTROY = 0x0002
WM_PAINT = 0x000F
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_KEYDOWN = 0x0100
VK_ESCAPE = 0x1B
PM_REMOVE = 0x0001

WS_POPUP = 0x80000000
WS_VISIBLE = 0x10000000
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_TOPMOST = 0x00000008

GWL_EXSTYLE = -20
LWA_ALPHA = 0x2
SW_SHOW = 5
HWND_TOPMOST = -1
HWND_NOTOPMOST = -2
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_NOACTIVATE = 0x0010
SRCCOPY = 0x00CC0020

IDLE_THRESHOLD = 120


class BuddyState(Enum):
    IDLE = auto()
    WALKING = auto()
    INTERACTING = auto()
    WORKING = auto()
    SLEEPING = auto()


@dataclass
class BuddyMemory:
    db_path: Path

    def initialize(self) -> None:
        con = sqlite3.connect(self.db_path)
        cur = con.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS events(ts REAL, type TEXT, meta TEXT)")
        cur.execute("CREATE TABLE IF NOT EXISTS prefs(key TEXT PRIMARY KEY, value TEXT)")
        con.commit()
        con.close()

    def log_event(self, event_type: str, meta: str = "") -> None:
        con = sqlite3.connect(self.db_path)
        con.execute("INSERT INTO events(ts, type, meta) VALUES (?, ?, ?)", (time.time(), event_type, meta))
        con.commit()
        con.close()

    def recent_count(self, event_type: str, since_seconds: int) -> int:
        cutoff = time.time() - since_seconds
        con = sqlite3.connect(self.db_path)
        row = con.execute("SELECT COUNT(*) FROM events WHERE type=? AND ts>=?", (event_type, cutoff)).fetchone()
        con.close()
        return int(row[0])


class WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style", ctypes.c_uint),
        ("lpfnWndProc", ctypes.WINFUNCTYPE(ctypes.c_long, wintypes.HWND, ctypes.c_uint, wintypes.WPARAM, wintypes.LPARAM)),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HCURSOR),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class PAINTSTRUCT(ctypes.Structure):
    _fields_ = [
        ("hdc", wintypes.HDC),
        ("fErase", wintypes.BOOL),
        ("rcPaint", RECT),
        ("fRestore", wintypes.BOOL),
        ("fIncUpdate", wintypes.BOOL),
        ("rgbReserved", ctypes.c_byte * 32),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", ctypes.c_uint),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", ctypes.c_uint),
        ("pt", wintypes.POINT),
    ]


def rgb(r: int, g: int, b: int) -> int:
    return r | (g << 8) | (b << 16)


def get_x_lparam(lp: int) -> int:
    return int(ctypes.c_short(lp & 0xFFFF).value)


class DesktopBuddyApp:
    def __init__(self):
        self.state = BuddyState.IDLE
        self.last_state_switch = time.time()
        self.x = 240.0
        self.y = 260.0
        self.vx = 70.0
        self.frame = 0
        self.hwmd = None
        self.screen_w = user32.GetSystemMetrics(0)
        self.screen_h = user32.GetSystemMetrics(1)
        self.memory = BuddyMemory(Path("buddy_memory.sqlite3"))
        self.memory.initialize()
        self.interactive_until = 0.0

    def set_overlay_mode(self, interactive: bool) -> None:
        ex = user32.GetWindowLongW(self.hwnd, GWL_EXSTYLE)
        ex |= WS_EX_LAYERED | WS_EX_TOOLWINDOW
        if interactive:
            ex &= ~WS_EX_TRANSPARENT
            user32.SetWindowPos(self.hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
        else:
            ex |= WS_EX_TRANSPARENT
            user32.SetWindowPos(self.hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
        user32.SetWindowLongW(self.hwnd, GWL_EXSTYLE, ex)
        user32.SetLayeredWindowAttributes(self.hwnd, 0, 255, LWA_ALPHA)

    def handle_click(self):
        self.state = BuddyState.INTERACTING
        self.last_state_switch = time.time()
        self.interactive_until = time.time() + 8
        self.memory.log_event("click")
        self.set_overlay_mode(True)

    def update_state_machine(self):
        now = time.time()
        if now < self.interactive_until:
            self.state = BuddyState.INTERACTING
            return

        # Simulated adaptation: if many clicks recently, be interactive less often.
        recent_clicks = self.memory.recent_count("click", 3600)
        walk_probability = 0.02 if recent_clicks > 8 else 0.06

        if self.state == BuddyState.INTERACTING and now - self.last_state_switch > 6:
            self.state = BuddyState.IDLE
            self.set_overlay_mode(False)
        elif self.state == BuddyState.IDLE and random.random() < walk_probability:
            self.state = BuddyState.WALKING
            self.vx = random.choice([-90.0, 90.0])
            self.last_state_switch = now
        elif self.state == BuddyState.WALKING and now - self.last_state_switch > 4:
            self.state = BuddyState.WORKING
            self.last_state_switch = now
        elif self.state == BuddyState.WORKING and now - self.last_state_switch > 5:
            self.state = BuddyState.IDLE
            self.last_state_switch = now

    def update_motion(self, dt: float):
        if self.state == BuddyState.WALKING:
            self.x += self.vx * dt
            if self.x < 40 or self.x > self.screen_w - 40:
                self.vx = -self.vx
                self.x = max(40, min(self.screen_w - 40, self.x))
        self.frame = (self.frame + 1) % 30

    def draw(self):
        ps = PAINTSTRUCT()
        hdc = user32.BeginPaint(self.hwnd, ctypes.byref(ps))
        memdc = gdi32.CreateCompatibleDC(hdc)
        bmp = gdi32.CreateCompatibleBitmap(hdc, self.screen_w, self.screen_h)
        oldbmp = gdi32.SelectObject(memdc, bmp)

        # clear full canvas to black (alpha composited by layered window)
        brush_bg = gdi32.CreateSolidBrush(rgb(0, 0, 0))
        full = RECT(0, 0, self.screen_w, self.screen_h)
        user32.FillRect(memdc, ctypes.byref(full), brush_bg)
        gdi32.DeleteObject(brush_bg)

        color = {
            BuddyState.IDLE: rgb(140, 220, 255),
            BuddyState.WALKING: rgb(120, 255, 160),
            BuddyState.INTERACTING: rgb(255, 220, 130),
            BuddyState.WORKING: rgb(220, 180, 255),
            BuddyState.SLEEPING: rgb(130, 130, 170),
        }[self.state]

        radius = 28 + (self.frame % 6)
        body_brush = gdi32.CreateSolidBrush(color)
        old_brush = gdi32.SelectObject(memdc, body_brush)
        gdi32.Ellipse(memdc, int(self.x - radius), int(self.y - radius), int(self.x + radius), int(self.y + radius))
        gdi32.SelectObject(memdc, old_brush)
        gdi32.DeleteObject(body_brush)

        status = f"State: {self.state.name} | Esc quits"
        gdi32.SetBkMode(memdc, 1)
        gdi32.SetTextColor(memdc, rgb(240, 240, 255))
        gdi32.TextOutW(memdc, 20, 20, status, len(status))

        gdi32.BitBlt(hdc, 0, 0, self.screen_w, self.screen_h, memdc, 0, 0, SRCCOPY)
        gdi32.SelectObject(memdc, oldbmp)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(memdc)
        user32.EndPaint(self.hwnd, ctypes.byref(ps))

    def run(self):
        self._create_window()
        msg = MSG()
        last = time.perf_counter()
        while True:
            while user32.PeekMessageW(ctypes.byref(msg), 0, 0, 0, PM_REMOVE):
                if msg.message == 0x0012:
                    return
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))

            now = time.perf_counter()
            dt = min(0.033, now - last)
            last = now
            self.update_state_machine()
            self.update_motion(dt)
            user32.InvalidateRect(self.hwnd, None, False)
            user32.UpdateWindow(self.hwnd)
            time.sleep(0.016)

    def _create_window(self):
        app_ref = self

        @ctypes.WINFUNCTYPE(ctypes.c_long, wintypes.HWND, ctypes.c_uint, wintypes.WPARAM, wintypes.LPARAM)
        def wndproc(hwnd, msg, wparam, lparam):
            if msg == WM_LBUTTONDOWN:
                app_ref.handle_click()
                return 0
            if msg == WM_MOUSEMOVE:
                app_ref.x = max(30, min(app_ref.screen_w - 30, get_x_lparam(lparam)))
                return 0
            if msg == WM_KEYDOWN and wparam == VK_ESCAPE:
                user32.PostQuitMessage(0)
                return 0
            if msg == WM_PAINT:
                app_ref.draw()
                return 0
            if msg == WM_DESTROY:
                user32.PostQuitMessage(0)
                return 0
            return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

        self._wndproc = wndproc
        hinstance = kernel32.GetModuleHandleW(None)
        class_name = "DesktopBuddyWnd"

        wc = WNDCLASSW()
        wc.lpfnWndProc = self._wndproc
        wc.hInstance = hinstance
        wc.lpszClassName = class_name

        atom = user32.RegisterClassW(ctypes.byref(wc))
        if not atom:
            raise ctypes.WinError()

        self.hwnd = user32.CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW,
            class_name,
            "Desktop Buddy",
            WS_POPUP | WS_VISIBLE,
            0,
            0,
            self.screen_w,
            self.screen_h,
            None,
            None,
            hinstance,
            None,
        )
        if not self.hwnd:
            raise ctypes.WinError()
        user32.ShowWindow(self.hwnd, SW_SHOW)
        self.set_overlay_mode(False)


if __name__ == "__main__":
    DesktopBuddyApp().run()
