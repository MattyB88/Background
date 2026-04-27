# Background Desktop Saver Game

A tiny **Windows desktop background game** that runs behind your desktop icons (WorkerW layer) like a live screen saver.

## What it does
- Creates a window parented to the desktop background layer.
- Renders a simple paddle-and-ball mini-game.
- Lets you interact with mouse movement and clicks.

## Controls
- **Move mouse**: move paddle
- **Left click**: nudge ball upward
- **Esc**: quit

## Run
```bash
python desktop_saver_game.py
```

## Notes
- Target platform: **Windows 10/11**.
- This uses Win32 APIs via Python `ctypes`.
- On some desktop configurations, click behavior can vary due to how Explorer layers windows/icons.
