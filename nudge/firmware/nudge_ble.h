// nudge_ble.h — Nudge custom GATT service (Adafruit Bluefruit pseudo-API).
// Bonded + encrypted: this is health-adjacent data.
#pragma once
#include <Arduino.h>
// #include <bluefruit.h>

enum EventType : uint8_t {
  EVT_BUZZ = 0,        // nudge delivered
  EVT_REJECT,          // candidate rejected by Stage-2
  EVT_SUPPRESSED,      // disabled / quiet hours
  EVT_MANUAL,          // user short-press: "I noticed"
  EVT_FALSE_MARK,      // user long-press: "that was a false alarm" (retrain data)
};

// Nudge Service UUID base: 4E55xxxx-... ("NU"). Pick a real 128-bit base in impl.
// Characteristics (see 02_ARCHITECTURE.md §6):
//   Event Stream  (Notify)      : {ts, type, confidence}
//   Stats         (Read/Notify) : counts/day, streak, battery%
//   Config        (Read/Write)  : sensitivity, nudgeLevel, enabled, quietHours
//   Model Info    (Read)        : model version/hash
//   Control       (Write)       : test-buzz, clear-log, mark-false
// Plus: Battery Service 0x180F, Device Info 0x180A, Nordic Secure DFU.

struct Settings;  // fwd-decl (defined in nudge.ino)

inline void bleInit(Settings* s) {
  // TODO: Bluefruit.begin(); set tx power; configure bonding/security;
  //   add Nudge service + characteristics; restore persisted settings into *s;
  //   start advertising. Enable Secure DFU for OTA model/app updates.
  (void)s;
}

inline void bleNotifyEvent(EventType type, float confidence) {
  // TODO: pack + notify on Event Stream characteristic if connected;
  //   always append to local log regardless of connection state.
  (void)type; (void)confidence;
}

inline void bleService() {
  // TODO: apply pending Config writes to live Settings; answer Stat reads;
  //   handle Control commands (test-buzz, clear-log). Non-blocking.
}
