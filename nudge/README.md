# Nudge — gesture-aware habit-interrupt wearable

> A wrist-worn band that learns the motion of an unwanted habit (skin-picking,
> hair-pulling, nail-biting) and gives a gentle haptic **nudge** the moment your
> hand starts the motion — building awareness so you can stop. On-device gesture
> ML, days of battery, sweat-sealed, and roughly half the price of the only
> serious incumbent.

This folder is the **complete design dossier**: from market thesis to a
manufacturable, testable, sellable product. It is written so that someone who
can solder, follow a BOM/schematic, run a PnP machine, and do low-pressure
overmolding can actually build and ship a proof batch of 10–25 units.

## The gap (why this product)
- **Underserved, intensely engaged community.** Body-Focused Repetitive
  Behaviors (BFRBs) — dermatillomania (skin-picking), trichotillomania
  (hair-pulling), onychophagia (nail-biting) — affect millions and have large,
  active support communities (TLC Foundation for BFRBs, r/trichotillomania,
  r/Dermatillomania). They actively buy and recommend tools.
- **One weak, pricey incumbent.** HabitAware **Keen2** (~$129–149) is essentially
  the only consumer device. Common complaints: only one trained gesture
  location, false positives, short-ish battery, dated app. That is a beatable
  product.
- **A real technical moat.** Most "awareness bracelets" are dumb buzzers.
  Reliable, low-false-positive gesture detection with **on-device ML** that
  generalizes across users is the hard part — and the defensible part.
- **Plays to your stack.** Wrist flex-band wearable (your flex-PCB interest),
  electronics core **sweat-sealed by low-pressure overmolding** (your molding
  rig), SMD assembly on your **PnP**, hand-solderable for protos.

## What makes Nudge better than Keen2
| Axis | Keen2 (incumbent) | Nudge (this design) |
|---|---|---|
| Gestures | 1 trained location | Multi-gesture model (face/scalp/nails) |
| Detection | Threshold-ish, false positives | On-device ML (IMU ML-core + MCU confirm) |
| Battery | ~1–2 days typical | Target 5–10 days (sensor does the watching) |
| Price | $129–149 | $79–99 target |
| Data | Cloud-tied app | On-device first; sensitive data stays local |
| Sealing | Standard | Overmolded core, sweat/splash sealed |
| Look/feel | Clinical gadget | Slim (~6–7 mm) + charm bail → reads as jewelry |
| Upsell | None | Charm "jiblet" packs = recurring high-margin revenue |

## The /goal — definition of "done = sellable"
A linear, checkable path. Detail for each phase lives in the numbered docs.

- [ ] **P0 Concept locked** — PRD, claims/regulatory stance, BOM target → `01_PRD.md`
- [ ] **P1 Architecture** — block diagram, power budget, BLE spec → `02_ARCHITECTURE.md`
- [ ] **P2 Electronics** — schematic netlist + BOM → `03_SCHEMATIC.md`, `04_BOM.csv`, `nudge.net`, `diagrams/nudge_schematic.png`
- [ ] **P2b Mechanical** — slim stack-up + charm/jiblet bail → `09_MECHANICAL.md`
- [ ] **P3 Firmware** — BLE + IMU + haptic + power skeleton runs → `firmware/`
- [ ] **P4 Gesture model** — Edge Impulse data → model ≥ target precision → `06_TEST_PLAN.md`
- [ ] **P5 First boards** — panelized, PnP + reflow, hand-rework protos → `05_PROCESS_FLOW.md`
- [ ] **P6 Bring-up & test** — FCT jig, self-test passes on all units → `06_TEST_PLAN.md`
- [ ] **P7 Enclosure** — overmold core + TPU band, fit/wear test → `05_PROCESS_FLOW.md`
- [ ] **P8 Pre-compliance** — FCC Part 15B DoC plan, battery/UN38.3 notes → `06_TEST_PLAN.md`
- [ ] **P9 Go-to-market** — pricing, channel, Kickstarter/Tindie, claims copy → `07_GO_TO_MARKET.md`
- [ ] **P10 Ship 10–25** — packaged, instructions, support loop → `08_BUILD_CHECKLIST.md`

## Read in this order
1. `01_PRD.md` — what we're building and the rules we play by
2. `02_ARCHITECTURE.md` — how it works, electrically and in software
3. `03_SCHEMATIC.md` + `04_BOM.csv` — the buildable design
4. `firmware/` — the code skeleton
5. `05_PROCESS_FLOW.md` — how 10–25 units get made
6. `06_TEST_PLAN.md` — how we prove each one works
7. `07_GO_TO_MARKET.md` — how it becomes income
8. `08_BUILD_CHECKLIST.md` — the master tracker

## Important honesty note on claims
Nudge is positioned as a **habit-awareness / wellness biofeedback** device, **not
a medical device**. It does **not** diagnose, treat, or cure trichotillomania,
dermatillomania, or any condition. Keeping that line clean is what keeps you out
of FDA medical-device regulation — see `01_PRD.md` §6 and `07_GO_TO_MARKET.md` §5.
