"""Build a self-contained Windows (64-bit) AOI folder for USB transfer - no install, no internet.

    python tools/build_usb_bundle.py [placement.csv ...]

Output: dist/AOI_USB/ and dist/AOI_USB.zip
"""
import io, shutil, subprocess, sys, urllib.request, zipfile
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from aoi import pnp_import, synth  # noqa: E402
from aoi.packages import derive  # noqa: E402

PY = "3.12.7"
OUT = ROOT / "dist" / "AOI_USB"


def main(csvs):
    shutil.rmtree(OUT, ignore_errors=True)
    py = OUT / "python"
    py.mkdir(parents=True)
    url = f"https://www.python.org/ftp/python/{PY}/python-{PY}-embed-amd64.zip"
    zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url).read())).extractall(py)
    (py / "python312._pth").write_text("python312.zip\n.\nLib\\site-packages\n..\nimport site\n")
    wh = ROOT / "dist" / "wheels"
    subprocess.check_call([sys.executable, "-m", "pip", "download", "-q", "-d", str(wh), "--only-binary=:all:",
                           "--platform", "win_amd64", "--python-version", "3.12", "--implementation", "cp",
                           "flask", "numpy", "opencv-python-headless"])
    sp = py / "Lib" / "site-packages"
    for w in wh.glob("*.whl"):
        zipfile.ZipFile(w).extractall(sp)
    shutil.copytree(ROOT / "aoi", OUT / "aoi", ignore=shutil.ignore_patterns("__pycache__"))
    (OUT / "START_AOI.bat").write_text(
        '@echo off\r\ntitle PCBA AOI\r\ncd /d "%~dp0"\r\nset AOI_DATA=%~dp0aoi_data\r\n'
        'echo Starting AOI... browser will open. Close this window to stop.\r\n'
        'start "" http://localhost:5050\r\n"%~dp0python\\python.exe" -m aoi.app\r\npause\r\n')
    # test material: user's placement files + simulated board images for each
    td = OUT / "test_data"
    td.mkdir()
    for csv in csvs:
        csv = Path(csv)
        name = csv.stem.split("-", 1)[-1]
        d = td / name
        d.mkdir()
        shutil.copy(csv, d / f"{name}.csv")
        comps = pnp_import.parse(csv.read_text(encoding="utf-8-sig"))["components"]
        lay, board = synth.layout_from(comps)
        lay = [l for l in lay if derive(l[5], l[4]).kind != "generic"]
        cv2.imwrite(str(d / "1_golden_SIMULATED.png"), synth.render(layout=lay, board=board))
        cv2.imwrite(str(d / "2_good_board_SIMULATED.png"),
                    synth.render(layout=lay, board=board, light=1.2, angle=-1, offset=(30, 40), seed=8))
        refs = {l[0]: l for l in lay}
        pick = {}
        for kind, want in (("missing", "chip"), ("polarity", "ic"), ("polarity", "diode"), ("marking", "ic"), ("offset", "chip"), ("missing", "tant")):
            for r, l in refs.items():
                if r not in pick and derive(l[5], l[4]).kind == want:
                    pick[r] = kind
                    break
        cv2.imwrite(str(d / "3_defect_board_SIMULATED.png"),
                    synth.render(pick, layout=lay, board=board, light=0.8, angle=1.2, offset=(55, 25), seed=3))
        (d / "EXPECTED_DEFECTS.txt").write_text("3_defect_board_SIMULATED.png should FAIL on:\r\n" +
                                               "\r\n".join(f"  {r}: {k.upper()}" for r, k in pick.items()) + "\r\n")
    shutil.copy(ROOT / "docs" / "USB_README.txt", OUT / "READ_ME_FIRST.txt")
    shutil.make_archive(str(OUT), "zip", OUT.parent, OUT.name)
    print("Built", OUT.with_suffix(".zip"), f"{OUT.with_suffix('.zip').stat().st_size / 1e6:.0f} MB")


if __name__ == "__main__":
    main(sys.argv[1:])
