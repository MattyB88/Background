# Background Desktop Saver + Desktop Buddy

This repository includes Windows desktop experiments and camera AR tools:

- `desktop_saver_game.py`: a simple game attached to desktop background layering.
- `desktop_buddy.py`: a staged virtual desktop buddy prototype with transparent overlay rendering, state machine behavior, and local SQLite memory.
- `ps4_robot_eyes.py`: AR robot-vision overlay for PS4 camera (or any webcam).
- `vtuber/`: autonomous AI VTuber in a 3D room, built in stages. See `vtuber/ROADMAP.md`.

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

- Desktop scripts target **Windows 10/11** (uses Win32 via `ctypes`).
- `ps4_robot_eyes.py` works on Windows and Linux wherever OpenCV can open a camera.
- Current environment here may not display GUI unless running on a Windows/Linux desktop session.

---

## PS4 Camera Robot Eyes

AR robot-vision overlay for the PS4 camera (via its USB PC adapter) or any webcam.

### Features

- **Vision modes** — `PHOSPHOR` (green), `THERMAL` (inferno), `NIGHT` (CLAHE boosted), `RAW`
- **Edge detection** — Canny edges blended in with mode-matched colour tint
- **Scanlines** — CRT-style scanline overlay
- **Face targeting** — Corner-bracket HUD locks onto detected faces with distance estimate
- **Motion alerts** — On-screen flash when significant frame delta detected
- **Stereo depth map** — If the PS4 camera exposes a wide (>2.5:1) stereo frame, it splits left/right eyes and renders a real-time disparity depth map beside the view
- **Vignette** — Lens-edge darkening for that robot-eye feel

### Install

```bash
pip install opencv-python
```

### Run

```bash
python ps4_robot_eyes.py          # default camera (0)
python ps4_robot_eyes.py 1        # try index 1 if PS4 cam isn't default
```

### Keys

| Key | Action |
|-----|--------|
| `m` | Cycle vision mode |
| `e` | Toggle edge overlay |
| `s` | Toggle scanlines |
| `t` | Toggle face targeting |
| `h` | Toggle HUD |
| `d` | Toggle depth map (stereo only) |
| `v` | Toggle vignette |
| `q` / `Esc` | Quit |
