"""Runs the agent loop against a scripted fake LLM, so no API key is needed."""
import json
from types import SimpleNamespace as NS

from conftest import ROOT

from coworker.agent import Agent
from coworker.erp.csv_backend import CsvBackend
from coworker.memory import Memory
from coworker.tools import SCHEMAS, Toolbox


class FakeLLM:
    def __init__(self, script):
        self.script, self.seen = list(script), []
        self.chat = NS(completions=NS(create=self.create))

    def create(self, model, messages, tools):
        self.seen.append(messages)
        step = self.script.pop(0)
        if isinstance(step, str):
            return NS(choices=[NS(message=NS(content=step, tool_calls=None))])
        name, args = step
        call = NS(id=f"call_{len(self.seen)}", function=NS(name=name, arguments=json.dumps(args)))
        return NS(choices=[NS(message=NS(content=None, tool_calls=[call]))])


def make(tmp_path, script):
    llm = FakeLLM(script)
    tb = Toolbox(CsvBackend(str(ROOT / "sample_data")), Memory(str(tmp_path / "m.db")))
    return Agent(llm, "fake", tb), llm


def test_tool_round_trip(tmp_path):
    agent, llm = make(tmp_path, [("stock_on_hand", {"item_code": "CCA53"}), "45 available."])
    assert agent.ask("how many CCA53 on hand?", user="Sam", channel="c1") == "45 available."
    tool_msg = llm.seen[1][-1]
    assert tool_msg["role"] == "tool" and json.loads(tool_msg["content"])["available"] == 45


def test_meeting_notes_and_actions_persist(tmp_path):
    agent, _ = make(tmp_path, [
        ("save_note", {"title": "Prod meeting", "body": "CAS123 line down 2h", "tags": "meeting"}),
        ("add_action", {"description": "Fix feeder", "owner": "Jo", "due": "2026-12-01"}),
        "Saved.",
    ])
    agent.ask("notes: ...", user="Sam")
    mem = agent.toolbox.mem
    assert mem.search_notes("CAS123")[0]["author"] == "Sam"
    assert mem.list_actions(owner="jo")[0]["description"] == "Fix feeder"


def test_history_is_per_channel(tmp_path):
    agent, llm = make(tmp_path, ["a", "b"])
    agent.ask("hi", user="A", channel="c1")
    agent.ask("hi", user="B", channel="c2")
    assert all("A: hi" not in m["content"] for m in llm.seen[1] if m["role"] == "user")


def test_bad_tool_args_reported_not_raised(tmp_path):
    tb = Toolbox(CsvBackend(str(ROOT / "sample_data")), Memory(str(tmp_path / "m.db")))
    assert "error" in json.loads(tb.run("stock_on_hand", "{}"))


def test_every_schema_has_a_function(tmp_path):
    tb = Toolbox(None, None)
    for s in SCHEMAS:
        assert hasattr(tb, "t_" + s["function"]["name"])
