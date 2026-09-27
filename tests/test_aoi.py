import pytest

from aoi import synth, pnp_import
from aoi.packages import derive


@pytest.fixture()
def prog(tmp_path, monkeypatch):
    monkeypatch.setattr("aoi.program.ROOT", tmp_path)
    from aoi.program import Program
    p = Program("t")
    p.import_placements(pnp_import.parse(synth.csv_text()))
    p.set_golden(synth.render())
    p.auto_teach()
    return p


def test_import_variants():
    mydata = "Ref;X;Y;Angle;Comp;Package\nR1;10000;20000;90;10K;0603\nU1;30000;5000;0;LM;SOIC-8\n"
    r = pnp_import.parse(mydata)
    assert r["units"] == "um" and r["components"][0]["x"] == 10.0 and r["components"][0]["rot"] == 90
    kicad = "# Ref Val Package PosX PosY Rot Side\nC1 100n C_0805 12.5 -3.2 180 top\nC2 1u C_0402 1 2 0 bottom\n"
    r = pnp_import.parse(kicad)
    assert [c["ref"] for c in r["components"]] == ["C1"]


@pytest.mark.parametrize("name,kind,pol", [("0603", "chip", False), ("SOT-23", "sot", True), ("SOIC-8", "ic", True),
                                           ("LED 0805", "led", True), ("SOD-123", "diode", True), ("LQFP-64", "qfp", True)])
def test_packages(name, kind, pol):
    p = derive(name)
    assert p.kind == kind and p.polarized == pol and p.body_l > 0


def test_clean_boards_pass(prog):
    for kw in (dict(light=0.7, angle=-1, offset=(30, 40), seed=5), dict(light=1.3, angle=2, offset=(45, 25), seed=9)):
        r = prog.inspect(synth.render(**kw))
        assert r["ok"], [(c["ref"], c["fails"]) for c in r["components"] if not c["ok"]]


def test_defects_found(prog):
    defects = {"U1": "polarity", "R1": "missing", "C1": "offset", "U2": "marking", "D1": "polarity",
               "LED1": "polarity", "Q1": "missing"}
    expect = {"polarity": "POLARITY", "missing": "MISSING", "offset": "OFFSET", "marking": "MARKING"}
    r = prog.inspect(synth.render(defects, light=0.8, angle=1.5, offset=(50, 22), seed=2))
    got = {c["ref"]: c["fails"] for c in r["components"] if not c["ok"]}
    assert got == {k: [expect[v]] for k, v in defects.items()}


def test_false_call_learning(prog):
    r = prog.inspect(synth.render({"U2": "marking"}, seed=3))
    assert not r["ok"]
    prog.feedback(r["run"], "U2", "false_call")
    r2 = prog.inspect(synth.render({"U2": "marking"}, seed=4))
    assert r2["ok"]
    s = prog.stats()
    assert s["boards"] == 2 and s["false_calls"] == 1


def test_altium_thousands_separators():
    txt = ('Designator,Comment,Layer,Footprint,Center-X(mm),Center-Y(mm),Rotation,Description\n'
           'R34,2.2k,TopLayer,0805B,"12,820,904","4,527,296",180,\n'
           'FD9,,TopLayer,FIDUCIAL_40,"12,560,300","4,796,790",0,IPC Fiducial Mark\n'
           'X1,,BottomLayer,0805B,"12,000,000","4,000,000",0,\n')
    r = pnp_import.parse(txt)
    assert [c["ref"] for c in r["components"]] == ["R34", "FD9"]
    assert abs(r["components"][0]["x"] - 1282.0904) < 1e-6
    assert derive("64PIN_-_TQFP_(PQFP)").kind == "qfp" and derive("SMD_TANT_D").kind == "tant"


def test_solder_bridge(prog):
    r = prog.inspect(synth.render({"U1": "bridge", "U2": "bridge"}, light=1.2, angle=1, offset=(45, 30), seed=6))
    got = {c["ref"]: c["fails"] for c in r["components"] if not c["ok"]}
    assert got == {"U1": ["BRIDGE"], "U2": ["BRIDGE"]}


def test_defect_classification(prog):
    d = {"R1": "tombstone", "C3": "tombstone", "C1": "billboard", "R3": "billboard", "C2": "wrong_value", "R2": "wrong_value"}
    name = {"tombstone": "TOMBSTONE", "billboard": "BILLBOARD", "wrong_value": "WRONG PART"}
    for kw in (dict(light=0.8, angle=1.5, offset=(50, 22), seed=2), dict(light=1.2, angle=-1, offset=(30, 40), seed=4)):
        r = prog.inspect(synth.render(d, **kw))
        got = {c["ref"]: c["fails"] for c in r["components"] if not c["ok"]}
        assert got == {k: [name[v]] for k, v in d.items()}


def test_auto_fiducials_rotated_with_decoys(tmp_path, monkeypatch):
    import cv2
    import numpy as np
    monkeypatch.setattr("aoi.program.ROOT", tmp_path)
    from aoi.program import Program
    img = cv2.copyMakeBorder(synth.render(), 150, 150, 150, 150, cv2.BORDER_CONSTANT, value=(30, 30, 30))
    img = cv2.warpAffine(img, cv2.getRotationMatrix2D((img.shape[1] / 2, img.shape[0] / 2), 7, 1),
                         (img.shape[1], img.shape[0]), borderValue=(30, 30, 30))
    rng = np.random.default_rng(0)
    for _ in range(40):  # vias / holes that look like fiducials
        cv2.circle(img, (int(rng.uniform(200, img.shape[1] - 200)), int(rng.uniform(200, img.shape[0] - 200))),
                   int(rng.uniform(6, 12)), (200, 205, 205), -1, cv2.LINE_AA)
    p = Program("rot")
    p.import_placements(pnp_import.parse(synth.csv_text()))
    p.set_golden(img)
    p.auto_teach()
    M = p.M
    assert abs(np.hypot(M[0, 0], M[1, 0]) - synth.PPM) < 0.2
    assert abs(np.degrees(np.arctan2(M[1, 0], M[0, 0])) + 7) < 0.3


def test_autofit_body_size(prog):
    for pkg, true in (("SOIC-8", (5.08, 3.9)), ("SOIC-14", (8.89, 3.9)), ("SOT-23", (2.9, 1.3)), ("0805", (2.0, 1.25))):
        d = prog.data["packages"][pkg]
        d["body_l"], d["body_w"] = true[0] * 1.4, true[1] * 0.7  # wrong on purpose
        l, w, n = prog.autofit(pkg)
        assert abs(l - true[0]) < 0.3 and abs(w - true[1]) < 0.2, (pkg, l, w)


def test_autofit_keeps_pads_on_leads(prog):
    from aoi.packages import resize
    true = [list(p) for p in prog.data["packages"]["SOIC-8"]["pads"]]
    resize(prog.data["packages"]["SOIC-8"], 7.5, 2.5)  # like pressing L+/W- a lot
    prog.autofit("SOIC-8")
    for a, b in zip(prog.data["packages"]["SOIC-8"]["pads"], true):
        assert abs(a[0] - b[0]) < 0.25 and abs(a[1] - b[1]) < 0.25, (a, b)


def test_autofit_all(prog):
    from aoi.packages import resize
    for name in ("SOIC-8", "0805", "SOT-23"):
        d = prog.data["packages"][name]
        resize(d, d["body_l"] * 1.3, d["body_w"] * 0.8)
    r = prog.autofit_all()
    assert {"SOIC-8", "0805", "SOT-23"} <= {f["package"] for f in r["fitted"]}
    res = prog.inspect(synth.render(light=0.9, angle=1, offset=(45, 30), seed=11))
    assert res["ok"], [(c["ref"], c["fails"]) for c in res["components"] if not c["ok"]]


def test_export_csv(prog):
    import csv, io
    r = prog.inspect(synth.render({"R1": "missing"}, seed=12))
    prog.feedback(r["run"], "R1", "defect")
    prog.inspect(synth.render(seed=13))
    rows = list(csv.DictReader(io.StringIO(prog.export_csv())))
    assert [x["result"] for x in rows] == ["FAIL", "PASS"]
    assert rows[0]["ref"] == "R1" and rows[0]["defect"] == "MISSING" and rows[0]["operator_verdict"] == "real defect"


def test_photo_mode_no_csv(tmp_path, monkeypatch):
    """Program from a photo only, trained on good captures: repeat captures pass, injected faults are found."""
    import sys
    from pathlib import Path
    monkeypatch.setattr("aoi.program.ROOT", tmp_path)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
    import photo_trial as T
    from aoi import autodetect
    from aoi.program import Program
    img = synth.render(seed=1)
    p = Program("photo")
    info = autodetect.program_from_image(p, img)
    assert info["parts"] >= 8
    p.data["compare"]["sensitivity"] = 1.0  # synthetic faults are much fainter than real debris
    p.save()
    for s in range(4):
        p.train_good(T.capture(img, 100 + s, 0.6))
    for s in range(4):
        r = p.inspect(T.capture(img, 200 + s, 0.6))
        assert r["ok"], [(c["ref"], c["fails"]) for c in r["components"] if not c["ok"]]
    parts, _ = autodetect.detect(img)
    bad, faults = T.inject(img, parts, 20.0, 3)
    r = p.inspect(T.capture(bad, 300, 0.6))
    import math
    hits = [any(math.hypot(c["cx"] - x, c["cy"] - y) < rad + 40 for c in r["components"] if not c["ok"]) for _, x, y, rad in faults]
    assert sum(hits) >= len(hits) - 1, faults


def test_false_call_reason(prog):
    r = prog.inspect(synth.render({"U2": "marking"}, seed=21))
    prog.feedback(r["run"], "U2", "false_call", "lighting")
    assert prog.stats()["false_call_reasons"] == [("lighting", 1)]
    assert "lighting" in prog.export_csv()


def test_tuning_layers_library_backup(prog, tmp_path):
    from aoi.program import Program
    c = next(c for c in prog.data["components"] if c["ref"] == "R1")
    prog.set_package_tuning("0603", th={"presence": 0.9})
    assert prog.tuning(c)["presence"] == 0.9                     # package overrides program
    prog.set_part_tuning("R1", th={"presence": 0.4})
    assert prog.tuning(c)["presence"] == 0.4                     # part overrides package
    other = next(x for x in prog.data["components"] if x["package"] == "0603" and x["ref"] != "R1")
    assert prog.tuning(other)["presence"] == 0.9
    assert prog.save_to_library("0603") == 1
    name = Program.restore_zip(prog.backup_zip(), "copy")
    cp = Program(name)
    assert cp.data["packages"]["0603"]["th"]["presence"] == 0.9 and (cp.dir / "golden.png").exists()
    assert cp.inspect(synth.render(seed=31))["ok"]


def test_bare_board_autoprogram(tmp_path, monkeypatch):
    import math
    monkeypatch.setattr("aoi.program.ROOT", tmp_path)
    from aoi.program import Program
    allmiss = {r: "missing" for r, *_ in synth.DEMO if not r.startswith("FID")}
    parsed = pnp_import.parse(synth.csv_text())
    for c in parsed["components"]:
        if not c["ref"].startswith("FID"):
            c["x"] += 0.5
            c["y"] -= 0.4  # sloppy placement file
    p = Program("bare")
    p.import_placements(parsed)
    p.set_golden(synth.render())
    p.auto_teach()
    info = p.set_bare(synth.render(allmiss, light=0.9, angle=0.6, offset=(44, 33), seed=4))
    assert info["snapped"] >= 8
    for c in p.data["components"]:
        if c["ref"] in ("U1", "Q1", "C1"):
            true = next(d for d in synth.DEMO if d[0] == c["ref"])
            assert math.hypot(c["x"] + c["dx"] - true[1], c["y"] + c["dy"] - true[2]) < 0.15
    assert p.inspect(synth.render(light=1.2, angle=-1, offset=(30, 40), seed=8))["ok"]
    r = p.inspect(synth.render({"R1": "missing", "U2": "missing"}, light=0.8, angle=1, offset=(50, 25), seed=9))
    assert {c["ref"]: c["fails"][0] for c in r["components"] if not c["ok"]} == {"R1": "MISSING", "U2": "MISSING"}


def test_ipn_layout():
    txt = "IPN,Comment,Designator,Package,X,Y,Z\nRES-0603-10K,10K,R1,0603,10.0,30.0,90\nIC-SOIC8,LM358,U1,SOIC-8,20,25,180\n"
    r = pnp_import.parse(txt)
    c = r["components"][0]
    assert (c["ref"], c["ipn"], c["part"], c["package"], c["x"], c["rot"]) == ("R1", "RES-0603-10K", "10K", "0603", 10.0, 90)


def test_only_bom_parts_inspected(tmp_path, monkeypatch):
    monkeypatch.setattr("aoi.program.ROOT", tmp_path)
    from aoi.program import Program
    txt = ("IPN,Comment,Designator,Package,X,Y,Z\nRES-0603-10K,10K,R1,0603,10,30,0\n,,H1,3MM_HOLE,5,5,0\n"
           ",,TP4,TP2,8,8,0\nIC-SOIC8,LM358,U1,SOIC-8,20,25,0\n,spare,R99,0603,1,1,0\n")
    p = Program("bom")
    p.import_placements(pnp_import.parse(txt))
    on = {c["ref"] for c in p.data["components"] if c["enabled"]}
    assert on == {"R1", "U1"}
