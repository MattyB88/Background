// imu.h — LSM6DSV16X wrapper: Stage-1 always-on gesture watcher.
//
// The keystone: configure the on-sensor Machine-Learning Core (MLC) with a
// decision tree (exported from Edge Impulse or ST's MLC tool) so the IMU detects
// candidate gestures at microamps and only interrupts the MCU on a hit.
#pragma once
#include <Arduino.h>
#include <Wire.h>
#include "pins.h"

#define CONFIRM_SAMPLES 120   // e.g. ~240 Hz * 0.5 s window for Stage-2

// ---- low-level register helpers (replace with ST driver if preferred) ----
inline void imuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(IMU_I2C_ADDR);
  Wire.write(reg); Wire.write(val);
  Wire.endTransmission();
}
inline uint8_t imuRead(uint8_t reg) {
  Wire.beginTransmission(IMU_I2C_ADDR);
  Wire.write(reg); Wire.endTransmission(false);
  Wire.requestFrom((int)IMU_I2C_ADDR, 1);
  return Wire.read();
}

inline bool imuInit() {
  if (imuRead(0x0F) != 0x70 /* WHO_AM_I expected for LSM6DSV16X family */) {
    // NOTE: confirm WHO_AM_I value against the exact datasheet revision.
    return false;
  }
  // TODO: set ODR/full-scale for accel+gyro (e.g. 240 Hz, ±4g / ±2000dps),
  //       enable block-data-update, low-power mode, and sensor fusion if used.
  return true;
}

// Load the MLC decision tree + route its event to INT1.
inline void imuEnableMLCInterrupt() {
  // TODO: program the MLC register bank with the Edge Impulse / ST MLC config,
  //       enable the MLC, and route MLC1 interrupt -> INT1 (MD1_CFG / EMB_FUNC).
  pinMode(PIN_IMU_INT1, INPUT);
}

// Grab a short accel+gyro window for the Stage-2 confirm model.
inline void imuCaptureWindow(float win[][6], int n) {
  for (int i = 0; i < n; i++) {
    // TODO: read OUTX/Y/Z accel + gyro; convert to g / dps; fill win[i][0..5].
    for (int j = 0; j < 6; j++) win[i][j] = 0.0f;
    delayMicroseconds(4166); // ~240 Hz placeholder; prefer FIFO burst read
  }
}
