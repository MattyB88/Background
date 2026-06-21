// nudge.ino — Nudge wearable, main application (Arduino / Adafruit nRF52).
//
// Two-stage, low-power flow:
//   1) LSM6DSV16X MLC watches for a candidate gesture and raises IMU_INT1.
//   2) nRF wakes, runs the Stage-2 confirm model, applies event policy,
//      buzzes + logs, then returns to deep sleep.
//
// This is a SKELETON: BLE/IMU/haptic seams are real; the gesture model and a few
// HAL calls are marked TODO and depend on your Edge Impulse export + driver.

#include <Arduino.h>
#include "pins.h"
#include "imu.h"
#include "haptic.h"
#include "model.h"
#include "nudge_ble.h"

// ---- event policy / settings (mirrored over BLE Config characteristic) ----
struct Settings {
  uint8_t sensitivity = DEFAULT_SENSITIVITY;  // 1..3
  uint8_t nudgeLevel  = DEFAULT_NUDGE_LEVEL;  // 1..3
  bool    enabled     = true;
  uint8_t quietStartHr = 0, quietEndHr = 0;   // 0,0 => no quiet hours
} g_settings;

volatile bool   g_imuEvent = false;     // set in ISR
uint32_t        g_lastBuzzMs = 0;
uint32_t        g_buzzCountToday = 0;

// ---- ISR: IMU Stage-1 candidate -> wake + flag ----
void imuISR() { g_imuEvent = true; }

bool inQuietHours() {
  if (g_settings.quietStartHr == g_settings.quietEndHr) return false;
  // TODO: real RTC/time-of-day. Placeholder: never quiet.
  return false;
}

void logEvent(EventType type, float confidence) {
  // TODO: append {millis()/time, type, confidence} to flash-backed ring log.
  bleNotifyEvent(type, confidence);
  if (type == EVT_BUZZ) g_buzzCountToday++;
}

void handleCandidate() {
  // Stage 2: pull a short IMU window and run the confirm model.
  float window[CONFIRM_SAMPLES][6];
  imuCaptureWindow(window, CONFIRM_SAMPLES);   // ~CONFIRM_WINDOW_MS of accel+gyro

  float confidence = 0.0f;
  bool isTarget = modelClassify(window, &confidence);  // Edge Impulse run_classifier

  // Sensitivity shifts the decision threshold; bias AGAINST false positives.
  const float thr[] = {0.85f, 0.70f, 0.55f};           // sens 1 (strict)..3 (eager)
  bool fire = isTarget && confidence >= thr[g_settings.sensitivity - 1];

  if (!fire) { logEvent(EVT_REJECT, confidence); return; }
  if (!g_settings.enabled || inQuietHours()) { logEvent(EVT_SUPPRESSED, confidence); return; }
  if (millis() - g_lastBuzzMs < EVENT_DEBOUNCE_MS) return;

  hapticNudge(g_settings.nudgeLevel);
  g_lastBuzzMs = millis();
  logEvent(EVT_BUZZ, confidence);
}

void onButton() {
  // short press = "I noticed / log manual"; long press = "that was a false alarm"
  uint32_t t0 = millis();
  while (digitalRead(PIN_BUTTON) == LOW && millis() - t0 < 2000) {}
  if (millis() - t0 > 800) logEvent(EVT_FALSE_MARK, 0.0f);   // feeds retraining
  else                     logEvent(EVT_MANUAL, 1.0f);
}

void setup() {
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_VBAT_EN, OUTPUT);

  Wire.begin();
  imuInit();                 // configure LSM6DSV16X + load MLC decision tree
  imuEnableMLCInterrupt();   // route candidate gesture -> INT1
  hapticInit();              // DRV2605L, LRA mode + auto-resonance
  modelInit();               // Stage-2 confirm model
  bleInit(&g_settings);      // Nudge GATT service + DFU, restore bonded settings

  attachInterrupt(digitalPinToInterrupt(PIN_IMU_INT1), imuISR, RISING);
  // Allow IMU_INT1 to wake from System-OFF deep sleep (TODO: nRF SENSE config).
}

void loop() {
  if (g_imuEvent) { g_imuEvent = false; handleCandidate(); }
  if (digitalRead(PIN_BUTTON) == LOW) onButton();

  bleService();              // handle BLE config writes, stat reads, control cmds

  // Nothing to do -> sleep. With Stage-1 in the IMU, this is where we live ~99%.
  enterLowPowerSleep();      // TODO: System-ON idle or System-OFF w/ INT wake
}
