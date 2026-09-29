# ICooked

*"IC" + "cooked". Say it out loud: "I cooked".*

A first-person SMT factory game. You are the only operator on a PCBA line at a chaotic contract manufacturer. Sales keeps promising the impossible. Engineering keeps releasing broken data. The reflow oven is one bad shift away from catching fire. **You can't win. You always get fired.** The only question is your score.

Design spec: [`../docs/PCBA_GAME_DESIGN_PROMPT.md`](../docs/PCBA_GAME_DESIGN_PROMPT.md) · Roadmap: [`../docs/ICOOKED_ROADMAP.md`](../docs/ICOOKED_ROADMAP.md)

## Run it

```bash
cd icooked
npm install
npm run dev          # browser, http://localhost:5173
npm run desktop      # Electron window (the Steam build shell)
npm test             # simulation tests (includes a bot that plays until it's fired)
npm run build        # typecheck + production build into dist/
```

## Controls

| Key | Action |
|---|---|
| WASD / arrows | walk (Shift to run) |
| Mouse | look (click the game to capture the mouse) |
| E | use the station you're facing |
| Q / Esc | leave a station |
| C | clipboard: work cards, parts checklist, card notes |
| N | notepad, available any time |
| 1–4 | hold a tool from your pocket |
| Wheel, middle-drag / WASD | zoom and pan at the Inspection and Rework benches |
| Hold left / right-click or Space | tweezers: lower the tip and push / grip and let go |

The pause menu does not pause. Nothing stops the factory.

## How a shift goes

1. **Programming Desk:** accept contracts and solve the BOM Sudoku. Program the PX-9 offline (panel, fiducials, package teach). Print the **work card** for a job from the schedule.
2. **Office Printer:** grab the work card and clip it on your **clipboard** (C). It shows the quantity, due date, sales and engineering notes, and the parts checklist, and you can write on it.
3. **PX-9:** load the job (you need its card on your clipboard). Use **Program check** to step through parts in the machine camera. The overlay shows the programmed package on the real lands: fix rotations and XY offsets from dodgy CAD, and spot wrong parts (wrong size, wrong pin count).
4. **Stores Rack:** reels are stored on edge like CDs in labelled sections. Pull one out to read its label (RES001, CAP014…) and take the right ones onto your trolley.
5. **Feeder Cart:** load reels from your trolley into the slots on the set-up sheet.
6. **Stencil Printer:** one smooth squeegee stroke. The SPI view shows paste as grey shades only.
7. **Inspection:** hold left to lower the tweezer tip and push parts by their edges. Grip (right-click / Space) to lift and move one. Too fast and it jumps; too fast or too long while held and it pings onto the floor. Search the floor with a torch, or get a new one from the machine: STOP, pull the feeder, dab one out with blue tack, seat it, START. Pull a feeder while running and the interlock faults: press the E-stop twice, twist to release, then START.
8. **Reflow Oven, AOI, Test Jig, Rework:** as before. The oven service gets worse every time.

Tools stay wherever you put them down. If you leave the tweezers at Inspection, they're still at Inspection.

**How you get fired:** the oven catches fire, the lights go out when there's no cash left for parts or power, or the customers revolt over late jobs.

## Code map

| Path | What |
|---|---|
| `src/sim/` | Deterministic, seeded simulation (no rendering). `game.ts` is the line, `catalog.ts` generates products and BOM puzzles, `defects.ts` is the risk model, `parts.ts` is the fictional ERP library |
| `src/render/` | Factory hall and machines, procedural PCB painter (`boardpaint.ts`), instanced 3D boards (`board3d.ts`), the close-up bench scene, first-person hands |
| `src/stations/` | One file per station and mini-game |
| `src/ui/` | HUD, title / pause / end screens, share card |
| `src/audio/` | Synthesised SFX and adaptive music (placeholder until final audio) |
| `electron/` | Desktop shell (loads `dist/` over `app://`) |
| `scripts/` | Headless Playwright tours used for visual QA (`shots.mjs`, `scenario.mjs`, `interact.mjs`, `desk.mjs`) |

All company, machine, software and part names are fictional.

## PC (Windows)

The `ICooked Windows build` workflow builds a portable `ICooked-portable.exe` and publishes it to the `icooked-android-latest`-style pre-release `icooked-windows-latest`. Or run `npm run dist:win` on a Windows machine.

## Mobile

- **Touch controls** are detected automatically. Hold the phone sideways: left thumb walks (a floating joystick), right thumb looks, tap **USE** at a station. At the benches, one finger uses the tool and two fingers pinch-zoom and pan.
- **Android APK:** the `ICooked Android APK` GitHub Actions workflow (`.github/workflows/android-apk.yml`) builds a debug APK on every push to `icooked/`. It uploads it as a workflow artifact and to the `icooked-android-latest` pre-release. The Android project lives in `icooked/android` (Capacitor). To build locally with the Android SDK: `npm run build && npx cap sync android && cd android && ./gradlew assembleDebug`.
- **iPhone:** play the web build in Safari. An iOS app needs a Mac with Xcode (`npx cap add ios`).
