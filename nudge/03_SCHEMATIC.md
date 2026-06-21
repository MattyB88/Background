# 03 — Schematic (textual netlist + design notes)

This is a complete connection list you can enter directly into KiCad/Altium plus
the design notes that matter for a wearable. Reference designators are used in
`04_BOM.csv`. Pin names follow each part's datasheet.

> Net naming: `VBAT` = raw LiPo (~3.0–4.2 V). The nRF module runs directly from
> VBAT. `GND` = single solid ground pour. I2C bus = `SCL`/`SDA` (4.7 k pull-ups
> to VBAT). All decoupling caps go as close to the pin as layout allows.

## 1. Power & charging
```
USB-C VBUS (or pogo +) ─┬─ R_ESD/ferrite ─► MCP73831 VBUS(pin4 VDD)... see below
                        └─ (USB-C: CC1/CC2 each 5.1k to GND for 5V sink)

MCP73831 (U4, SOT-23-5):
  pin1 STAT  ─► R7 (1k) ─► LED1 (charge, optional) ─► GND
  pin2 GND   ─► GND
  pin3 VBAT  ─► VBAT net ─► C5 (4.7µF) ─► GND ; ─► battery + (through PCM)
  pin4 VDD   ─► VBUS ; C4 (1µF) ─► GND
  pin5 PROG  ─► R6 (e.g. 5k → ~200mA; 10k → ~100mA) ─► GND   # set charge current
Battery: BT1 LiPo + ─► PCM ─► VBAT ;  BT1 - ─► GND
Battery sense: VBAT ─► R8 (1M) ─┬─► nRF AIN (P0.04/AIN2)   # /2 divider
                                └─► R9 (1M) ─► GND ;  C8(100nF)─►GND
  (enable divider only during sample via a P-FET/load switch Q2 to save µA — optional)
```
Notes:
- **No external 3V3 regulator.** nRF52840 + module internal DC/DC run from VBAT.
- Put a **reverse/ESD** TVS (D2) on the charge input.
- If using **pogo** charging, replace USB-C with a 2-pad pogo target (VBUS, GND)
  and keep CC resistors only if you keep a USB-C proto port.

## 2. MDBT50Q-1MV2 module (U1) — core
```
U1 VDD pins      ─► VBAT ;  decouple: C1(100nF)+C2(1µF)+C3(4.7µF) close to module
U1 GND pads      ─► GND (stitch the module ground pad with vias)
U1 SWDIO/SWDCLK  ─► J2 (SWD 1.27mm header: VDD, GND, SWDIO, SWDCLK, RESET)
U1 P0.xx (SDA)   ─► SDA  (I2C)
U1 P0.xx (SCL)   ─► SCL  (I2C)
U1 P0.xx (IMU_INT1) ─► LSM6 INT1
U1 P0.xx (IMU_INT2) ─► LSM6 INT2
U1 P0.xx (HAP_EN)   ─► DRV2605 EN
U1 P0.xx (HAP_IRQ)  ─► DRV2605 IRQ (optional)
U1 P0.04/AIN2       ─► VBAT divider (battery sense)
U1 P0.xx (BTN)      ─► SW1 (to GND, use internal pull-up)
U1 P0.xx (LED)      ─► R10(330Ω) ─► LED2 ─► GND   (or single NeoPixel DIN)
U1 D+/D-            ─► USB-C data (optional, for USB DFU/serial during proto)
```
- Keep the **module antenna keep-out** clear of copper/metal/battery per Raytac
  layout guide — put the module at the **end of the band core**, antenna facing
  out, battery and metal away from it. This is the one RF rule you must not break
  (it protects the modular certification).
- Assign exact P0.xx pins in KiCad to ease routing; update `firmware/pins.h` to
  match. (Pin *names* above are logical; pick free GPIO and keep I2C off NFC pins
  unless you reconfigure them.)

## 3. IMU — LSM6DSV16X (U2, LGA-14, 2.5×3.0 mm)
```
U2 VDD, VDDIO ─► VBAT ;  C6(100nF) each ─► GND
U2 GND        ─► GND
U2 SCL/SCX    ─► SCL
U2 SDA/SDX    ─► SDA
U2 SDO/SA0    ─► GND or VBAT  (sets I2C addr 0x6A/0x6B)
U2 CS         ─► VBAT (selects I2C mode)
U2 INT1       ─► nRF IMU_INT1   (MLC/FSM event + wake)
U2 INT2       ─► nRF IMU_INT2   (data-ready / 2nd event)
```
- **LGA-14 needs PnP + reflow or hot-air**; not practical by hand-iron. For
  hand-only first article, use an LSM6DSV16X/LSM6DSOX **breakout** wired to the
  core, then move to the LGA footprint on the panel run.
- Orient the IMU axes consistently and **record the orientation** — your gesture
  model is orientation-specific. Put a silkscreen axis marker.

## 4. Haptics — DRV2605L (U3, VSSOP-10) + LRA
```
U3 VDD     ─► VBAT ; C7(1µF)+ bulk C9(10µF) ─► GND   (LRA current is spiky)
U3 GND     ─► GND
U3 SCL/SDA ─► SCL/SDA  (I2C addr 0x5A)
U3 EN      ─► nRF HAP_EN
U3 IN/TRIG ─► tie per mode (I2C trigger mode: pull as datasheet)
U3 OUT+/-  ─► LRA1 (+/-)
U3 REG     ─► C10(1µF) ─► GND
```
- LRA gives a tuned, pleasant click; set the DRV2605 to LRA mode + auto-resonance
  and pick effects from the ROM library in firmware.
- **Cost-down alt (BOM ALT):** drop U3; drive an **ERM coin motor** from a GPIO
  via Q1 (MOSFET, e.g. DMN2075U) low-side, with flyback diode D1 across the
  motor and an RC. Cheaper, less refined feel.

## 5. Decoupling / passives summary
- I2C pull-ups: R1, R2 = 4.7 kΩ to VBAT.
- Module: 100 nF + 1 µF + 4.7 µF.
- DRV2605: 1 µF + 10 µF bulk (motor transients).
- IMU: 100 nF per supply pin.
- Button: rely on internal pull-up + 100 nF debounce (C11) optional.

## 6. Test points (do not skip — saves hours at bring-up)
Add labeled TPs: `VBAT`, `GND`, `SDA`, `SCL`, `IMU_INT1`, `HAP_EN`, `AIN_BAT`,
plus the SWD header J2. These feed the FCT jig in `06_TEST_PLAN.md`.

## 7. Layout / flex notes (wearable-specific)
- **Form:** a small **rigid core** PCB (module + IMU + haptic + charger) is the
  pragmatic v1; a **rigid-flex** with the battery/charge on a flex tail is the
  upgrade once proven. Don't start with full flex — start rigid core in a TPU
  band, move to rigid-flex at scale.
- Keep the **module antenna over a board edge with ground keep-out** (see §2).
- Place the **LRA** mechanically coupled to the band/skin, away from the antenna.
- Battery and any metal (pogo, shielding) **away from the antenna keep-out**.
- Single solid ground pour; stitch grounds with vias; star the noisy haptic/motor
  return so transients don't couple into the IMU analog.
- Strain relief: any flex/cable to the battery or pogo must be molded-in (your
  overmold step) — this is where low-pressure molding earns its keep.
- Round all board corners; no sharp edges under the overmold.

## 8. What I cannot give you here
A literal KiCad `.kicad_sch`/`.kicad_pcb` binary. This netlist + the BOM is enough
to draw it in an afternoon. If you want, I can generate **KiCad symbol/footprint
hints and a flat netlist file** next, or a JLCPCB-style placement list.
