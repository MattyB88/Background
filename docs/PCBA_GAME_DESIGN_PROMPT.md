# Game Design Prompt — "Line Down" (working title)

> A chaotic, unwinnable PCBA (printed circuit board assembly) factory survival game.
> Status: **Draft v0.1 — awaiting answers to the Open Questions (section 12)**.

---

## 1. Role & Goal (for the AI/dev building it)

You are building a **3D indie arcade-sim game** about running an SMT (surface-mount) production line at a chaotic contract-manufacturing company. It should be:

- **Viral / streamable** — short, frantic sessions, funny failures, a shareable score and "how did your factory burn down" end card.
- **Authentic** — real PCBA process steps (programming, stencil printing, pick-and-place, reflow, inspection, AOI, test, rework) simplified into mini-games, with details that people who work in electronics manufacturing will recognise and laugh at.
- **Unwinnable** — every run ends in a backlog pile-up that escalates until the reflow oven starts burning boards and the factory catches fire. The only goal is a **high score** before collapse.

**Target audience:** high-school age and up (casual players), with depth for electronics hobbyists/industry people. *(See Q1.)*

---

## 2. Core Loop

```
Schedule grows → Pick a job → Program machine → Load feeders
      → Stencil print → Pick & place → (optional) Manual inspect
      → Reflow → (optional) AOI → Test jig → Ship or Rework
      → Score → Schedule has grown more → repeat until FIRE
```

- The **job schedule keeps growing** over time (rate increases each "shift").
- The player chooses what to work on:
  - **In-house jobs** — known, repeat builds. Lower points, fewer surprises.
  - **New contracts** — bonus points, but come with bad engineering data, new parts to teach, new programs to write.
  - Player may **decline new contracts** to clear in-house work — but a high score needs a balance of contracts, in-house, and catching/fixing mistakes.
- **Stress / pressure meter** rises with backlog. It drives difficulty (shaky hands, more jams, faster timers).
- **Game over:** backlog overflows → reflow oven gets over-loaded → boards start scorching → smoke → fire → end screen.

---

## 3. Stage 1 — Job Intake & Data Puzzle ("Baselines")

The programmer must find the correct files for a job before building.

### 3.1 File sources
| Source | Contents | Reliability |
|---|---|---|
| **`Baselines/` folder** | Engineer-released BOM + ODB++ (or Gerber/XY) per assembly | Official but **always incomplete or inconsistent** |
| **Engineer's personal folder** | WIP notes, old revs, screenshots, emails | Messy, sometimes has the missing clue |
| **ERP system** (in-game UI) | Internal part numbers (IPN), descriptions, stock, approved alternates, rev history | Accurate but hard to search |

### 3.2 Naming convention (the puzzle)
- Assembly IPN: `AA001_Rev1.0`
- Bare PCB IPN: `CPC001_Rev1.0`
- Engineer instead saves it as: **`USB c charger - version that works.zip`**
- Player must match the messy name to the correct IPN/rev via the ERP.

### 3.3 Injected data faults (randomised per job)
- Missing designator (e.g. value `10k` present, no `R12`)
- Missing part number but value present
- Designator in BOM but not in placement file (or vice versa)
- Inconsistent descriptions (`10K 0805 1%` vs `RES 10k0 2012M`)
- Wrong/old revision in Baselines
- Duplicate designators

### 3.4 Resolution
- Player cross-references ERP + engineer folder like a **logic puzzle**.
- Some gaps can't be fully resolved → player may **gamble** on a best guess:
  - Correct guess → **high bonus**.
  - Wrong guess → board fails later (test / rework).
- **Every board must have every component, correct part, correct place** to score full points.

---

## 4. Stage 2 — Machine Programming (MY9-style pick & place GUI)

A simulated pick-and-place programming interface, inspired by Mycronic MY9-style workflows (original UI, no real branding).

### 4.1 Steps (mirrors real life)
1. **Create Layout** (machine/board layout)
2. **Create PCB** — single board **or panel** (N×M array)
3. **Fiducials** — find existing or **teach** new ones
   - Some fid types are easier to detect than others (round copper vs. odd shapes, poor contrast)
4. **Add components** — designator, name, component link
5. **New component? → Package teach mini-game** (4.3)

### 4.2 Panelisation trade-off
- Panels = more boards per cycle → **score multiplier**
- **Machine limits** on panel size: small boards → many up; large boards → single or few
- Bigger panels = longer place time per cycle → can create a **line bottleneck** / balancing problem

### 4.3 Package teach mini-game
- Click-and-drag to **trace body outline and leads/balls**
- Choose **lighting** (front/side/back), **search method** (leads, body, corners, balls)
- Teach quality (hidden score) drives:
  - **Placement accuracy** (offset / rotation error)
  - **Camera reject rate** (wasted parts, slower build)
- Poor teach can still be **accepted as a risk** → per-part chance of mis-placement.
- Placement error feeds reflow defect chance (tombstone, misalign, bridge, etc.).
- Player never sees the raw quality number — they must **visually inspect** the placed board.

---

## 5. Stage 3 — Feeder Loading & Changeover

### 5.1 Loading mini-game
- Load parts into the **correct feeder type and slot**: tape feeder (8/12/16 mm…), **stick** feeder, **tray**.
- Wrong type/slot = mis-pick or wrong part placed.
- **Common parts can stay loaded** between jobs → faster changeover. Player balances the setup.
- **Longer a feeder stays loaded, the better its pick is tuned** (small accuracy bonus).

### 5.2 Consumption & shortage events (chance-based)
- Parts deplete; reels run out → **changeover** required.
- **Reel count lies**: used reels sometimes have fewer parts than labelled.
- **Tape jams, short tapes, split tape** on new loads.
- On shortage, the player chooses:

| Option | Time | Risk |
|---|---|---|
| Request **approved alternate** (ERP) | Cooldown timer | None — correct part at end |
| Use **risky alternate** (not approved) | Instant | Chance it's wrong |
| Pick from **dump bin** | Instant-ish | Look-alike parts; some **indistinguishable** |

### 5.3 The Dump Bench
- Player can tip dump bin onto a **sorting bench** and come back later.
- Sort piles of similar-looking parts (0402/0603/0805 caps & resistors, SOT-23s).
- Some parts are visually **identical** (e.g. unmarked ceramic caps) → wrong value used → **AOI can't catch it**, only **test** will.

---

## 6. Stage 4 — Stencil Printing

- **Mini-game:** drag the squeegee with the mouse. Score = **smoothness + consistent speed + pressure**.
- Results per pad: good / insufficient / excess / missed / smeared.
- **Solder Paste Inspection** view: player can see bad prints and choose to:
  - Wipe & reprint (time)
  - **Hand-dab paste** on a pad (too much → bridge; too little → dry joint)
  - Ignore (risk)
- Defect mapping example:
  - Missed pad on 0805 resistor / ceramic cap → **tombstone** chance ↑
  - Missed pad on IC / tantalum cap → **dry joint / open** chance ↑
  - Excess on fine-pitch → **bridge** chance ↑

---

## 7. Stage 5 — Pick & Place Build

- Machine runs visually in 3D. Throughput depends on program, panel, feeder tuning, rejects.
- Mis-teach, wrong feeder, dump-bin parts, and shortages manifest here.
- Line **balancing / bottlenecks** are visible (queue of boards at each station).

---

## 8. Stage 6 — Manual Inspection (the viral core)

The main skill mini-game.

- **Optional** after P&P (costs focus/time; creates bottleneck if overused).
- **Far view:** harder to spot misaligned/missing parts; harder on dense boards.
- **Zoom mode:** pan over the board slowly or quickly (speed vs. thoroughness).
- **Tweezer nudge:** drag misaligned parts back onto pads.
  - **Shaky hands** scale with stress. Late game it's nearly impossible to nudge gently without knocking a part off its pads.
- **Designed for clips:** "find and fix in N seconds without making it worse".

---

## 9. Stage 7 — Reflow

- Converts accumulated risk into actual defects (tombstone, misalign, bridge, dry joint, solder balls).
- **Probability model:** every stage contributes to a per-part defect chance.
  - Never 0%. If **every stage for a part is perfect → 0.5%**.
- **Endgame mechanic:** as backlog grows, oven overloads → board scorching → smoke → **FIRE = game over**.

---

## 10. Stage 8 — AOI (Automated Optical Inspection)

- Player selects AOI program scope: **specific parts** or **whole board**.
  - Whole board = slower, catches more.
- AOI **cannot** detect wrong-value look-alike parts.
- On failure, player can:
  - **Stop the line** and fix the root cause now (throughput hit)
  - **Send to rework** later

---

## 11. Stage 9 — Test & Rework

### 11.1 Test jig
| Lights | Meaning | Result |
|---|---|---|
| 🟢🟢🟢 3 | Good board | Full points |
| 🟢🟢 2 | 1 issue | → Rework |
| 🟢 1 | 2+ issues | → Rework |

### 11.2 Rework mini-game
- Find and fix the fault(s) to recover the points "stored" in that board.
- Outcomes: **Fully repaired** (most points) · **Acceptable** (fewer points) · **Scrap**.

### 11.3 Player notes
- A **notepad available at all times**. Optional.
- e.g. `AA001 — used dump-bin part on C3, board serial 0012`
- Reviewing notes at test/rework helps find faults faster (rewards good habits).

---

## 12. Open Questions (need answers before building)

### Platform & Tech
1. **Target audience** — "just a highschool as the virus target": do you mean the *audience* is high-school students (tone, difficulty, content), or something else?
2. **Platform** — Web browser (Three.js — instant play, best for viral sharing), PC desktop (Unity/Godot, Steam), or mobile?
3. **Engine preference?** No preference → I'd recommend **Three.js/TypeScript** for browser.
4. **Session length** — how long should a typical run last before the fire? (e.g. 10 min / 20 min / 45 min)

### Scope
5. **MVP scope** — build everything at once, or a vertical slice first? Suggested MVP: Job pick → Baselines/ERP puzzle → simple program → feeder load → stencil → P&P → inspect/nudge → reflow → test → fire ending.
6. **Programming depth** — full MY9-style multi-screen GUI, or a simplified version for MVP?
7. **Camera / view** — isolated 3D mini-game scenes per station, or a walkable 3D factory floor?

### Gameplay
8. **Real-time or pause-able?** Does the line keep running while you're in a mini-game (true chaos), or does time pause?
9. **One operator or many?** Just the player doing every role, or hireable/ upgradeable staff?
10. **Progression / meta** — any unlocks, upgrades (better oven, more feeders), or pure arcade high score?
11. **Leaderboard / sharing** — online leaderboard? Shareable end card / replay clip?
12. **Fire tone** — cartoon comedic, or more realistic/dramatic?

### Content & Style
13. **Art style** — stylised low-poly, semi-realistic, or clean toy-like? "Decent 3D" for PCBA details — how close-up/realistic should components be?
14. **Real brand names** — use generic machine names (safer legally), e.g. "MYx9" instead of real brands? (Recommended: generic.)
15. **Humour** — how much office satire (engineer emails, boss pressure, sales promising impossible dates)?
16. **Audio** — music/SFX needed in MVP?

---

## 13. Deliverables (once questions answered)

1. Technical design doc (systems, data model, probability model)
2. Playable vertical slice
3. Full game loop with escalating difficulty and fire ending
4. Scoring, notes system, leaderboard/share card
