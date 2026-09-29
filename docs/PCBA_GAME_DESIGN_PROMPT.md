# ICooked — Game Design Prompt

> *"IC" + "cooked". Say it out loud: "I cooked". Whatever you do, you get fired.*
>
> Status: **v1.0. Answers to the v0.1 questions are included.** The build plan and post-launch plan are in [`ICOOKED_ROADMAP.md`](./ICOOKED_ROADMAP.md).

---

## 1. Role & Goal

Build **ICooked**, a first-person 3D indie game for **PC (Steam)** priced at **$1–5**. It is meant to sell to a very wide audience through streamer and clip-driven virality.

You are the only operator on an SMT (surface-mount) line at a chaotic contract manufacturer. Sales keeps promising the impossible, engineering keeps releasing broken data, and the reflow oven is one bad shift away from catching fire.

**The game cannot be won.** Every run ends with you **fired**. The only question is **how high your score is when it happens**, and how funny the way it happens is.

### Design pillars
1. **High score is the viral hook.** Runs are easy to understand, hard to master, and produce shareable moments ("I nudged a QFN off the board at 1h47m").
2. **Authentic but funny.** Real PCBA process (BOMs, ODB++, feeders, fiducials, stencils, reflow, AOI, test, rework) turned into mini-games. Industry people should laugh because it's true, and everyone else should laugh because it's chaos.
3. **Logic puzzles people love.** The **BOM Sudoku** (data reconciliation) is a signature mechanic and must be satisfying and fair.
4. **Constant pressure.** Time never stops. Even the pause menu keeps the factory running.
5. **Quality presentation.** Modern indie look with near-real PCBAs, tactile tools and machines, full audio. No tacky low effort. Stylised is fine, simplistic is not.

---

## 2. Player Perspective & Presentation

- **First-person, hands only.** You never see your body, only your hands and the tool you're holding.
- **Walkable 3D factory floor.** You walk between stations. When you walk up to a station and interact, the camera glides smoothly into that station's view.
- **Every station plays differently** (puzzle, UI sim, dexterity, spatial sorting, precision), but they share one visual language, one set of hands, one clock, and one stress level.
- **Body inventory (tools in pockets):**
  - Tools (tweezers, paste syringe, soldering iron, hot-air pencil, scanner, marker, notepad, ESD brush, feeder key…) live in pockets or on a belt.
  - You can **set a tool down at a station**. It stays there. Before leaving, you must **click it to take it back**. Otherwise it's not in your pocket when you need it at the next station (a deliberate and funny failure mode).
- **Art direction:** semi-realistic, stylised lighting. PCBAs are **near-real**: green/black/blue solder mask, silkscreen, copper pads, and real footprints (0402/0603/0805/1206, SOT-23, SOIC, TSSOP, QFN, QFP, BGA, tantalum, electrolytic, connectors, USB-C). Machines and hand tools have character but no real branding.
- **No real brand names anywhere.** All machines, software, and companies are invented (e.g. the pick-and-place is a fictional "**PX-9**").

---

## 3. Core Loop

```
Schedule grows ──► Pick a job ──► BOM Sudoku (Baselines + ERP + engineer folder)
      ▲                                   │
      │                                   ▼
  Score / cash ◄── Ship ◄── Test ◄── AOI ◄── Reflow ◄── Inspect/Nudge ◄── Pick & Place
      │                        │                                        ▲
      │                        └──► Rework                               │
      │                                                   Stencil ──────┘
      │                                                      ▲
      └──── oven heat, customer anger, cash drain ──► Program PX-9 ──► Load feeders
```

- **Real time, always.** The line only stops when it's bottlenecked. **The pause menu doesn't pause** (it's a joke and a mechanic).
- **The schedule keeps growing.** Sales adds jobs and pulls deadlines in.
- **Job types:**
  - **In-house / repeat:** known data, existing programs. Lower points, fewer surprises.
  - **New contracts:** bonus points, but bring broken data, new programs, and new part teaching.
  - The player may **decline** new contracts, but the high score depends on balancing contracts, in-house work, and catching and fixing mistakes.
- **One operator: you.** No staff to hire in v1.

---

## 4. End States (always "You're fired")

A run usually lasts **up to ~2 hours** for skilled players. It can in theory go on forever if a player finds a loophole, which is intended, because it's great streaming content.

| Ending | Cause | Sequence |
|---|---|---|
| **Oven fire** | Reflow heat meter maxes out | Scorching boards → smoke → alarm → sprinklers → fired |
| **Bankrupt / lights out** | No cash to buy parts for promised boards | Suppliers stop → power bill unpaid → **factory goes dark** → fired |
| **Customer revolt** | Customer anger maxes out from missed deadlines | Contracts pulled → cash collapses → lights out → fired |

End card: **"ICOOKED"**, final score, time survived, boards shipped, parts dropped, fires started, a funny cause-of-death line, and a **shareable image card** (then Steam leaderboard).

### 4.1 Oven Heat & Maintenance loop (the "ticking bomb")
- The reflow oven has a **heat/residue meter** that rises with throughput. The more boards you push, the faster it rises.
- To reset it, the player must do **Oven Maintenance**:
  1. Stop feeding boards into the oven.
  2. Either **wait for the boards inside to clear** (slow) or **pull them early and bin them** (lose their points).
  3. Play the **maintenance mini-game** (scrape flux residue, clear the conveyor, swap filters, check the fans).
- Each cycle:
  - the **time until the next critical point gets shorter**, and
  - **maintenance takes longer**.
- Result: a runaway spiral that ends everything eventually. Clever players may still find a sustainable loop, which is allowed and is part of the fun.

### 4.2 Economy
- **Cash** comes from shipped good boards. Late delivery costs penalties.
- **Parts cost money.** Scrap, dumped parts, and rework consume stock.
- **Customer anger** is tracked per customer and rises with late or bad boards.
- **Sales** keeps adding jobs whatever your capacity is.

---

## 5. Stage 1 — Job Intake & the BOM Sudoku

**Station: Programming desk (PC with 3 "apps")**

### 5.1 Sources
| App | Contents | Reliability |
|---|---|---|
| **Baselines** (network folder) | Engineer-released BOM + ODB++ package per assembly | Official but **always incomplete or inconsistent** |
| **Engineer's folder** | WIP notes, old revs, screenshots, sticky-note photos, emails | Messy, sometimes holds the missing clue |
| **ERP** | IPNs, descriptions, manufacturer part numbers, stock and locations, approved alternates, rev history, customer ↔ assembly mapping | Accurate but clunky to search |

### 5.2 Naming chaos
- Assembly IPN: `AA001_Rev1.0` · Bare PCB IPN: `CPC001_Rev1.0`
- The engineer's release is named **`USB c charger - version that works.zip`**
- Mixed conventions, wrong revs, `FINAL_final2`, and descriptions that don't match ERP.

### 5.3 Puzzle design ("Sudoku-style")
- Each job is a **grid of rows (designators) × columns (designator, value, package, IPN, placement XY/rotation)** with blanks and contradictions.
- Clues come from cross-referencing: ERP descriptions, footprints in the ODB++ data, engineer notes, previous revs, and stock locations.
- **A generator plus a solver** makes sure every cell is either:
  - **deducible** (pure logic, with a unique solution), or
  - a **deliberate gamble cell** (two or three plausible answers, flagged internally). Guessing right gives a **big bonus**, and guessing wrong means the board fails later.
- Fault types: missing designator, missing IPN (value only), BOM ↔ placement mismatch, duplicate designators, wrong rev, inconsistent descriptions, swapped packages.
- Difficulty scales with contract size and game time.

---

## 6. Stage 2 — Programming the PX-9 (fictional pick & place)

**UI style:** a **retro Linux desktop** in the spirit of a basic X11/Motif-era workstation (grey bevels, monospace fonts, small icons), made clean and readable. It has all the general PnP GUI features but is **not a copy** of any real machine's software.

### 6.1 Steps (as in real life)
1. **Create Layout** (conveyor width, board support)
2. **Create PCB:** a single board **or a panel** (N × M, with spacing)
3. **Fiducials:** find existing fids or **teach** new ones. Fid shapes differ in how easy they are to detect (round bare copper = easy, odd shapes or poor contrast = hard).
4. **Components:** add a designator, name it, link a component.
5. **New component → Package Teach mini-game** (6.3)
6. **Optimise and assign** to feeders (links to Stage 3)

### 6.2 Panel trade-off
- More boards per panel → **score multiplier**.
- **Machine limits** on panel size: small boards fit many per panel, large boards only one or a few.
- Bigger panels have longer cycle times, which can make the PX-9 the **line bottleneck**.

### 6.3 Package Teach mini-game
- Click and drag to **trace the body outline and the leads or balls**.
- Choose **lighting** (front / side / back) and the **search method** (leads, body, corners, balls).
- A **hidden teach-quality score** drives placement offset and rotation error and the **camera reject rate**.
- The player can **accept a poor teach as a risk**. They never see the number, only the result on the board.

---

## 7. Stage 3 — Feeders, Materials & the Dump Bench

- Load parts into the **correct feeder type and slot**: tape (8/12/16/24 mm), **stick**, **tray**.
- **Common parts can stay on** between jobs, which makes changeovers faster.
- **Pick tuning:** the longer a feeder stays loaded, the better its pick accuracy.
- Parts get used up and reels run out, which forces a **changeover**.
- **Chance-based events:** reels hold fewer parts than their label says, tapes jam, tapes are short, cover tape tears, and sticks jam.
- **When you run out:**

| Option | Time | Risk |
|---|---|---|
| Approved alternate (ERP request) | Cooldown | None |
| Unapproved alternate | Instant | Chance of wrong part |
| Dump bin | Instant | Look-alike parts |

- **Dump Bench:** tip the bin onto the bench and come back later to sort the piles. Some parts are **indistinguishable** (for example unmarked MLCCs). A wrong value can't be caught by AOI, only at **test**.

---

## 8. Stage 4 — Stencil Print

- **Squeegee mini-game:** drag with the mouse. Quality depends on smoothness, constant speed, and pressure.
- The result for each pad is good, insufficient, excess, missed, or smeared.
- In the **SPI view**, the player can wipe and reprint (costs time), **hand-dab paste with a syringe** (too much causes bridges, too little causes dry joints), or ignore it (risk).
- **Defect mapping:**
  - Missed pad on an 0805 R/C → **tombstone** more likely
  - Missed pad on an IC or tantalum → **dry joint / open** more likely
  - Excess paste on fine pitch → **bridge** more likely

---

## 9. Stage 5 — Pick & Place Run

- The PX-9 places parts in 3D, and the player can watch it.
- Problems show up here: teach quality, feeder type, dump-bin parts, mis-picks, and camera rejects.
- **Queues are visible** at every station, so the player can see bottlenecks.

---

## 10. Stage 6 — Manual Inspection & Tweezer Nudge (viral core)

- **Optional**, but it costs your time while the line keeps moving.
- **Far view:** hard to spot faults, especially on dense boards.
- **Zoom / magnifier mode:** pan across the board. Going fast risks missing faults, going slow creates a bottleneck.
- **Tweezer nudge:** drag misaligned parts back onto their pads.
  - **Hand shake scales with stress.** Late in the game it's almost impossible to nudge gently, and parts get flicked off the board.
- Built for clips: *find it, fix it, and don't make it worse*.

---

## 11. Stage 7 — Reflow

- Turns the accumulated risk into actual defects: tombstone, misalignment, bridge, dry joint, solder balls, and scorch.
- Feeds the **Oven Heat** meter (§4.1).

### 11.1 Defect probability model
For each part, the defect chance is:

```
p = clamp( 0.5% + Σ stage_risk , 0.5% , 95% )
stage_risk = data_risk + teach_risk + feeder_risk + print_risk + placement_offset_risk
           + manual_handling_risk + oven_heat_risk
```
- **It is never 0%.** If every stage is perfect for a part, **p = 0.5%**.
- Each risk source is modelled per defect type, so a missed pad raises the tombstone chance on a chip part but the dry-joint chance on an IC.

---

## 12. Stage 8 — AOI

- The player chooses the program scope: **selected parts** (fast) or **the whole board** (slow, catches more).
- It **can't** detect wrong-value look-alike parts.
- On a fail, the player can **stop the line** and fix the root cause, or **send the board to rework** later.

---

## 13. Stage 9 — Test Jig & Rework

| Lights | Meaning | Result |
|---|---|---|
| 🟢🟢🟢 | Good | Full points and cash |
| 🟢🟢 | 1 issue | → Rework |
| 🟢 | 2+ issues | → Rework |

**Rework mini-game:** find the fault (probe, magnifier, notes), then fix it with the iron or hot air.
- Outcomes: **fully repaired** (most points recovered) · **acceptable** (partial) · **scrap** (lost, and you pay for parts).

**Notes system:** a notepad is always available, e.g. *"AA001 — dump part on C3, S/N 0012"*. It's optional, but reviewing your notes at test and rework makes finding faults much faster.

---

## 14. Stress System

The stress level rises with backlog, customer anger, oven heat, and cash drain. It affects:
- tweezer and squeegee hand shake
- the chance of jams and events
- the music's intensity and layers
- sales emails and the boss's phone calls

---

## 15. Audio (required for launch)

- **Adaptive music:** layered tracks that build with stress and the oven meter.
- **Tactile SFX:** feeder clicks, the PX-9 head, the conveyor, the oven hum and alarms, tweezer ticks, the squeegee scrape, the solder iron hiss, test jig beeps.
- **Ambient factory bed** plus comedic one-liners (sales voicemails, boss calls, engineer "it works on my bench").

---

## 16. Technical Direction

| Area | Choice | Why |
|---|---|---|
| Engine | **Three.js + TypeScript + Vite** | Modern 3D with PBR, fast iteration, and can be automatically play-tested in this dev environment |
| Desktop / Steam | **Electron** wrapper + **steamworks.js** | Ships on Windows/Linux/Mac (Steam Deck friendly), with Steam leaderboards and achievements |
| PCB rendering | **Procedural** boards, footprints, silkscreen, and components from job data | Endless jobs, near-real detail, consistent with the puzzle data |
| Simulation | Deterministic, seeded tick-based sim separate from rendering | Fair leaderboards, daily seeds, reproducible bugs |
| UI | HTML/CSS overlay for the retro Linux GUIs, ERP, and file browser | Fast to build and authentic-looking |
| Audio | Web Audio with adaptive layering | Stress-driven music |

**Allowed:** quirky or buggy behaviour is fine if it's fun, but the puzzle logic and scoring must be solid.

---

## 17. Scope

- **v1.0 (launch):** everything in this document, with high score only, no unlock tiers, one operator, share card, and Steam leaderboard.
- **After launch:** see the Extended Plan in [`ICOOKED_ROADMAP.md`](./ICOOKED_ROADMAP.md).
