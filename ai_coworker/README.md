# AI Coworker (proof of concept)

An "AI worker" that sits in a group chat, answers stock questions from the ERP, remembers meeting
notes, and tracks production issues and actions. It also runs a scheduled check each morning and posts what needs attention.

```
 Discord / Teams / terminal          the worker                          data
 ─────────────────────────   ┌─────────────────────────┐   ┌──────────────────────────────┐
 "@Worker how many CCA53?" ─▶│ LLM (OpenAI or Claude)  │──▶│ ERP: CSV export or Accentis  │
                             │  + tools (code does the │   │      SQL (READ-ONLY)         │
 morning digest  ◀───────────│    maths, not the LLM)  │──▶│ Memory: notes, issues,       │
 (cron / scheduler)          └─────────────────────────┘   │      actions (SQLite)        │
                                                           └──────────────────────────────┘
```

The chat platform is a thin adapter, so the same worker runs in the terminal and in Discord today, and
in Teams once that's set up. It ships with **sample data** (CCA53, CAS123, CAS234, CAS321…) so you can demo it
before anyone grants ERP access.

## Things you can ask

- `how many CCA53 on hand?` → on hand / allocated / available / on order
- `how many do we use per year?` → uses the last 365 days of stock issues
- `if I build 10x CAS123 and 20x CAS234, will I have enough to build 5x CAS321?`
  → **No**: CAS234 is short 5x CAB2M. After those two builds, CAS321 is short 10x CCA53 (40 on order) and you can build only 1.
- `what about if we count stock on order?`
- `anything at risk of running out?`
- *(paste meeting notes)* → saves them, lists decisions, creates action items with owners/dates
- `what did we decide about the CAS123 line last week?` → searches saved notes
- `log an issue: feeder jamming on line 2, high` / `what actions are open for Jo?` / `mark action 3 done`

Build checks are deterministic code (`coworker/planning.py`). The LLM decides which tool to call and words
the answer, but never does the BOM arithmetic itself, so it won't make up numbers. Rules it follows:
available = on hand − allocated, on-order only if you ask, builds are checked in the order you list them,
and sub-assemblies come out of stock first and are built only when stock runs out.

## Quick start (terminal demo, ~5 minutes)

```bash
cd ai_coworker
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then put your API key in LLM_API_KEY
python run_cli.py           # type /as Sam to switch who's talking
python run_digest.py        # the morning digest (no API key needed)
python -m pytest -q tests   # no API key needed
```

## About "using the ChatGPT Business account"

**ChatGPT Business seats don't include API access.** A bot like this one calls the API, and API usage is billed
separately through platform.openai.com. Options:

1. **Ask whether the company has (or will add) an OpenAI API org/project** and get a key with a monthly spend
   limit. For a team asking a few dozen questions a day on a small model, this usually costs a few dollars a month.
   That's the easiest thing to ask the boss for ("$20/month cap").
2. **Claude instead:** set `LLM_BASE_URL=https://api.anthropic.com/v1/`, `LLM_MODEL=claude-sonnet-5-5` and use an
   Anthropic API key. The code doesn't change.
3. **No API at all, using only ChatGPT Business:** expose the same tools as an MCP server and add it to ChatGPT
   as a custom connector, if your workspace admin allows custom connectors. Everyone could then ask stock
   questions inside ChatGPT (including shared projects). You'd lose the "@mention it in the team chat" and
   scheduled digest parts. A possible next step once the Accentis connection works.

## Discord (works today)

Company stock data would end up in Discord, so get the boss's OK first and use a private server.

1. https://discord.com/developers/applications → New Application → **Bot** → Reset Token → paste into `DISCORD_TOKEN`.
2. On the same page enable **Message Content Intent**.
3. OAuth2 → URL Generator → scopes `bot`, permissions *Send Messages, Read Message History, View Channels* → open the URL and add it to your server.
4. `python run_discord.py`, then in a channel: `@Worker how many CCA53 on hand?`
5. For the morning digest, right-click the channel → Copy Channel ID (turn on Developer Mode in settings first) → `DISCORD_DIGEST_CHANNEL_ID`.

It only responds when @mentioned or DM'd. Each channel keeps its own short conversation history,
so follow-ups like "how many do we use per year?" work. Notes, issues and actions are shared across all channels.

## Microsoft Teams

- **Now, probably without IT:** the morning digest can post into a Teams channel. In the channel, open
  **Workflows** → *"Post to a channel when a webhook request is received"*, copy the URL into
  `TEAMS_WEBHOOK_URL`, and schedule `python run_digest.py` with cron or Windows Task Scheduler.
  This is one-way only (the bot posts, you can't chat back).
- **Later, a full two-way @mention bot:** needs an Azure Bot registration plus a Teams app manifest that IT/your
  manager approves. Add a `run_teams.py` adapter using the Bot Framework / Teams SDK that calls
  `agent.ask(text, user, channel)` like `run_discord.py` does. Nothing else changes.

## Connecting the real Accentis ERP

Find out from your Accentis admin/partner which of these is available, best first:

1. **A read-only SQL Server login** (Accentis runs on SQL Server). Ideally on a few views made for this.
   `pip install pyodbc`, install *Microsoft ODBC Driver 18 for SQL Server*, copy
   `accentis_queries.example.toml` → `accentis_queries.toml`, and replace the **placeholder** table names with
   the real ones (test each query in SSMS first). Then set `ERP_BACKEND=accentis_sql` and `ACCENTIS_ODBC`.
2. **An official API**, if your licence has one: write a small backend implementing the 6 methods in
   `coworker/erp/base.py`.
3. **Scheduled CSV exports** of items / stock / BOM / stock issues into a folder, with `ERP_CSV_DIR` pointing at it.
   Not live, but needs no IT work at all. Match the columns in `sample_data/`.

The worker can **never write** to the ERP. Every backend only reads, and the SQL connection opens read-only.
Keep it that way.

## Where to run it

For the PoC, your PC is fine while it's on. For the team, use a small always-on machine or VM inside the
network that can reach the Accentis SQL server. Memory is one SQLite file (`coworker_memory.sqlite3`),
so back it up.

## Layout

| File | What |
|---|---|
| `coworker/agent.py` | LLM tool-calling loop, system prompt, per-channel history |
| `coworker/tools.py` | Tool definitions the LLM sees + the code they run |
| `coworker/planning.py` | Multi-level BOM explosion, "can I build", max buildable |
| `coworker/insights.py` | Stock-risk check + morning digest |
| `coworker/memory.py` | Notes, production issues, actions (SQLite) |
| `coworker/erp/` | ERP interface, CSV backend, Accentis SQL backend |
| `run_cli.py` / `run_discord.py` / `run_digest.py` | Terminal, Discord, scheduled digest |
