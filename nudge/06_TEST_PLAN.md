# 06 — Test & Validation Plan

Five test layers: (1) firmware bring-up, (2) per-unit functional test (FCT),
(3) gesture-model validation, (4) reliability/battery, (5) pre-compliance.

## 1. Bring-up / smoke test (first article)
Do these once on the first good board, in order — each gates the next:
1. **Power:** apply battery; measure VBAT at module; confirm sleep current in the
   right ballpark (µA-range, not mA) with a current meter / Nordic PPK2.
2. **SWD link:** connect debugger; read nRF52840 ID. Flash bootloader + blink.
3. **I2C scan:** firmware scans bus → expect LSM6DSV16X (0x6A/0x6B) and DRV2605L
   (0x5A) ACK. (Catches the two trickiest solder joints early.)
4. **IMU stream:** print accel/gyro; tap board → values move; INT1 toggles.
5. **Haptic:** fire a DRV2605 ROM effect → LRA clicks.
6. **Button/LED:** press → event; LED responds.
7. **Battery ADC:** read divider → plausible voltage; correlate to a DMM.
8. **BLE:** advertise; connect from phone (nRF Connect); read Nudge service.
9. **Charge:** apply charger input; STAT behaves; current tapers as cell fills.

## 2. Per-unit Functional Test (FCT) — the production gate
Build a simple **FCT jig**: pogo-pin bed contacting `VBAT, GND, SWD(4), SDA, SCL,
IMU_INT1, HAP_EN, AIN_BAT, BTN`. A host (laptop + J-Link, or a second nRF as
tester) runs a script that:
1. Powers/【SWD】flashes the unit (app + model + serial).
2. Commands a **built-in self-test (BIST)** over SWD-RTT/serial; the unit runs:
   - I2C presence of IMU + DRV (pass/fail)
   - IMU WHO_AM_I + a motion check (jig nudges, or accept gravity vector sane)
   - DRV2605 buzz (operator confirms / mic or current-spike auto-check)
   - Battery-sense ADC within range
   - BLE advertise + tester reads RSSI ≥ threshold
   - Button GPIO toggling
3. Logs **PASS/FAIL + measurements + serial** to a CSV (your traceability record).
4. Only PASS units proceed to overmold (§ `05_PROCESS_FLOW.md` step 8/10).

**Acceptance:** all BIST items pass; sleep current < spec; RSSI ≥ threshold.
Target first-pass yield ≥ 80% at proto; rework the rest.

## 3. Gesture-model validation (the make-or-break metric)
The product lives or dies on detection quality. Treat it as an ML eval, not a
vibe check.
- **Data collection:** use Edge Impulse (or ST MLC tool). Record labeled IMU
  sessions: target gestures (hand→scalp, hand→face/cheek, hand→nails/mouth) and
  a large "negative" set (typing, eating, driving, brushing teeth, gesturing,
  sleeping, exercise). **Collect from ≥ 8–10 different people and both wrists** —
  generalization across users is exactly where naive devices fail.
- **Split:** hold out **whole subjects** (not random windows) for test, so you
  measure generalization to *new* users.
- **Two-stage eval:** report Stage-1 (IMU MLC) recall (it should be high-recall,
  cheap) and the combined Stage-1→Stage-2 (MCU confirm) **precision**.
- **Targets (proof):** recall ≥ 85% on target gestures; **false positives ≤ 1 per
  2 hours** of normal daily activity (false positives are the churn killer — bias
  the operating point toward fewer false buzzes).
- **Field metric:** ship a "mark false alarm" button; collect those events (with
  consent) to retrain and **push improved models via OTA** — closing the loop is
  your moat versus a fixed-threshold competitor.

## 4. Reliability & battery
- **Battery life:** run units in monitoring mode with a scripted event cadence;
  log VBAT to empty. **Validate the 5–10 day claim before printing it on a box.**
  Measure with Nordic PPK2 for an accurate average-current number.
- **Charge cycle:** verify full charge time, no overheat, charger taper.
- **Haptic endurance:** fire the LRA ~50k times; confirm it still clicks and
  solder joints survive (it's a moving part on a wrist).
- **Wear/sweat:** wear-test units 2+ weeks; check overmold seal, skin reaction,
  band wear, button feel. Spray/IPX4 splash check on the sealed core.
- **Drop:** 1 m drop onto hard floor ×6 orientations; no cracked joints / dead RF.
- **Thermal:** confirm overmold step didn't degrade BLE range (RSSI before/after).

## 5. Software / firmware tests
- **Unit tests** for the event-policy state machine (debounce, quiet hours,
  sensitivity levels, false-alarm marking) — run on host (native build).
- **BLE conformance:** bonding works; reconnect; OTA DFU updates app + model and
  the unit comes back healthy (test a deliberately bad image → safe rollback).
- **Log integrity:** events persist across reset/battery-dead; 30-day capacity.

## 6. Usability / pilot acceptance (proof batch success gate)
- ≥ 10 users, ≥ 2 weeks. Collect: daily-wear %, perceived false-alarm rate,
  comfort, "would recommend" (target median ≥ 4/5), and whether they kept wearing
  it (retention is the real signal).

## 7. Pre-compliance (don't skip before selling)
- **FCC Part 15B (unintentional emitter):** the radio is covered by the module's
  modular grant, but the **finished product** needs a **Part 15B Declaration of
  Conformity** — do a **radiated-emissions pre-scan** at a lab (or near-field
  pre-scan yourself) before a paid launch. Keep the module's grant ID + your test
  records on file. Label per FCC (module grant + your DoC statement).
- **CE (if selling EU):** RED via the module's harmonized testing + your product
  EMC; draft a Declaration of Conformity.
- **Battery shipping:** keep the cell's **UN38.3** summary; follow lithium-cell
  air-ship rules (ship ~30–50% charge, correct labeling).
- **Biocompatibility:** skin-contact band should be skin-safe material (use a
  documented hypoallergenic TPU/silicone; keep the supplier data sheet).
- **Records:** maintain a simple **DHF-lite folder** (design history, test logs,
  per-unit FCT CSV, supplier docs). Even as a wellness device this protects you.
