PCBA AOI - USB / offline copy
=============================

Works on any 64-bit Windows 10/11 PC. Nothing to install, no internet needed.

1. Copy the whole AOI_USB folder to the PC (e.g. C:\AOI_USB). Running straight off the USB works too, just slower.
2. Double-click START_AOI.bat
3. Browser opens at http://localhost:5050   (if not, type that address in Chrome/Edge)
   Close the black window to stop the AOI.

QUICK TEST WITH YOUR BOARD (test_data folder)
----------------------------------------------
 ＋ New program  -> name it (e.g. CPC68L3)
 1 Program : Import file   -> test_data\CPC68L3\CPC68L3.csv
 2 Board   : Upload image  -> 1_golden_SIMULATED.png      (fiducials found automatically)
 5 Inspect : INSPECT IMAGE -> 2_good_board_SIMULATED.png   -> should PASS
             INSPECT IMAGE -> 3_defect_board_SIMULATED.png -> should FAIL, see EXPECTED_DEFECTS.txt
 6 Review  : Real defect / False call - learn it

The *_SIMULATED images are drawn by the program from your placement file (no real photo).
Parts with unknown packages (connectors, headers, holes, test points, crystal, piezo...)
are drawn/inspected OFF - switch them on in step 4 ROIs if wanted.

WITH REAL PHOTOS
----------------
 Use the same program, step 2: upload a photo of a KNOWN GOOD board (top side, whole board,
 even lighting, camera square to the board). Auto-fiducial -> if it fails, click 2 fiducials.
 Then check the blue boxes sit on the parts (step 4) and inspect other photos.
 Tips: same camera + same lights for golden and test; avoid glare; 15+ pixels per mm is best.

Check in 4 ROIs: IC1 (64 pin TQFP) body size - nudge L/W if the box doesn't fit.

Everything (programs, history, learned images) is saved in the aoi_data folder next to START_AOI.bat.

NEW: PARTS LIBRARY + FINE TUNING
--------------------------------
 📚 (top right)  = Parts library. Tap a package (e.g. 0603):
    - tick/untick checks for ALL parts of that package
    - sliders = package tuning (every 0603 follows)
    - ✨ Auto-fit size   💾 Save to library (shared by all programs)
    - "Use shared library" pulls saved packages into the current program
 🔲 ROIs -> click a part -> "🎚 Fine-tune this part only" = override for that one part.
 Order: program settings < package < part.   "↺ inherited" removes an override.

SAVING / MOVING PROGRAMS
------------------------
 Programs save automatically in the aoi_data folder next to START_AOI.bat.
 ⚙ Settings -> 💾 Backup this program (zip)  /  📂 Restore program from zip
 (use this to copy a program to another PC or keep a safe copy)

CAMERA (plug and play)
----------------------
 Any USB (UVC) camera works: plug in, ⚙ Settings -> 📷 Camera -> pick it -> 👁 Test shot.
 Tick "Lock exposure" once the picture looks right.  Then ▶ Inspect -> 📷 Camera.
 Or use any camera software that saves photos to a folder: ▶ Inspect -> 🔁 Auto folder.
 Aim: whole board fills the picture, camera square to the board, even light, no glare.

BARE BOARD + CSV (easiest, most accurate programming)
-----------------------------------------------------
 1 Import the placement CSV (see csv_templates\PLACEMENT_CSV_GUIDE.txt + placement_template.csv)
 2 Golden photo (good, populated board)  -> fiducials found
 3 Same step: "Add BARE board" = photo of an unpopulated board, same camera position
   -> every part box snaps onto the real part, packages get sized, missing-part check uses the bare board.

BOM WITHOUT XY (e.g. Accentis export: Item Code, Qty, designators)
------------------------------------------------------------------
 Step 1 -> 📦 Load BOM. Ranges like "R60 - R66" are expanded, "J2 (ICSP)" -> J2.
 Through-hole parts (J, JS, P, SW, X, GDT, PCB, CCO... connectors) are marked TH and skipped.
 📋 Parts list (top right): 🧹 delete auto-found boxes, ✂ delete not in BOM, ⏭ skip through-hole,
    tick + 🗑 delete, ✖ clear all, filter, ✔/✖ to switch a part on/off, click a ref to jump to it.
 "➕ Teach them": click each part on the board - it gets the next BOM ref + IPN automatically
    (or pick the ref from the list first). Then ✨ Auto-fit ALL package sizes.

MY9 / MYData LAYOUT (.gen)  -  recommended
------------------------------------------
 Step 1 -> Import file -> pick the .gen straight from the machine export.
 Expect: "MYData layout '...': N machine-placed parts, 3 fiducials".
 If you see "0 fiducials" / only a few parts to inspect you are running an OLD copy - check the
 version shown next to "PCBA AOI" top left (needs v1.5 or newer).
 GEN_TO_CSV.bat : drag .gen files onto it -> standard placement CSV (for other tools / checking).
