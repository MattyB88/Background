"""Scheduled analysis: build the morning digest and post it. Run from cron / Windows Task Scheduler:

    30 7 * * 1-5  cd /path/to/ai_coworker && python run_digest.py

Posts to whichever of these are set: TEAMS_WEBHOOK_URL (a Teams 'Workflows' webhook into a channel),
DISCORD_WEBHOOK_URL. Always prints to stdout too. No LLM needed - this is plain maths over ERP data.
"""
import json
import urllib.request

from coworker.config import settings
from coworker.erp import get_backend
from coworker.insights import daily_digest
from coworker.memory import Memory


def post_json(url: str, payload: dict):
    req = urllib.request.Request(url, json.dumps(payload).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def teams_payload(text: str) -> dict:
    # Adaptive Card wrapper accepted by the Teams Workflows "When a Teams webhook request is received" trigger.
    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": [{"type": "TextBlock", "text": text.replace("\n", "\n\n"), "wrap": True}],
            },
        }],
    }


if __name__ == "__main__":
    text = daily_digest(get_backend(settings), Memory(settings.memory_db))
    print(text)
    if settings.teams_webhook_url:
        print("Teams:", post_json(settings.teams_webhook_url, teams_payload(text)))
    if settings.discord_webhook_url:
        print("Discord:", post_json(settings.discord_webhook_url, {"content": text[:1990]}))
