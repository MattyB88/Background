// model.h — Stage-2 confirm model hook (Edge Impulse).
//
// Stage 1 (IMU MLC) is high-recall and cheap; Stage 2 runs on the nRF to confirm
// and reject false positives. Export your Edge Impulse project as an Arduino
// library and wire run_classifier() in here.
#pragma once
#include <Arduino.h>
#include "imu.h"   // CONFIRM_SAMPLES

// #include <your_project_inferencing.h>   // Edge Impulse export

inline bool modelInit() {
  // TODO: any model warm-up / arena alloc if needed.
  return true;
}

// Returns true if the window is a target BFRB gesture; sets *confidence (0..1).
inline bool modelClassify(float window[][6], float* confidence) {
  // TODO: flatten `window` (CONFIRM_SAMPLES x 6) into the EI signal buffer and:
  //   signal_t signal; numpy::signal_from_buffer(...);
  //   ei_impulse_result_t r; run_classifier(&signal, &r, false);
  //   pick the "target" label score -> *confidence; return score > 0.5
  (void)window;
  *confidence = 0.0f;   // placeholder until model is integrated
  return false;
}

// Bias note: tune the decision threshold (in nudge.ino) toward FEWER false
// positives. A missed pick is forgivable; a phantom buzz makes users quit.
