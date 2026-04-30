# Background Desktop Saver + Desktop Buddy

This repository now includes two Windows desktop experiments:

- `desktop_saver_game.py`: a simple game attached to desktop background layering.
- `desktop_buddy.py`: a staged virtual desktop buddy prototype with transparent overlay rendering, state machine behavior, and local SQLite memory.

## Desktop Buddy stages implemented

1. **Stage 1: Transparent overlay foundation**
   - Borderless layered window.
   - Click-through passive mode vs interactive mode.
2. **Stage 2: Animation + finite state machine**
   - States: `IDLE`, `WALKING`, `INTERACTING`, `WORKING`, `SLEEPING`.
   - Animated sprite-like circle and simple motion loop.
3. **Stage 3: Local memory and adaptation**
   - SQLite database `buddy_memory.sqlite3`.
   - Logs interaction events and adapts walking probability.
4. **Stage 4: Polish hooks**
   - CPU-throttled render loop.
   - Status text and state-aware rendering.

## Run

```bash
python desktop_buddy.py
```

Press `Esc` to quit.

## Notes

- Target platform: **Windows 10/11** (uses Win32 via `ctypes`).
- Current environment here may not display GUI unless running on a Windows desktop session.
