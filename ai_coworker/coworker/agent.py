"""The worker: an LLM in a tool-calling loop, with a short rolling history per chat channel."""
import datetime as dt
from collections import defaultdict, deque

from .tools import SCHEMAS, Toolbox

SYSTEM = """You are {name}, an AI coworker in a manufacturing team's group chat. Several people talk to you.
Each user message starts with the sender's name. Today is {today}.
{company}

How you work:
- For ANY stock, usage, BOM or "can we build" question, call the tools. Never estimate or do BOM maths yourself.
- When answering build questions, give the yes/no first, then shortages (qty and whether any is on order),
  then one line of assumptions (e.g. on-order not counted).
- When someone pastes meeting notes: save them with save_note, then list decisions and action items
  (owner + due date if given) and add the actions with add_action. Confirm what you saved.
- When someone reports a production problem, offer to (or just) log it with log_issue.
- You can only READ the ERP. You cannot change stock, orders or jobs - say so if asked.
- Be brief: this is a chat. Use short bullet points, no long preambles. Use item codes as given."""


class Agent:
    def __init__(self, client, model: str, toolbox: Toolbox, name: str = "Worker", company_context: str = "",
                 history_turns: int = 12, max_tool_rounds: int = 8):
        self.client, self.model, self.toolbox = client, model, toolbox
        self.name, self.company_context = name, company_context
        self.history = defaultdict(lambda: deque(maxlen=history_turns * 2))
        self.max_tool_rounds = max_tool_rounds

    def ask(self, text: str, user: str = "someone", channel: str = "default") -> str:
        system = SYSTEM.format(name=self.name, today=dt.date.today().isoformat(), company=self.company_context)
        user_msg = {"role": "user", "content": f"{user}: {text}"}
        messages = [{"role": "system", "content": system}, *self.history[channel], user_msg]

        reply = "Sorry, I went round in circles on that one - try rephrasing?"
        for _ in range(self.max_tool_rounds):
            resp = self.client.chat.completions.create(model=self.model, messages=messages, tools=SCHEMAS)
            msg = resp.choices[0].message
            if not msg.tool_calls:
                reply = msg.content or ""
                break
            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in msg.tool_calls
                ],
            })
            for tc in msg.tool_calls:
                result = self.toolbox.run(tc.function.name, tc.function.arguments, user=user, channel=channel)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

        self.history[channel].extend([user_msg, {"role": "assistant", "content": reply}])
        return reply


def build_agent(settings=None) -> Agent:
    """Wire everything up from settings (env vars)."""
    from openai import OpenAI

    from .config import settings as default_settings
    from .erp import get_backend
    from .memory import Memory

    s = settings or default_settings
    if not s.llm_api_key:
        raise SystemExit("Set LLM_API_KEY in ai_coworker/.env (see .env.example)")
    client = OpenAI(api_key=s.llm_api_key, base_url=s.llm_base_url or None)
    toolbox = Toolbox(get_backend(s), Memory(s.memory_db))
    return Agent(client, s.llm_model, toolbox, s.bot_name, s.company_context)
