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
