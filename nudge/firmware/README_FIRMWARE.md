# Nudge firmware

A pragmatic **Arduino + Adafruit nRF52** skeleton for fast proto bring-up. It is
structured so you can later port to nRF Connect SDK / Zephyr for production. The
code compiles around real libraries but has clearly marked `TODO` integration
points (especially the Edge Impulse model export).

## What's here
- `nudge.ino`      — main loop, state machine, two-stage detection glue
- `pins.h`         — GPIO map (MUST match your KiCad pin assignment)
- `nudge_ble.h`    — custom Nudge GATT service (events, stats, config, control)
- `haptic.h`       — DRV2605L LRA wrapper
- `imu.h`          — LSM6DSV16X init + MLC/INT wiring (Stage-1 watcher)
- `model.h`        — Stage-2 confirm model hook (Edge Impulse `run_classifier`)

## Toolchain setup (proto)
1. Arduino IDE → add Adafruit nRF52 board package; select a Feather nRF52840 as a
   near-match board (same MCU) or define a custom variant for the MDBT50Q.
2. Libraries: `Adafruit_DRV2605`, an LSM6DSV16X driver (ST or SparkFun), Adafruit
   Bluefruit (bundled). Edge Impulse: export your project as an **Arduino library**
   and drop it in; wire it into `model.h`.
3. Flash via SWD (J-Link / Tag-Connect). First flash the Adafruit/Nordic
   bootloader so you also get **BLE DFU OTA**.

## Two-stage detection (the important bit)
- **Stage 1 (always-on, in the IMU):** configure the LSM6DSV16X **MLC** with a
  decision tree trained in Edge Impulse / ST MLC tool. It runs at µA and raises
  **INT1** on a candidate gesture. The nRF stays in System-OFF/deep sleep until
  then.
- **Stage 2 (MCU confirm):** on INT1, nRF wakes, grabs a short IMU window, runs
  the Edge Impulse `run_classifier()` confirm model, and applies event policy
  (sensitivity, quiet hours, debounce) before buzzing + logging.

This is what delivers the battery life and the low false-positive rate. If you
skip Stage 1 and keep the MCU awake sampling, battery life collapses — don't.

## Companion app (proof)
Use a **Web Bluetooth PWA** (Chrome on Android/desktop) talking to the Nudge GATT
service — no app store. iOS lacks Web Bluetooth; for iOS pilots use nRF
Toolbox/Connect or a small Flutter app. (PWA is a separate mini-project; the GATT
spec it targets is in `nudge_ble.h` / `02_ARCHITECTURE.md` §6.)

## Status
Skeleton / scaffolding — **not** a finished binary. It gives you the structure,
the BLE service, and the integration seams. The real engineering effort is the
**gesture dataset + model** (`06_TEST_PLAN.md` §3), which only you can collect.
