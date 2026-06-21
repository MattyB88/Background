# 01 — Product Requirements (PRD)

## 1. One-liner
A wrist band that detects the *motion* of a body-focused repetitive behavior and
delivers a gentle haptic nudge in real time, plus a private log so the user can
see patterns and progress.

## 2. Target user
- Adults managing a BFRB (skin-picking, hair-pulling, nail-biting) who want
  awareness in the moment. Often already in CBT / habit-reversal training (HRT)
  and looking for a tool that supports the "awareness training" step.
- Secondary: parents buying for teens (note: this raises duty-of-care and data
  sensitivity — treat carefully, see §6).

## 3. Jobs to be done
1. "Make me aware the instant my hand goes to my hair/face/nails, even when I'm
   zoned out." (core)
2. "Don't cry wolf — if it buzzes at nothing I'll stop wearing it." (false
   positives are the #1 churn driver for the incumbent)
3. "Show me when/where it happens so I can see progress." (logging)
4. "Be comfortable and discreet enough to wear all day and to sleep." (ID)
5. "Last more than a day so I'm not babysitting a charger." (battery)

## 4. Functional requirements
| ID | Requirement | Target |
|---|---|---|
| F1 | Detect target hand-to-head/face/nail gesture | ≥ 85% recall, ≤ 1 false buzz / 2 h (see test plan) |
| F2 | Haptic nudge latency from gesture onset | ≤ 400 ms |
| F3 | User-adjustable nudge strength + on/off | 3 levels + off |
| F4 | Manual "log this" / "that was a false alarm" button | 1 button, short/long press |
| F5 | Local event log | ≥ 30 days of events on-device |
| F6 | BLE sync to companion (stats, config, OTA) | BLE 5, bonded |
| F7 | Battery life, monitoring mode | ≥ 5 days (stretch 10) |
| F8 | Recharge | ≤ 1.5 h to 80%, magnetic pogo (sealed) |
| F9 | On-device gesture model update via OTA | Yes (nRF DFU) |
| F10 | Sweat / splash resistant | IPX4 minimum (overmolded core) |

## 5. Non-functional requirements
- **Comfort/ID:** band ≤ ~12 mm thick at the core, soft TPU/silicone, hypo-
  allergenic skin contact, no sharp edges. Wearable to sleep.
- **Privacy:** mental-health-adjacent data. On-device first; no raw motion leaves
  the device; cloud is opt-in and aggregate only. This is also a marketing edge.
- **Quiet failure:** if the model is unsure, prefer *not* buzzing (false
  positives churn users faster than misses).
- **Repairable proto:** test points on all rails and key signals; SWD header.

## 6. Regulatory / claims stance (read carefully)
This is the make-or-break framing for a small maker.

- **Position as a general wellness / awareness device, NOT a medical device.**
  Permitted language: "build awareness of a habit", "notice the motion",
  "track and reflect". **Forbidden** language: "treat", "cure", "therapy for",
  "diagnose", "reduces trichotillomania", any disease claim. Disease-treatment
  claims pull you into FDA medical-device regulation (US) / MDR (EU). Avoid them
  in *all* copy, packaging, and app text.
- **FDA General Wellness guidance (US):** low-risk products that promote a
  general state of health / healthy activity and make **no disease claims** are
  generally not actively regulated as devices. Stay inside that lane. (Get a
  one-hour consult with a regulatory attorney before any paid launch — cheap
  insurance.)
- **Radio:** use a **pre-certified radio module** (FCC/IC/CE modular approval) so
  you do NOT need intentional-radiator testing. The finished product still needs
  an **FCC Part 15B (unintentional emitter) Declaration of Conformity** — see
  `06_TEST_PLAN.md` §7.
- **Battery:** LiPo cells need **UN38.3** for shipping; buy cells from a vendor
  that supplies the UN38.3 test summary. Add basic protection (PCM) on the cell.
- **Privacy law:** if you ever store health-adjacent data in the cloud, US state
  laws (e.g., consumer health data acts) and GDPR may apply. The on-device-first
  design avoids most of this for the proof batch.

## 7. Out of scope (v1 proof batch)
- Cloud account system, social features, clinician dashboard.
- Heart rate / EDA sensing (defer; IMU-only keeps cost/power/complexity down).
- iOS/Android native app store release (use a **Web Bluetooth PWA** for proof,
  see `firmware/` notes — zero app-store friction).

## 8. Success criteria for the proof batch (10–25 units)
- 10–25 units built, each passes FCT self-test.
- ≥ 10 real users wear for ≥ 2 weeks; median "useful / would recommend" ≥ 4/5.
- False-buzz rate low enough that nobody quits over it (qualitative gate).
- A repeatable per-unit build + test time you can actually sustain.
- Validated price point (pre-orders or paid pilots) that clears ~$40+ margin/unit.

## 9. Cost & price targets
- **BOM target (proto qty):** ≤ $22/unit (see `04_BOM.csv`; drops with volume).
- **All-in proto cost** (BOM + PCB + overmold + band + packaging + your time
  amortized): aim ≤ $40/unit at qty 25.
- **Retail target:** $79–99 (undercuts Keen2's $129–149 while leaving margin).
