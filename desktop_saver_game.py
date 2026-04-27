"""
Desktop Background Game (Windows)

A lightweight screen-saver style game that renders *behind desktop icons*
by parenting a custom window to the desktop WorkerW window.

Controls
- Move mouse: steer paddle
- Left click: nudge ball
- Esc: quit

Requirements
- Windows 10/11
- Python 3.9+
"""

from __future__ import annotations

import ctypes
import random
import time
from ctypes import wintypes

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32


# ---- Win32 constants ----
WM_DESTROY = 0x0002
WM_PAINT = 0x000F
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_KEYDOWN = 0x0100
VK_ESCAPE = 0x1B

WS_CHILD = 0x40000000
WS_VISIBLE = 0x10000000
CS_HREDRAW = 0x0002
CS_VREDRAW = 0x0001
IDC_ARROW = 32512
COLOR_WINDOW = 5
PM_REMOVE = 0x0001

SRCCOPY = 0x00CC0020
SW_SHOW = 5


# ---- Win32 structs ----
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


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", ctypes.c_uint),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", ctypes.c_uint),
        ("pt", POINT),
        ("lPrivate", ctypes.c_uint),
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


# ---- Game state ----
class GameState:
    def __init__(self, width: int, height: int):
        self.width = width
        self.height = height
        self.ball_x = width * 0.4
        self.ball_y = height * 0.3
        self.ball_vx = 260.0
        self.ball_vy = 190.0
        self.ball_r = 16

        self.paddle_w = 140
        self.paddle_h = 16
        self.paddle_x = width // 2
        self.paddle_y = height - 120

        self.score = 0
        self.star = self._spawn_star()

    def _spawn_star(self):
        margin = 70
        return {
            "x": random.randint(margin, max(margin + 1, self.width - margin)),
            "y": random.randint(margin, max(margin + 1, self.height - 220)),
            "r": 14,
        }

    def update(self, dt: float):
        self.ball_x += self.ball_vx * dt
        self.ball_y += self.ball_vy * dt

        # Wall bounce
        if self.ball_x - self.ball_r <= 0:
            self.ball_x = self.ball_r
            self.ball_vx = abs(self.ball_vx)
        elif self.ball_x + self.ball_r >= self.width:
            self.ball_x = self.width - self.ball_r
            self.ball_vx = -abs(self.ball_vx)

        if self.ball_y - self.ball_r <= 0:
            self.ball_y = self.ball_r
            self.ball_vy = abs(self.ball_vy)
        elif self.ball_y + self.ball_r >= self.height:
            self.ball_y = self.height - self.ball_r
            self.ball_vy = -abs(self.ball_vy)

        # Paddle bounce
        px0 = self.paddle_x - self.paddle_w // 2
        py0 = self.paddle_y - self.paddle_h // 2
        px1 = px0 + self.paddle_w
        py1 = py0 + self.paddle_h

        if px0 <= self.ball_x <= px1 and py0 <= self.ball_y + self.ball_r <= py1 and self.ball_vy > 0:
            rel = (self.ball_x - self.paddle_x) / (self.paddle_w / 2)
            self.ball_vx = 330.0 * rel
            self.ball_vy = -abs(self.ball_vy) - 30

        # Star collect
        dx = self.ball_x - self.star["x"]
        dy = self.ball_y - self.star["y"]
        rr = self.ball_r + self.star["r"]
        if dx * dx + dy * dy <= rr * rr:
            self.score += 1
            self.star = self._spawn_star()
            self.ball_vx *= 1.04
            self.ball_vy *= 1.04


game: GameState | None = None
hwnd_global = None


def rgb(r: int, g: int, b: int):
    return r | (g << 8) | (b << 16)


def _get_x_lparam(lp):
    x = ctypes.c_short(lp & 0xFFFF).value
    return int(x)


@ctypes.WINFUNCTYPE(ctypes.c_long, wintypes.HWND, ctypes.c_uint, wintypes.WPARAM, wintypes.LPARAM)
def wndproc(hwnd, msg, wparam, lparam):
    global game

    if msg == WM_MOUSEMOVE and game:
        game.paddle_x = max(game.paddle_w // 2, min(game.width - game.paddle_w // 2, _get_x_lparam(lparam)))
        return 0

    if msg == WM_LBUTTONDOWN and game:
        game.ball_vy -= 80
        return 0

    if msg == WM_KEYDOWN and wparam == VK_ESCAPE:
        user32.PostQuitMessage(0)
        return 0

    if msg == WM_PAINT:
        ps = PAINTSTRUCT()
        hdc = user32.BeginPaint(hwnd, ctypes.byref(ps))

        memdc = gdi32.CreateCompatibleDC(hdc)
        bmp = gdi32.CreateCompatibleBitmap(hdc, game.width, game.height)
        oldbmp = gdi32.SelectObject(memdc, bmp)

        # background
        brush_bg = gdi32.CreateSolidBrush(rgb(8, 18, 38))
        full = RECT(0, 0, game.width, game.height)
        user32.FillRect(memdc, ctypes.byref(full), brush_bg)
        gdi32.DeleteObject(brush_bg)

        # star
        brush_star = gdi32.CreateSolidBrush(rgb(255, 217, 74))
        old_brush = gdi32.SelectObject(memdc, brush_star)
        gdi32.Ellipse(
            memdc,
            int(game.star["x"] - game.star["r"]),
            int(game.star["y"] - game.star["r"]),
            int(game.star["x"] + game.star["r"]),
            int(game.star["y"] + game.star["r"]),
        )
        gdi32.SelectObject(memdc, old_brush)
        gdi32.DeleteObject(brush_star)

        # paddle
        brush_paddle = gdi32.CreateSolidBrush(rgb(128, 244, 255))
        paddle = RECT(
            game.paddle_x - game.paddle_w // 2,
            game.paddle_y - game.paddle_h // 2,
            game.paddle_x + game.paddle_w // 2,
            game.paddle_y + game.paddle_h // 2,
        )
        user32.FillRect(memdc, ctypes.byref(paddle), brush_paddle)
        gdi32.DeleteObject(brush_paddle)

        # ball
        brush_ball = gdi32.CreateSolidBrush(rgb(255, 120, 120))
        old_brush = gdi32.SelectObject(memdc, brush_ball)
        gdi32.Ellipse(
            memdc,
            int(game.ball_x - game.ball_r),
            int(game.ball_y - game.ball_r),
            int(game.ball_x + game.ball_r),
            int(game.ball_y + game.ball_r),
        )
        gdi32.SelectObject(memdc, old_brush)
        gdi32.DeleteObject(brush_ball)

        # score text
        gdi32.SetBkMode(memdc, 1)  # transparent
        gdi32.SetTextColor(memdc, rgb(230, 240, 255))
        text = f"Desktop Saver Score: {game.score}   (Esc to quit)"
        gdi32.TextOutW(memdc, 16, 16, text, len(text))

        gdi32.BitBlt(hdc, 0, 0, game.width, game.height, memdc, 0, 0, SRCCOPY)

        gdi32.SelectObject(memdc, oldbmp)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(memdc)

        user32.EndPaint(hwnd, ctypes.byref(ps))
        return 0

    if msg == WM_DESTROY:
        user32.PostQuitMessage(0)
        return 0

    return user32.DefWindowProcW(hwnd, msg, wparam, lparam)


def _find_workerw() -> int:
    progman = user32.FindWindowW("Progman", None)
    if not progman:
        raise RuntimeError("Could not find Progman window")

    # Ask Progman to create a WorkerW behind icons
    result = wintypes.DWORD()
    user32.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, ctypes.byref(result))

    workerw = wintypes.HWND()

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def enum_windows(hwnd, _lparam):
        nonlocal workerw
        shell = user32.FindWindowExW(hwnd, 0, "SHELLDLL_DefView", None)
        if shell:
            workerw = user32.FindWindowExW(0, hwnd, "WorkerW", None)
        return True

    user32.EnumWindows(enum_windows, 0)

    if not workerw:
        workerw = progman

    return int(workerw)


def main():
    global game, hwnd_global

    hinstance = kernel32.GetModuleHandleW(None)
    class_name = "DesktopSaverGameWnd"

    wndclass = WNDCLASSW()
    wndclass.style = CS_HREDRAW | CS_VREDRAW
    wndclass.lpfnWndProc = wndproc
    wndclass.hInstance = hinstance
    wndclass.hCursor = user32.LoadCursorW(None, IDC_ARROW)
    wndclass.hbrBackground = COLOR_WINDOW + 1
    wndclass.lpszClassName = class_name

    atom = user32.RegisterClassW(ctypes.byref(wndclass))
    if not atom:
        raise ctypes.WinError()

    screen_w = user32.GetSystemMetrics(0)
    screen_h = user32.GetSystemMetrics(1)
    game = GameState(screen_w, screen_h)

    parent = _find_workerw()

    hwnd = user32.CreateWindowExW(
        0,
        class_name,
        "Desktop Saver Game",
        WS_CHILD | WS_VISIBLE,
        0,
        0,
        screen_w,
        screen_h,
        parent,
        None,
        hinstance,
        None,
    )

    if not hwnd:
        raise ctypes.WinError()

    hwnd_global = hwnd
    user32.ShowWindow(hwnd, SW_SHOW)
    user32.UpdateWindow(hwnd)

    msg = MSG()
    last = time.perf_counter()

    while True:
        while user32.PeekMessageW(ctypes.byref(msg), 0, 0, 0, PM_REMOVE):
            if msg.message == 0x0012:  # WM_QUIT
                return
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

        now = time.perf_counter()
        dt = min(0.033, now - last)
        last = now

        game.update(dt)
        user32.InvalidateRect(hwnd, None, False)
        user32.UpdateWindow(hwnd)

        time.sleep(0.008)


if __name__ == "__main__":
    main()
