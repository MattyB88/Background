# AI plays GTA VI live: Remote Play harness (no capture card)

```
 PS5 ──Remote Play──► PC window (chiaki-ng or PS Remote Play)
                          │ screen grab (mss, no capture card)
                          ▼
                  Claude (vision)  ──► JSON plan: timed button/stick/trigger steps + "sustain" state
                          │
                          ▼
            Executor @120 Hz ──► virtual gamepad (ViGEmBus via vgamepad) ──► Remote Play ──► PS5
                          │
                          ▼
            OBS overlay (commentary)  ·  /control page (pause + director notes)  ·  F8/F9/F10 hotkeys
```

Claude looks at a screenshot and returns a short timed sequence of inputs. The executor plays those inputs in real time. While Claude thinks about the next frame (about 2-5 s), the executor holds a "sustain" state, for example a light throttle on a straight road or neutral when unsure. If Claude stalls, the pad goes neutral after 8 s.

## Pick a route (test BOTH tonight if you can)

| | **A. chiaki-ng (recommended)** | **B. Official PS Remote Play** |
|---|---|---|
| Client | [chiaki-ng](https://github.com/streetpea/chiaki-ng/releases), free and open source | Sony "PS Remote Play" for Windows |
| Virtual pad | `x360`: any SDL pad works, so this is reliable | `ds4`: the official app only accepts PlayStation pads. A ViGEm virtual DS4 is detected on many setups but **not guaranteed** |
| Config | `source = "window:chiaki"`, `type = "x360"` | `source = "window:PS Remote Play"`, `type = "ds4"` |

If route B's app doesn't react during the pad preflight, switch to route A. Don't spend stream night debugging it.

## Setup (Windows 10/11, Python 3.11+)

1. **PS5**
   - Settings → System → Remote Play → *Enable Remote Play*.
   - Settings → System → Power Saving → Features Available in Rest Mode → *Stay Connected to the Internet* + *Enable Turning On PS5 from Network*.
   - Use **wired Ethernet** on the PS5 and the PC if at all possible.
2. **Remote Play client**
   - chiaki-ng: install it, use its PSN login to get your account ID, then *Register* the PS5. The PIN is under PS5 Settings → System → Remote Play → Link Device. Pick 1080p if your network can take it.
   - Run the client **windowed or borderless**, on screen, never minimised. The capture grabs the visible pixels.
3. **Harness**: double-click `setup_gta_ai.bat`.
   - It creates `.venv`, installs the requirements and copies `config.example.toml` → `config.toml`.
   - `pip install vgamepad` launches the **ViGEmBus driver** installer. Accept it and **reboot**.
4. **API key**: `setx ANTHROPIC_API_KEY sk-ant-...`, then open a new terminal.
5. Edit `config.toml`: capture source, pad type, mission.

## Tonight's checklist (do it with the game running)

```bat
run_gta_ai.bat preflight
```
- **Capture**: open `preflight_capture.jpg`. It should show only the game picture. If it's black, the window is minimised or covered. If it's the wrong window, change `capture.source`.
- **Pad**: the PS5 home screen selection should move right, then left, and the left stick should go up then down. If up and down are swapped, set `invert_y` in config. If nothing moves, see Troubleshooting.

```bat
.venv\Scripts\python -m gta_ai.preflight -c config.toml --api
```
- This makes one real Claude call and prints what Claude sees, its commentary and its plan, plus latency and cost.

```bat
run_gta_ai.bat mock
```
- This runs the whole pipeline with a random-walk "brain" and costs nothing. Your character should wander.

Then **fix the controls cheat sheet**. Open GTA VI → Settings → Controls and correct `gta_ai/prompts/controls.md`, or point `brain.controls_file` at your own copy. The bundled sheet is GTA-series defaults.

## Going live

```bat
run_gta_ai.bat
```
It starts **paused**. Get into story mode, focus the Remote Play window, then:

| Key | Action |
|---|---|
| **F8** | pause / resume the AI. Pausing releases every input. |
| **F9** | panic: always pauses |
| **F10** | quit |

- **OBS**: add a *Browser Source* → `http://127.0.0.1:8765/` (1920×1080, transparent) for the commentary box. Or use a *Text (read from file)* source on `overlay/commentary.txt`.
- **Control panel**: `http://127.0.0.1:8765/control` has a big pause button and **director notes** (e.g. "steal the red sports car", "go to the beach"). Claude acts on a note on its next turn.
- Every frame and decision is saved under `runs/<timestamp>/`. You can use these for highlight clips and debugging.

## Tuning: speed vs smarts vs cost

- `brain.effort = "low"` (default) is fastest. `"medium"` plans better but thinks longer.
- `brain.fast_mode = true` uses Opus 5.5 fast mode. Replies come noticeably quicker at 2× token price. This is the best lever for driving.
- Use `--model claude-haiku-5-5` for much faster and cheaper turns, but play is noticeably dumber. `price_in_per_mtok` / `price_out_per_mtok` are only used for the cost display and cap, so set them to $0.10 / $0.50 for Haiku.
- `capture.max_width = 1024` makes images smaller, so turns are a little faster and cheaper.
- Expect roughly **1-3¢ per turn** on Opus 5.5 at low effort, which is about $10-40 per hour depending on pace. `loop.max_cost_usd` (default $25) auto-pauses the AI when it is reached.
- Honest expectation: walking, exploring, stealing cars and slow driving look fine. High-speed driving and gunfights will be chaotic, because the AI reacts every few seconds rather than every frame. Lean into it in the commentary.

## Troubleshooting

- **Pad not detected (route B)**: the official app may ignore virtual DS4s. Use chiaki-ng with `type = "x360"`.
- **Pad not detected (chiaki-ng)**: start the harness *before* opening the stream so the pad exists. Check chiaki-ng's controller settings. Unplug other pads if chiaki-ng grabs the wrong one.
- **`vgamepad could not start`**: ViGEmBus isn't installed. Get it from github.com/nefarius/ViGEmBus/releases and reboot.
- **Hotkeys don't fire**: some setups need the terminal run as Administrator. The `/control` page always works.
- **Black frames**: the window is minimised or covered, or the PS5 is showing a "Remote Play paused / restricted content" screen.
- **Errors in a row**: after 5 failed turns the AI pauses itself. Check the terminal (bad API key, rate limit, network).
- **Human takeover**: press F8. The virtual pad goes neutral and stays that way. Test tonight whether your real controller can take over smoothly on your setup.

## Rules

Use **story mode only**. Automated input in GTA Online can get your account banned, and the system prompt already tells the AI to stay out of Online, the Store and system menus. The `share` button is blocked by default. Add `"options"` to `blocked_buttons` if the AI keeps pausing.

## Layout

```
gta_ai/
  app.py        main loop (python -m gta_ai)
  brain.py      Claude call (structured JSON output, prompt caching, refusal fallback) + MockBrain
  actions.py    plan schema, validation and clamping
  executor.py   120 Hz real-time input player with sustain + dead-man timeout
  gamepad.py    x360 / ds4 (vgamepad) and dry-run backends
  capture.py    window/monitor/region/file capture (mss)
  overlay.py    OBS overlay + control panel HTTP server
  hotkeys.py    F8/F9/F10
  preflight.py  pre-stream checks
  prompts/      system prompt + editable controls cheat sheet
tests/test_gta_ai.py
```
Run the tests with `python -m pytest tests`.
