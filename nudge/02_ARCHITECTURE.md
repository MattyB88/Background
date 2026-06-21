# 02 — System Architecture

## 1. Design thesis (the one idea that makes it work)
**Let the sensor do the watching, not the MCU.** The ST **LSM6DSV16X** IMU has an
on-chip **Machine-Learning Core (MLC)** + **Finite State Machine (FSM)** that can
run a small gesture/activity classifier at microamp-level current. It watches
for a *candidate* "hand approaching head/face" motion 100% of the time and only
**wakes the nRF52840** via interrupt when something interesting happens. The MCU
then runs a slightly heavier confirmation model, decides, buzzes, and logs — then
goes back to deep sleep.

Result: average current is dominated by the IMU's ~tens-of-µA monitoring, not by
a constantly-awake MCU. That is how Nudge targets 5–10 days on a small cell
*and* gets better rejection of false positives (two-stage detection).

## 2. Block diagram
```
                      ┌──────────────────────────────────────────┐
                      │            Nudge wearable core            │
                      │                                           │
   skin/motion ──▶ ┌──┴───────────┐  INT1/INT2  ┌───────────────┐ │
                   │ LSM6DSV16X    │────────────▶│  MDBT50Q-1MV2 │ │
                   │ 6-axis IMU    │   I2C/SPI   │ (nRF52840     │ │
                   │ +MLC/FSM (ML  │◀───────────▶│  module,      │ │
                   │  watches 24/7)│             │  pre-certified│ │
                   └───────────────┘             │  radio+MCU)   │ │
                   ┌───────────────┐    I2C      │   BLE 5  ●))) │ │
                   │ DRV2605L      │◀────────────│               │ │
                   │ haptic driver │   EN/IRQ    │  SWD ◀────────┼─┼─▶ prog header
                   │   └─▶ LRA ⊚   │             │  GPIO         │ │
                   └───────────────┘             └──────┬────────┘ │
                   ┌───────────────┐    GPIO/ADC         │         │
                   │ button + LED  │◀────────────────────┘         │
                   └───────────────┘                               │
                      │                                            │
   USB-C / pogo ──▶ ┌─┴─────────────┐   VBAT    ┌──────────────┐   │
                    │ MCP73831      │──────────▶│ LiPo 110 mAh  │   │
                    │ LiPo charger  │           │ + PCM protect │   │
                    └───────────────┘           └──────────────┘   │
                      └──── battery % via nRF SAADC (divider) ──────┘
                      └──────────────────────────────────────────┘
```

## 3. Component choices & rationale
| Block | Part | Why |
|---|---|---|
| Radio + MCU | **Raytac MDBT50Q-1MV2** (nRF52840 module) | Pre-certified FCC/IC/CE/MIC. Integrates RF matching, DC/DC inductors, decoupling, antenna **inside the module** → simple, robust external circuit and hand-assemblable. nRF52840: BLE5, USB, 1 MB flash / 256 KB RAM, runs TF-Lite-Micro / Edge Impulse + secure DFU OTA. |
| IMU | **ST LSM6DSV16X** | On-sensor ML core (MLC) + FSM + sensor fusion (SFLP) → always-on gesture watch at µA. The keystone of the power & false-positive story. |
| Haptic | **TI DRV2605L** + LRA (e.g. Vybronics VLV101040A) | Crisp, tuned "click/buzz" library, auto-resonance tracking for LRAs → a *pleasant* nudge, not a cheap rumble. (Cost-down fallback: ERM coin + MOSFET, see BOM alt.) |
| Charger | **Microchip MCP73831** | Tiny SOT-23-5 single-cell LiPo charger, program current with one resistor. Dead simple, hand-solderable. |
| Battery | LiPo pouch ~110 mAh + PCM | Fits a band; PCM for safety; pick a UN38.3-tested cell. |
| Power arch | Run module **directly from VBAT** (nRF52840 1.7–3.6 V, internal DC/DC) | No external regulator needed → fewer parts, lower quiescent. |
| Charge port | Magnetic **pogo-pin** (2-pin) | Lets you fully overmold/seal the core (no open USB cavity) → IPX4+. USB-C alt for proto convenience. |
| Status | 1× side button + 1× LED (or NeoPixel) | Log/acknowledge + status. |

## 4. Power budget (target, monitoring mode)
| State | Approx current | Duty |
|---|---|---|
| IMU MLC always-on watch | ~30–60 µA | 100% |
| nRF52840 System OFF / deep sleep (RAM retain, IMU INT wake) | ~2–4 µA | most of the time |
| nRF wake + confirm + haptic event | ~5–8 mA for ~150–400 ms | seconds/hour |
| BLE connected sync (periodic) | ~1–5 mA avg during sync | minutes/day |
| LRA buzz | ~40–80 mA peak | tens of ms per event |

Rough average ~50–120 µA monitoring. **110 mAh / 0.10 mA ≈ ~900 h theoretical;**
de-rate hard for buzzes, BLE, and reality → **5–10 day target is realistic** if
the IMU does the watching. *Validate empirically — see `06_TEST_PLAN.md` §4.*

## 5. Firmware architecture
```
        ┌──────────────────────────────────────────────┐
        │ app  (event policy, logging, settings)        │
        ├──────────────────────────────────────────────┤
        │ gesture  : MLC config + MCU confirm model     │
        │ ble      : Nudge GATT service + DFU            │
        │ haptic   : DRV2605L effects                   │
        │ power    : sleep states, battery SAADC        │
        │ storage  : event log (flash/QSPI or internal) │
        ├──────────────────────────────────────────────┤
        │ HAL      : I2C/SPI, GPIO/IRQ, timers          │
        └──────────────────────────────────────────────┘
```
- **Toolchain (proto):** Arduino + Adafruit nRF52 core (fastest path) **or**
  nRF Connect SDK / Zephyr (more production-grade). Skeleton in `firmware/` is
  Arduino-style for speed; porting notes included.
- **Two-stage detection:** Stage 1 = LSM6DSV16X MLC decision tree (trained in
  Edge Impulse / ST MLC tool) raises INT on candidate. Stage 2 = MCU runs a
  small confirm model on a short IMU buffer → decide buzz/log.
- **OTA:** nRF Secure DFU over BLE → push improved gesture models to fielded
  units (a real advantage over a fixed-threshold competitor).

## 6. BLE GATT — "Nudge Service"
Custom 128-bit service `4E55-...` (mnemonic "NU"). Characteristics:
| Char | Props | Payload |
|---|---|---|
| Event Stream | Notify | `{ts, type(buzz/false/manual), confidence}` |
| Stats | Read/Notify | counts/day, streaks, battery % |
| Config | Read/Write | nudge strength, sensitivity, quiet hours, enable |
| Model Info | Read | model version/hash |
| Control | Write | test-buzz, clear-log, mark-false |
Plus standard: Battery Service (0x180F), Device Information (0x180A), Nordic
Secure DFU. Bonded + encrypted (health-adjacent data).

## 7. Companion app (proof stage)
A **Web Bluetooth PWA** (works on Android/desktop Chrome) — no app store, no
review delay, instant iteration. Shows today's count, history chart, settings,
test-buzz, and triggers OTA. Native iOS app is a v2 item (iOS lacks Web
Bluetooth — note this limitation; for iOS proof users, use nRF Connect/Toolbox
or a tiny Flutter app). See `firmware/README_FIRMWARE.md`.
