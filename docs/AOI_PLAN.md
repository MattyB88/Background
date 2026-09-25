# AOI Program — Implementation Plan (v2)

A self-improving, low-setup AOI (Automated Optical Inspection) program for **saved images**
of PCBs from a **Suba Engineering Subascope 2K camera** (and any other camera).
It covers three process stages and gets its setup directly from **Mycronic MY9 pick-and-place data**.

| Stage | What it checks | Priority |
|---|---|---|
| **Post-reflow** (main use) | Missing part, polarity/orientation, OCV/OCR, shift, bridges, tombstones | P1 |
| **Pre-reflow (placed)** | Missing part, polarity, OCV/OCR, placement offset into the paste | P2 |
| **Stencil print (SPI-lite)** | Paste present, paste area and offset, bridging, smear (2D only, no height) | P3 |

All three share one board project (the same CAD/PnP data and fiducials); each stage adds its own inspection rules.

---

## 1. Design goals

1. **Setup in minutes, not hours.** Import the MY9 program, then click 2–3 fiducials/parts
   on one image. Everything else (inspection areas, body sizes, polarity marks, text) is proposed automatically.
2. **Gets smarter with every board.** Each operator decision (real defect or false call)
   feeds back into the per-part and per-package models, and thresholds tune themselves.
3. **Package-level knowledge, not board-level.** What the program learns about an `0603`,
   a `SOT-23` or an `SOIC-8 / part no. XYZ` is reused on every future board that uses it.
4. **Never silently wrong.** Every result is PASS, FAIL or REVIEW, with a reason and a confidence score.
5. **Everything auto-proposed can be fine-tuned by hand.** Nothing is locked.

## 2. Image source: Subascope 2K

- Load the files it saves (JPG/PNG/BMP, ~2K frames) from a **watched folder**, so a new
  image is inspected as soon as it is saved. Drag-and-drop and batch folders also work.
- A 2K frame won't cover a whole board at useful detail, so there are two modes:
  - **Whole-board mode**: one frame, lower zoom. Good for missing/polarity on bigger parts.
  - **Tile mode**: several zoomed frames that are stitched automatically or aligned
    tile by tile to board coordinates using features/fiducials. Needed for 0402/0201 parts and OCR.
- One-time **calibration wizard** per zoom setting: a checkerboard or ruler sets pixels per mm
  and corrects lens distortion. It is saved as a named profile ("Subascope 2K @ zoom 3").
- Image quality check before inspection (blur, glare, exposure, ring-light hot spots). A bad
  image gets REVIEW with the message "retake image", never a false FAIL.
- *To confirm:* exact resolution, output format, and whether the lens is fixed-zoom or variable.

## 3. MY9 pick-and-place import (the core of the auto-setup)

- **Importer with column mapping**: reads the MY9 / MYCenter placement export or the source
  CAD centroid (CSV/TXT). Fields: RefDes, X, Y, rotation, side, part number/component name,
  package/footprint, and fiducials. It recognises columns automatically; the user confirms
  the mapping once and it is saved as a template.
- *To confirm:* a sample export file from your MY9 setup (MYPro/MYCenter format differs between versions).
- Also accepted: Gerber paste layer (for stencil stage), IPC-2581/ODB++ later, BOM for part numbers.
- **Board-to-image registration**: board coordinates (mm) are mapped to image pixels with 2 or
  3 fiducials, or by clicking 3 known part centres. After that, a feature-based alignment
  refines it automatically on every image. Rotated/mirrored boards and panel arrays
  (step-and-repeat) are handled.
- **Rotation conventions**: MY9 rotation, CAD rotation and the package's pin-1 origin
  are reconciled per package by a **rotation offset table**. It is learned once per package:
  if the first board shows every SOT-23 at 90°, one click fixes all of them.

## 4. Automatic inspection areas (ROIs)

For each placement the program generates:
- **Body window**, sized from the package library (built in: common chips, SOT, SOIC, QFN,
  QFP, electrolytics, diodes, LEDs; editable). It is then **snapped to the part edges** found in the image.
- **Pad/fillet windows** (reflow stage) and **paste windows** (stencil stage), taken from
  package pad geometry or the paste Gerber.
- **Polarity window**: where the pin-1 dot, band, bevel or "+" marking should be.
- **Text window** for OCV/OCR on marked parts.

Fine-tuning: drag or resize any window, or edit its numbers. A change can apply to
**this part / all parts with this part number / all parts with this package**. Handles show
auto-proposed vs manually edited values, and one click resets to auto.

## 5. Inspection methods (per stage)

**Missing part**
- Stage-aware comparison of the body window against learned "part present" and "bare pads
  / paste only" appearance (colour, texture, edge density). Doesn't need a golden board.
- A small CNN classifier (present / missing / wrong part / damaged) per package family
  takes over once enough labelled examples exist.

**Polarity / orientation**
- Match the learned polarity mark against the part at 0/90/180/270°; the best-scoring
  angle is compared with the expected MY9 rotation.
- Rules by package type: diode band side, electrolytic "−" stripe, pin-1 dot/bevel on ICs,
  tantalum band, LED marks. For symmetric passives, polarity is switched off automatically.

**OCV (verification) and OCR (reading)**
- OCR engine (PaddleOCR or Tesseract, run locally) reads marking text after the part image is
  rotated to upright using the known placement angle.
- OCV compares the text with the expected marking for each part number (learned from the first
  good boards or entered by hand), with tolerant matching of look-alike characters (0/O, 1/I, 8/B)
  and date codes/lot fields masked by user-set regex.
- If the text reads correctly upside-down, it's also a polarity failure; this check
  cross-validates the polarity result.

**Extras (cheap once the above exists)**
- Reflow: part shift/skew vs pads, tombstone, solder bridge between leads, missing fillet.
- Pre-reflow: placement offset relative to the paste deposits, which gives feedback for
  MY9 placement tuning.
- Stencil: paste coverage % per pad, offset, bridging, missing or smeared prints.

## 6. "Gets smarter" — learning and logic

1. **Label every decision.** In review, the operator presses **Real defect** / **False call**
   (with defect type). Each label is saved with the image crop.
2. **Statistical thresholds** per part number and per package: mean and spread of every score
   over accepted boards. Thresholds tighten on stable parts and loosen on noisy ones,
   inside user-set limits.
3. **Few-shot models**: after ~20 labelled crops per package, train a small ONNX classifier
   on the CPU in the background. The new model is only switched in if it beats the current
   one on held-out data (no regressions). Results are versioned, with rollback.
4. **Anomaly model** trained only on good images, for defects nobody has seen yet.
5. **Logic rules (the "AI handles states" part):**
   - Stage rules: a part missing pre-reflow and present post-reflow means the images are
     mixed up, so it asks.
   - Cross-check rules: an OCR upside-down result combined with polarity OK becomes REVIEW, not PASS.
   - Board-level rules: if every part is shifted the same way, it's an alignment/fiducial
     problem, not 200 defects. The program re-aligns and warns once.
   - Traceability: the same defect on the same RefDes over N boards gets flagged as a process
     issue (feeder, nozzle, stencil aperture) and suggests the likely cause.
   - Rules are stored as readable, editable entries, not hidden code.
6. **Optional AI assistant** (off by default, needs internet/API key): explain a failure,
   suggest the likely cause, summarise a shift's results in plain language. Inspection
   itself always runs locally.

## 7. User experience

- **New board wizard** (target: under 5 min):
  1. Drop in the MY9 file, then confirm the column mapping (remembered next time).
  2. Drop in one image, then click the fiducials (or the program finds them).
  3. Choose stages: Stencil ☐ Placed ☐ Reflow ☑.
  4. Auto inspection areas appear on the image; fix anything obvious and save.
  5. Inspect 3–5 good boards; thresholds and OCV text are learned automatically.
- **Run screen**: large PASS/FAIL banner, board image with coloured parts, list of
  failures sorted by confidence. Keyboard review: `Y` real defect, `N` false call, arrow keys for next.
- **Part view**: reference crop vs current crop, flicker, zoom, OCR text overlay, rotation shown.
- **Library view**: every learned package and part number, their models, thresholds and
  history, which can be shared between boards and PCs.
- **Reports**: per board (PDF/HTML), per lot (CSV), defect Pareto by RefDes, part number and
  cause, and a serial/barcode field for traceability.
- Simple/Advanced mode, plain-language tooltips, autosave, undo/redo.

## 8. Architecture and tech

Python 3.11, OpenCV, NumPy, PySide6 GUI, SQLite, ONNX Runtime (CPU), PaddleOCR/Tesseract,
PyInstaller Windows installer.

```
aoi/
  io/          image loading, watch folder, calibration profiles, stitching
  cad/         MY9/CSV importer + column mapping, Gerber paste, package library, rotation table
  register/    fiducial + feature alignment, panel arrays
  roi/         auto ROI generation + snapping + override hierarchy
  inspect/     missing, polarity, ocv_ocr, shift, bridge, paste  (plug-ins, per stage)
  learn/       labels store, stats thresholds, trainer, model registry, anomaly
  rules/       logic/state engine (editable rules)
  gui/         wizard, run, review, library, settings
  report/
  cli.py       headless batch for automation
```

Data: `Board → Stage → Placement(RefDes, part_no, package, x, y, rot)`, `Package/PartNumber
library (shared)`, `Run → Image → Result → Finding(label)`, `Model(version, metrics)`.

## 9. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M1 | MY9 import + column mapping, calibration, fiducial registration, overlay of all placements on a Subascope image | Boxes land on the correct parts on real images |
| M2 | Auto ROI + snapping + fine-tune editor, package library | A board is set up in <5 min |
| M3 | Missing + polarity (rules + learned template), reflow stage, PASS/FAIL/REVIEW | Finds planted missing/rotated parts; <1% false calls after learning |
| M4 | OCR/OCV with rotation normalisation and look-alike tolerance | Reads the markings on your common ICs |
| M5 | Review loop, statistical auto-thresholds, library sharing | False-call rate drops measurably over 20 boards |
| M6 | Pre-reflow stage + placement-offset feedback | Works on placed boards |
| M7 | Classifier + anomaly training, model versioning, logic rules engine | New model only goes live if it tests better |
| M8 | Stencil stage (2D paste), reports/Pareto, optional AI assistant, installer | One-click Windows install |

## 10. Testing

- A **real sample set is needed early**: your MY9 export, and ~10 Subascope images per stage
  (good boards + a few with removed/rotated parts).
- A synthetic defect generator (remove part, rotate 180°, shift, change text, smear paste) gives
  labelled regression tests; accuracy and false-call rate are tracked per release.
- pytest for the core, pytest-qt for GUI smoke tests. Target: < 3 s per 2K image, CPU only.

## 11. Still needed from you

1. A sample MY9 placement export (which program: MYCenter, MYPro, or CAD centroid?).
2. Sample Subascope 2K images: one good board per stage, plus one with known defects.
3. Is the zoom fixed or variable, and do you shoot the whole board or several zoomed tiles?
4. Do boards have fiducials? Are they single boards or panels?
5. Is the optional online AI assistant wanted, or must everything stay offline?
