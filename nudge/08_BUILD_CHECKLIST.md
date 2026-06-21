# 08 — Master Build Checklist (proto → sellable)

The single tracker for the `/goal`. Work top to bottom; each phase has a clear
exit. Linked detail in the numbered docs.

## P0 — Concept locked
- [ ] PRD reviewed, claims/regulatory stance accepted (`01_PRD.md`)
- [ ] Name cleared for trademark (have a backup) (`07_GO_TO_MARKET.md` §7)
- [ ] BOM cost target ≤ $22/unit confirmed against live distributor prices

## P1 — Architecture
- [ ] Block diagram + power budget signed off (`02_ARCHITECTURE.md`)
- [ ] BLE GATT spec frozen for v1
- [ ] Toolchain chosen (Arduino+Adafruit nRF52 vs nRF Connect SDK)

## P2 — Electronics design
- [ ] Schematic drawn in KiCad from netlist (`03_SCHEMATIC.md`)
- [ ] Exact nRF GPIO assignments fixed; `firmware/pins.h` updated to match
- [ ] PCB laid out: 4-layer, antenna keep-out honored, test points added
- [ ] DfM review: panelization, fiducials, stencil apertures (LGA/module)
- [ ] Gerbers + CPL + BOM exported; stencil ordered

## P3 — Firmware bring-up
- [ ] Bootloader + blink via SWD
- [ ] I2C scan finds IMU (0x6A/0x6B) + DRV2605 (0x5A)
- [ ] IMU streaming + INT working
- [ ] Haptic effect fires LRA
- [ ] Battery ADC + charge status read
- [ ] BLE advertises; Nudge service readable; bonding works
- [ ] Sleep current in µA range (PPK2 measured)

## P4 — Gesture model
- [ ] Edge Impulse project; labeled data from ≥ 8–10 people, both wrists
- [ ] Subject-held-out eval: recall ≥ 85%, false buzz ≤ 1 / 2 h
- [ ] Stage-1 MLC config + Stage-2 confirm model deployed to device
- [ ] "Mark false alarm" loop wired for future retrain

## P5 — First boards
- [ ] Panel fabbed (4-layer), stencil received
- [ ] Paste + PnP placement run; module + LGA placement verified
- [ ] Reflow profiled (SAC305); MSL bake if needed
- [ ] AOI/scope/X-ray inspect; rework opens/bridges
- [ ] De-panel without cracking module joints

## P6 — Bring-up & test
- [ ] FCT jig built (pogo bed + host script)
- [ ] BIST self-test runs; PASS/FAIL+serial logged to CSV
- [ ] First-pass yield recorded; rework fails
- [ ] All units PASS before any sealing

## P7 — Enclosure / overmold
- [ ] 3D-printed mold proven; masks for antenna/pogo/LRA/button/LED
- [ ] Battery + pogo assembled; charge verified
- [ ] Low-pressure overmold shot; no voids over critical parts
- [ ] Post-overmold RF (RSSI) unchanged; IPX4 splash check
- [ ] TPU band assembled; LRA coupled to skin side; edges smooth
- [ ] Final reduced-FCT + 10-min wear check

## P8 — Pre-compliance
- [ ] FCC Part 15B radiated pre-scan; DoC drafted; labeling done
- [ ] (EU) CE/RED paperwork drafted if selling there
- [ ] Battery UN38.3 summary on file; ship-charge + labels sorted
- [ ] Skin-contact material datasheet on file
- [ ] DHF-lite folder maintained (design + test + supplier records)

## P9 — Go-to-market ready
- [ ] Landing page + honest demo video (`07_GO_TO_MARKET.md`)
- [ ] Claims-safe copy + product insert finalized (legal review hour done)
- [ ] Tindie/Shopify listing; pricing $79–99; quick-start card printed
- [ ] Web Bluetooth PWA live (pair, stats, settings, OTA)
- [ ] Pilot users lined up (≥ 10), consent + feedback form ready

## P10 — Ship the proof batch
- [ ] 10–25 units packed (device + magnetic cable + cards)
- [ ] Serial → buyer recorded for support/OTA
- [ ] 2-week pilot data collected; retention + false-alarm rate reviewed
- [ ] Decide go/no-go for Kickstarter + aluminum mold + PnP panel scale-up

---
### Fast-path summary (if you only read one thing)
1. Draw the schematic/PCB from `03_SCHEMATIC.md` (module does the RF heavy
   lifting — keep antenna keep-out clean). 2. Build one board, bring it up with
   the `firmware/` skeleton. 3. Nail the **gesture model** — that's the product.
   4. Only then panelize, overmold, and sell to the BFRB community.
