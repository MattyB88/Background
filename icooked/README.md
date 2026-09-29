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
| N | notepad, available any time |
| 1–4 | hold a tool from your pocket |
| Wheel, right-drag / WASD | zoom and pan at the Inspection and Rework benches |

The pause menu does not pause. Nothing stops the factory.

## How a shift goes

1. **PX-9 Pick & Place:** load a programmed job. This buys the parts kit.
2. **Feeder Cart:** load reels into the slots on the set-up sheet. Reels lie about their counts, tapes jam, and stores gets shorted. When you run out, request an approved alternate (slow), grab a look-alike (risky), or hand-feed from the dump bin (riskier).
3. **Stencil Printer:** drag the squeegee in one smooth, steady stroke. Too slow puts down too much paste, too fast not enough, and a jerky stroke skips pads. You can dab missed pads with the syringe.
4. **Inspection Bench** (optional): hold the panel, zoom in, and nudge crooked parts with tweezers. Your hands shake more as stress rises.
5. **Reflow Oven:** all the risk becomes real defects here. Heat builds with throughput. Stop the feed, let it drain (or bin what's inside), and scrape it clean. Every service makes it heat faster and makes the next service longer.
6. **AOI:** inspect critical parts only (fast) or the full board (slow). AOI can't tell look-alike values apart.
7. **Test Jig:** 3 lights ships the board. Anything less goes to the rework rack.
8. **Rework Bench:** fix tombstones, bridges and dry joints with the iron, and replace wrong or missing parts. You recover part of the board's points.
9. **Programming Desk:** accept or decline contracts. Find the real release in Baselines (the engineer called it "USB c charger – version that works"). Solve the **BOM Sudoku** using the ERP, the ODB++ data and the engineer's notes. Then program the PX-9: panel size, fiducials, and teaching new packages.

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
