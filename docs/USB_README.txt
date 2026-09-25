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
