# 05 — Manufacturing Process Flow (proof batch 10–25)

End-to-end flow for making 10–25 units with your stack: PnP for SMT, hand-rework
for fixes, low-pressure overmold for sealing, TPU band assembly.

## 0. Process map
```
 DESIGN ─► PANELIZE ─► STENCIL+PASTE ─► PnP PLACE ─► REFLOW ─► AOI/INSPECT ─►
 ─► HAND-REWORK ─► FLASH FW ─► FCT TEST ─► BATTERY+POGO ASSY ─► OVERMOLD CORE ─►
 ─► TPU BAND ASSY ─► FINAL FUNCTIONAL+WEAR CHECK ─► PACK ─► SHIP
        │                                    ▲
        └──────────── fail ─► diagnose ──────┘
```

## 1. Panelize for PnP
- Lay the rigid core PCB in a **panel / breakaway array** (e.g., 2×5 = 10 up)
  with **fiducials** (3 global + local on fine-pitch parts), **tooling holes**,
  and **mouse-bites or v-score** rails. Add a panel **edge rail** for the PnP
  conveyor/clamps.
- Include a **bare test coupon** and **paste-only coupon** the first run.
- Order PCBs **4-layer** (clean RF reference plane under the module; better
  ground for the IMU analog and haptic returns).

## 2. Stencil + solder paste
- Order a **framed/foil stencil** matched to the panel; ~0.12 mm foil.
- Reduce aperture for the **LGA-14 IMU** and **module ground pad** (~10–20% home-
  plate/window-pane) to avoid bridging/voiding.
- Use **SAC305** (or low-temp Sn-Bi if you want gentler reflow; note rework temps
  differ). Print, inspect coverage, re-print if smeared.

## 3. Pick-and-place
- Generate the **centroid/placement (CPL)** + **rotation** files from CAD; sanity
  check 0402 rotations and the module/IMU pin-1 orientation against the gerber.
- Load reels/cut-tape; **the LSM6DSV16X LGA and the module are the two parts to
  babysit** — verify nozzle pickup and placement vision.
- Place finest-pitch first if your machine benefits; otherwise standard order.

## 4. Reflow
- Run the paste vendor's **SAC305 profile** (soak ~150–180 °C, peak ~245 °C,
  TAL 45–70 s). Profile with a thermocouple on the panel the first time.
- **Module + LGA are moisture-sensitive (MSL):** if reels were open, **bake**
  per MSL before reflow to avoid popcorning.

## 5. Inspect (AOI / scope)
- Check: module ground-pad wetting (X-ray if you have it, else inspect edges),
  LGA-14 (likely needs X-ray or careful boundary-scan/functional proof), DRV2605
  and 0402 tombstones/bridges.
- Log defects per location → feeds yield improvements.

## 6. De-panel + hand-rework
- De-panel gently (router/score-snap); support the board so flex doesn't crack
  joints near the module.
- Hand-rework bridges/opens with hot-air + flux. Re-inspect.

## 7. Flash firmware (pre-assembly)
- Via **SWD (J2 / Tag-Connect)**: flash bootloader (Adafruit nRF52 / Nordic
  Secure DFU) + application + **gesture model**. See `06_TEST_PLAN.md` §1.
- Set per-unit serial / MAC-derived ID; record it.

## 8. Functional test (FCT) — *before* sealing
Run the FCT self-test (next doc). **Do not overmold a board that hasn't passed**
— overmold is effectively permanent. Gate here hard.

## 9. Battery + charge-port assembly
- Attach LiPo (with PCM) to VBAT/GND pads; route to **pogo target** (production)
  or USB-C (proto).
- Verify charge (STAT LED / charger behavior) and battery-sense ADC reading.
- Tape/secure battery; no sharp leads near the pouch.

## 10. Low-pressure overmold (your differentiator)
This seals the core for sweat/splash (IPX4+) and gives strain relief.
- **Mold:** start with **3D-printed mold** (resin/SLA for detail, or PETG/ABS);
  move to **aluminum** once the geometry is proven (your stated plan). Two-cavity
  to start.
- **Material:** polyamide low-pressure hot-melt (e.g., Technomelt-class), the
  Kapton-like adhesive you described, dispensed by the manual-pump gun.
- **Prep:** clean/flux residue off the board (IPA), dry it, **mask the antenna
  keep-out face, the pogo contacts, the LRA face, button, and LED window**.
  Pre-warm board slightly to improve adhesion and reduce thermal shock.
- **Shot:** low pressure / low temp (polyamide hot-melts flow ~190–210 °C at a
  few bar — far gentler than injection molding, which is exactly why it's safe
  over populated PCBs). Fill, close, brief cure, demold.
- **QA each shot:** no voids over critical parts, antenna face clear, pogo/LRA/
  button exposed and functional, no flash blocking the band channel.
- **RF check:** confirm BLE RSSI/range unchanged after overmold (material near
  the antenna can detune — keep mask/keep-out honest; re-check in §12).

## 11. TPU band assembly
- Seat the sealed core into the **TPU/silicone band** (3D-printed proto band →
  molded later). Mechanically couple the LRA to the skin-side for a clear nudge.
- Ensure the pogo contacts and button are accessible; smooth all edges.

## 12. Final functional + wear check
- Re-run a **reduced FCT**: BLE connect + RSSI, buzz test, button, charge, battery
  read, gesture self-trigger gesture. Confirm RF not detuned by overmold/band.
- 10-minute wear sanity: comfort, button reachable, buzz perceptible on wrist.

## 13. Pack + ship
- Charge to ~50% for shipping (battery health + air-shipping rules).
- Include: device, magnetic charge cable, quick-start card (pair the PWA, set
  sensitivity), and the **claims-safe** insert (see `07_GO_TO_MARKET.md` §5).
- Record serial → buyer for support/OTA follow-up.

## Per-unit time (rough, after setup)
SMT is batched (panel). **Per-unit hands-on** ≈ rework + flash + FCT + battery +
overmold + band + final ≈ **20–40 min/unit** at proof scale; most shrinks with a
jig and a multi-cavity mold.
