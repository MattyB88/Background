// pins.h — Nudge GPIO map for nRF52840 (MDBT50Q-1MV2)
// IMPORTANT: these are PLACEHOLDER nRF P0.xx assignments. Set them to match your
// KiCad schematic, then keep this file and the schematic in lockstep.
// Avoid NFC pins (P0.09/P0.10) unless you reconfigure UICR.NFCPINS.
#pragma once

// --- I2C bus (IMU + haptic share it) ---
#define PIN_SDA        4   // P0.04  (example)
#define PIN_SCL        5   // P0.05

// --- IMU LSM6DSV16X ---
#define PIN_IMU_INT1   28  // P0.28  Stage-1 MLC/FSM event + wake-from-sleep
#define PIN_IMU_INT2   29  // P0.29  data-ready / secondary event
#define IMU_I2C_ADDR   0x6A   // 0x6B if SA0 high

// --- Haptic DRV2605L ---
#define PIN_HAP_EN     30  // P0.30  enable / power-gate the driver
#define DRV_I2C_ADDR   0x5A

// --- User IO ---
#define PIN_BUTTON     31  // P0.31  to GND, internal pull-up
#define PIN_LED        2   // P0.02  status LED (or NeoPixel DIN)

// --- Battery sense ---
#define PIN_VBAT_ADC   3   // P0.03 / AIN1  (1M/1M divider)
#define PIN_VBAT_EN    27  // P0.27  optional load-switch to gate divider (saves µA)
#define VBAT_DIV       2.0f

// --- Behavior tuning defaults (overridable via BLE Config char) ---
#define DEFAULT_SENSITIVITY   2     // 1..3
#define DEFAULT_NUDGE_LEVEL   2     // 1..3 (LRA effect strength)
#define EVENT_DEBOUNCE_MS     1500  // min gap between buzzes
#define CONFIRM_WINDOW_MS     500   // IMU window fed to Stage-2 model
