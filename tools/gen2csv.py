"""Translate a Mycronic MYData layout (.gen) to the AOI's standard placement CSV.

    python tools/gen2csv.py CAS157-10_RevE2.gen            -> CAS157-10_RevE2_placements.csv
    (Windows: drag the .gen file onto gen2csv.bat)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aoi import pnp_import  # noqa: E402

for arg in sys.argv[1:]:
    src = Path(arg)
    parsed = pnp_import.parse_file(src.read_bytes())
    out = src.with_name(src.stem + "_placements.csv")
    out.write_text(pnp_import.to_csv(parsed), encoding="utf-8")
    print(f"{src.name}: {len(parsed['components'])} rows -> {out.name}  ({'; '.join(parsed['warnings'])})")
