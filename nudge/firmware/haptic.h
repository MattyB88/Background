// haptic.h — DRV2605L LRA wrapper for the "nudge".
// Goal: a crisp, pleasant tap — not a cheap rumble. LRA mode + auto-resonance.
#pragma once
#include <Arduino.h>
#include "pins.h"
// #include <Adafruit_DRV2605.h>   // recommended; pseudo-API shown below

inline void hapticInit() {
  pinMode(PIN_HAP_EN, OUTPUT);
  digitalWrite(PIN_HAP_EN, HIGH);   // power/enable the driver
  // TODO (Adafruit_DRV2605): drv.begin(); drv.useLRA();
  //   set rated/clamp voltage for your LRA, enable auto-resonance,
  //   selectLibrary(6) for LRA effects.
}

// level 1..3 -> gentler..stronger effect. Keep it brief and kind.
inline void hapticNudge(uint8_t level) {
  digitalWrite(PIN_HAP_EN, HIGH);
  // Map level to ROM effects, e.g. soft tick / double tick / strong click.
  // const uint8_t fx[] = {7 /*soft bump*/, 1 /*strong click*/, 16 /*pulsing*/};
  // drv.setWaveform(0, fx[level-1]); drv.setWaveform(1, 0); drv.go();
  (void)level;
  delay(60);                        // effect plays; keep total event short
  // Optionally power-gate the driver off again between events to save µA:
  // digitalWrite(PIN_HAP_EN, LOW);
}

// quick self-test buzz used by FCT jig / BLE "test-buzz" control command
inline void hapticSelfTest() { hapticNudge(2); }
