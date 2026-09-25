# AOI (Automated Optical Inspection) Program — Implementation Plan

Goal: a robust, user-friendly desktop program that inspects **saved images** (from a
Subascope / USB digital microscope, phone, flatbed scanner, or any camera) of PCBs or
other parts, compares them to a known-good reference, and flags defects clearly.

Works offline, on Windows first (matches this repo), cross-platform where cheap.

---

## 1. Guiding principles

1. **Image-source agnostic** – never assume a resolution, lighting, orientation or
   file format. Normalise everything on import.
2. **Golden-board first, AI second** – classic reference comparison works with a
   single good image and zero training; ML is an optional upgrade once the user has data.
3. **Never silently fail** – every image gets a verdict: PASS / FAIL / NEEDS REVIEW
   (e.g. "couldn't align", "image too blurry"), with a reason.
4. **Operator-friendly** – drag-and-drop, wizard-driven setup, big clear overlays,
   one-click accept/reject that teaches the system.
5. **Reproducible** – every inspection stores the settings, reference version and
   results so any decision can be audited later.

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | Python 3.11+ | Consistent with repo, huge CV ecosystem |
| Vision | OpenCV (`opencv-contrib-python`), NumPy, scikit-image | Alignment, SSIM, morphology |
| GUI | PySide6 (Qt) | Native look, fast image canvas (QGraphicsView), zoom/pan |
| Storage | SQLite + folder of images | Zero-install, portable, like `desktop_buddy.py` |
| Optional ML | ONNX Runtime (anomaly model e.g. PatchCore / small YOLO) | CPU-friendly, no CUDA needed |
| Reports | HTML + PDF (Qt print), CSV export | Shareable |
| Packaging | PyInstaller single-folder `.exe` + installer | Non-technical users |

## 3. Architecture

```
aoi/
  app.py               # entry point, launches GUI or CLI
  core/
    io.py              # load any format, EXIF orientation, 16-bit, HEIC, video frames
    quality.py         # blur / exposure / glare checks -> NEEDS REVIEW
    preprocess.py      # colour normalisation, lens-distortion, denoise, CLAHE
    align.py           # fiducial + feature-based registration (ORB/AKAZE + RANSAC, ECC refine)
    compare.py         # per-ROI diff: SSIM, colour delta-E, edge diff, template match
    inspectors/        # plug-ins: presence, polarity, bridge, solder, OCR, colour, custom
    anomaly.py         # optional ONNX anomaly model
    verdict.py         # combine scores -> PASS/FAIL/REVIEW with reasons
  project/
    model.py           # Project -> Reference(s) -> ROIs -> Inspector configs
    db.py              # SQLite schema + migrations
  gui/
    main_window.py, import_view.py, teach_view.py, results_view.py, review_view.py
  cli.py               # batch/headless: `aoi inspect project.aoi images/`
  report/
tests/  (pytest, synthetic defect fixtures)
```

Pipeline per image:
`load → quality gate → preprocess → align to reference → run ROI inspectors → (optional anomaly map) → verdict → save + overlay`

## 4. Robustness details

- **Import**: PNG/JPG/BMP/TIFF (incl. 16-bit), HEIC via `pillow-heif`, frames from MP4.
  Apply EXIF rotation. Reject corrupt files with a message, never crash the batch.
- **Quality gate**: Laplacian-variance blur score, histogram clipping (over/under
  exposure), specular glare %, scale sanity check vs reference. Out-of-range → REVIEW.
- **Scale/lighting differences**: histogram matching / LAB normalisation to reference;
  optional white-balance from a user-picked neutral area.
- **Alignment**: (a) user-marked fiducials if present, (b) AKAZE features + RANSAC
  homography, (c) ECC sub-pixel refinement. Report alignment error in px; above
  threshold → REVIEW with "align failed" instead of false FAILs. Handle 90°/180°
  rotated and mirrored boards automatically.
- **Microscope specifics**: lens-distortion calibration wizard (checkerboard),
  stitching multiple zoomed tiles into one board image (OpenCV Stitcher / feature
  mosaic) for boards larger than the field of view.
- **Multiple references**: allow several golden images per project (e.g. different
  lighting / component vendors) and take the best match.
- **Tolerance learning**: after 5–20 known-good images, compute per-ROI mean/std of
  scores and auto-suggest thresholds (reduces false calls dramatically).
- **Batch safety**: work in a background thread pool, progress bar, cancel, resume;
  one bad image never stops the run; everything logged to `aoi.log`.

## 5. Inspectors (plug-in interface `inspect(roi_img, ref_img, cfg) -> Result`)

1. **Presence/absence** – SSIM + template correlation.
2. **Shift/rotation** – local template match offset & angle within tolerance.
3. **Polarity / orientation** – match against ref and 180°-rotated ref; pick the better.
4. **Solder bridge / short** – threshold between pads, connected-components across gap.
5. **Solder quality / insufficient** – brightness/colour profile of fillet region.
6. **Foreign material / scratches** – whole-board diff outside ROIs, morphology filter
   on min defect size.
7. **Colour check** – ΔE for LEDs, cables, wire colours.
8. **Text / marking (OCR)** – optional, via Tesseract or PaddleOCR.
9. **Anomaly (ML)** – unsupervised heatmap trained only on good images.

## 6. User experience

- **Home screen**: "New project", "Open project", "Quick compare two images".
- **Setup wizard**:
  1. Drop a known-good image (or several).
  2. Optional: calibrate scale (click two points, enter mm) / lens.
  3. Auto-detect components (contour + blob detection) and propose ROIs; user
     adjusts with drag handles, bulk-assign inspector type.
  4. Test on 3–5 more good images → auto thresholds.
- **Inspect**: drag a folder or images onto the window, or "watch folder" mode that
  inspects new files as the Subascope software saves them.
- **Results**: thumbnail grid coloured green/red/amber; click → side-by-side
  reference vs test, synchronised zoom, flicker toggle, diff heat-map, defect boxes
  with labels and scores.
- **Review loop**: operator clicks *Real defect* / *False call*; false calls
  adjust thresholds or add image as another reference (with confirmation).
- **Quality of life**: undo/redo, keyboard shortcuts (N/P next/prev, F flicker,
  space accept), dark/light theme, tooltips explaining every setting in plain
  language, "Simple" vs "Advanced" settings, autosave.
- **Reports**: per-image PNG overlay, batch HTML/PDF summary, CSV for Excel,
  defect Pareto chart.

## 7. Data model (SQLite)

`project(id, name, created)`, `reference(id, project_id, path, calib_json)`,
`roi(id, reference_id, name, polygon_json, inspector, params_json)`,
`run(id, project_id, started, settings_hash)`,
`result(id, run_id, image_path, verdict, align_err, quality_json)`,
`finding(id, result_id, roi_id, type, score, bbox_json, operator_label)`.
Project saved as a folder `MyBoard.aoi/` (db + reference images) so it can be zipped and shared.

## 8. Milestones

| # | Deliverable | Acceptance |
|---|---|---|
| M1 | Core pipeline CLI: load, quality gate, align, whole-image diff, overlay PNG | Detects synthetic missing part on shifted/rotated/re-lit test images |
| M2 | ROI model + presence/shift/polarity inspectors + SQLite | Per-ROI verdicts, <2% false calls on test set |
| M3 | PySide6 GUI: setup wizard, inspect, results viewer | A non-developer sets up a board in <10 min |
| M4 | Robustness: auto thresholds, multi-reference, lens calib, stitching, watch folder | Handles images from 3 different sources |
| M5 | Remaining inspectors (bridge, solder, colour, OCR), reports | HTML/PDF/CSV exports |
| M6 | Optional ML anomaly module + review-feedback loop | Improves recall on unseen defect types |
| M7 | Packaging, installer, user guide, sample project | One-click install on clean Windows |

## 9. Testing strategy

- **Synthetic defect generator**: from a good image, programmatically remove, shift,
  rotate, recolour components, add bridges/scratches; vary blur, noise, exposure,
  rotation and scale → labelled test set with ground truth.
- Unit tests per module (pytest), golden-output regression tests on overlays,
  metrics tracked per release: detection rate, false-call rate, time/image.
- GUI smoke tests with `pytest-qt`.
- Performance target: < 1 s per 12 MP image on a mid-range laptop CPU (without ML).

## 10. Open questions for the user

1. What is being inspected — PCBs/SMT assemblies, through-hole, or other parts?
2. Which "Subascope" model / software, and what resolution/format does it save?
3. Typical defect types you care most about?
4. Is Windows-only acceptable, and is an ML option (larger install) wanted?
5. Is this single-user bench use or will several stations share projects/results?
