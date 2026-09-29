# ICooked — Build Roadmap & Extended Plan

The design spec is in [`PCBA_GAME_DESIGN_PROMPT.md`](./PCBA_GAME_DESIGN_PROMPT.md).

**Strategy:** get a **playable end-to-end vertical slice early**: every station exists in a rough form and a run can end in fire. Then deepen one station at a time. Each milestone ends in a playable build, so the fun is tested continuously and not only at the end.


## Status (build in `icooked/`)

| Milestone | State | Notes |
|---|---|---|
| M0 Foundation | ✅ done | Vite + TS + Three.js, Electron shell (`npm run desktop`), seeded tick sim, first-person hands, station glide transitions, pocket inventory, a clock that never pauses, synth audio |
| M1 Vertical slice | ✅ done | Full loop from job to fire; procedural PCBs; score/cash; oven heat + fire ending; share card |
| M2 BOM Sudoku | 🟡 first pass | Generator + fault injector (blank/typo/wrong IPN, missing designators, old-rev folder), gamble cells, Baselines / ERP / Engineer / BOM editor / ODB++ viewer. A formal uniqueness solver is still to do |
| M3 PX-9 programming | 🟡 first pass | Layout, panel limits, fiducial find + shape/threshold, package teach (box, lighting, search). Needs more steps and polish |
| M4 Feeders | 🟡 first pass | Slot types, set-up sheet, scan-verify, lying reels, jams, shortages, alternates, dump bin. **Dump-bench sorting mini-game not built yet** |
| M5 Stencil | ✅ first pass | Stroke dynamics, SPI view, syringe dab, stencil dirt + wipe |
| M6 Inspection / reflow / AOI | ✅ first pass | Zoom/pan, shaky tweezer nudge, flick-off, per-defect risk model with 0.5% floor, AOI scopes |
| M7 Test / rework / notes | ✅ first pass | 3-light jig, iron fix with slips, part replacement, notepad |
| M8 Economy / endings | ✅ first pass | Cash, kits, penalties, customer rage, Sales, oven maintenance spiral, all three endings |
| M9 Art / audio / juice | ⬜ next | Placeholder synth audio and greybox-plus machines. Needs final models, recorded SFX, composed music, particles, tutorial |
| M10 Steam | ⬜ | Electron works; steamworks.js, packaging and store assets still to do |

---

## Part A — Launch Build (v1.0)

### M0 — Foundation
- Vite + TypeScript + Three.js project, with an Electron dev shell
- Seeded, deterministic **simulation core** (tick-based, separate from rendering)
- First-person **hands-only controller**, walking, interact prompts
- **Station transition system** (the camera glides from the floor into the station view and back)
- **Body inventory:** pockets and belt, setting tools down at stations and picking them back up
- Greybox factory floor with the station layout
- Global clock that never pauses (a pause menu that keeps running)
- Audio engine skeleton (layered music bus, SFX bus)

### M1 — Vertical Slice ("first fire")
- A single in-house job goes through every station in a simplified form
- **Procedural PCB renderer v1:** mask, pads, silkscreen, and chip/SOT/SOIC parts
- Basic score and cash, shipping boards
- **Oven heat meter + fire ending + "ICOOKED" end card**
- Shareable **score card image** export
- ✅ *Exit criterion: a run can be started, played, and burned down.*

### M2 — BOM Sudoku
- Job generator: assembly, bare PCB, BOM, placement data, ERP records, engineer-folder clutter
- **Fault injector** (missing designators or IPNs, mismatches, duplicates, wrong revs, naming chaos)
- **Solver** that proves each puzzle is deducible, except for the flagged gamble cells
- Three in-game apps: **Baselines** file browser, **ERP** search, **Engineer's folder**
- Difficulty curve and gamble bonus scoring

### M3 — PX-9 Programming
- Retro Linux-desktop UI shell (windows, menus, bevels)
- Layout → PCB/panel (with machine size limits) → fiducial find/teach → components
- **Package Teach mini-game** (trace outline and leads, lighting, search method) → hidden quality score
- Panel multiplier vs. cycle-time bottleneck

### M4 — Feeders & Materials
- Feeder types (tape widths, stick, tray), slot validation, parts kept loaded between jobs
- Part consumption, lying reel counts, jams, short tapes
- Alternate-request cooldown, unapproved alternates, **dump bin and sorting bench**
- Look-alike parts that can't be told apart

### M5 — Stencil & SPI
- Squeegee mouse-dynamics mini-game (smoothness, speed, pressure)
- Per-pad print results and SPI view, reprint, **syringe dab** (too much or too little)

### M6 — Inspection, Reflow model, AOI
- Zoom/magnifier panning, dense-board difficulty
- **Tweezer nudge physics** with stress-driven hand shake
- Full **defect probability model** (0.5% floor), with per-defect-type visuals after reflow
- AOI program scope, line-stop vs. rework decision

### M7 — Test, Rework, Notes
- Test jig with 3 lights, fault localisation
- Rework mini-game (iron / hot air / probe): repaired, acceptable, or scrap
- Always-available **notepad**

### M8 — Economy & End States
- Cash, part costs, late penalties, per-customer anger
- A Sales AI that over-promises; the growing schedule
- **Oven maintenance loop** (drain or bin early → maintenance mini-game), with a shrinking cooldown and growing maintenance time
- **Bankrupt → lights out** and **customer revolt** endings
- Stress system connected to everything

### M9 — Art, Audio, Juice
- Final PCB materials, component models, machine and tool models, lighting pass
- Adaptive music, full SFX, voice-lines and voicemail gags
- Screen shake, particles (smoke, sparks, flying 0402s), UI polish
- Tutorial / first-shift onboarding (it stays in real time: "the boss is already calling")

### M10 — Steam Release
- Electron packaging for Windows/Linux (Steam Deck check)
- steamworks.js: **leaderboards**, achievements, cloud save (settings and best scores)
- Performance pass, settings menu (graphics, audio, key bindings, accessibility)
- Store page assets, trailer capture, playtests, bug bash
- Legal check: a trademark search for "ICooked"; no real brand names or copyrighted assets

---

## Part B — Extended Plan (after launch)

Only if v1.0 lands. Everything below builds on the same simulation core.

### B1 — Progression & Meta
- Career mode with **unlock tiers**: better oven, more feeder slots, a second PnP, an SPI machine, a selective solder station
- Perks and traits ("Steady Hands", "ERP Whisperer", "Feeder Hoarder")
- Cosmetics: tool skins, desk clutter, factory posters

### B2 — More People, More Chaos
- Hire and fire staff (each with their own skills and bad habits)
- Co-op (2–4 players on one line, with shared blame)
- Visitors: customer audits, ISO auditors, the CEO tour, a "quick favour" from R&D

### B3 — More Process
- Through-hole, wave and selective solder, hand-solder station
- Conformal coating, box build, and packing/shipping mini-game
- BGA X-ray, ICT/flying probe, firmware programming
- Double-sided boards (flip and second pass)

### B4 — Replayability & Community
- **Daily and weekly seeded runs** with global leaderboards
- Challenge modifiers ("No ERP", "Sales on caffeine", "Only 0201s")
- Steam Workshop: custom boards, BOM Sudoku packs, factory layouts
- Replay export and clip-friendly highlight capture

### B5 — Platforms
- Console ports (Switch-style controls for the mini-games)
- Mobile spin-off: **BOM Sudoku** as a standalone puzzle app

### B6 — Engine re-evaluation
- v1 ships on Three.js + Electron. That's enough for a ~$3 Steam game, and it's the stack that can be built, screenshotted and tested automatically.
- If sales justify it, look at porting the renderer to Godot 4 for better lighting, performance and console reach. The `src/sim/` layer is plain TypeScript with no rendering, so the design and balance carry over as-is.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Scope is very large | Vertical slice first, each milestone playable, polish last |
| Puzzle generator produces unfair puzzles | A solver validates every puzzle, and the gamble cells are explicit |
| Real-time pressure is too punishing for new players | Tuned early game (the first shift is gentle), steep curve after that |
| Web-tech performance in 3D | Instanced components, LOD for boards, baked lighting on the floor |
| IP / trademark | Fictional machines and software, original assets, name search before the store page |
