"""Chat with the worker in a terminal - the quickest demo, no chat platform needed.

    python run_cli.py            # you are "Me"
    python run_cli.py --as Sam   # pretend to be someone else (it's a group chat after all)
"""
import argparse

from coworker.agent import build_agent

p = argparse.ArgumentParser()
p.add_argument("--as", dest="user", default="Me")
args = p.parse_args()

agent = build_agent()
print(f"Chatting with {agent.name}. Ctrl+C to quit. Try: how many CCA53 on hand?")
user = args.user
while True:
    try:
        text = input(f"\n{user}> ").strip()
    except (EOFError, KeyboardInterrupt):
        break
    if text.startswith("/as "):
        user = text[4:].strip() or user
        continue
    if text:
        print(f"\n{agent.name}> {agent.ask(text, user=user, channel='cli')}")
