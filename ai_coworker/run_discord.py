"""Discord adapter: the worker joins your server and answers when @mentioned (or DM'd).
Also posts the morning digest to DISCORD_DIGEST_CHANNEL_ID at DIGEST_TIME each weekday.

Setup: see README "Discord" section (needs the Message Content intent enabled).
"""
import asyncio
import datetime as dt

import discord
from discord.ext import tasks

from coworker.agent import build_agent
from coworker.config import settings
from coworker.insights import daily_digest

agent = build_agent()
intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

hh, mm = map(int, settings.digest_time.split(":"))
DIGEST_AT = dt.time(hour=hh, minute=mm, tzinfo=dt.datetime.now().astimezone().tzinfo)


def chunks(text: str, size: int = 1900):
    while text:
        cut = text.rfind("\n", 0, size) if len(text) > size else len(text)
        cut = cut if cut > 0 else size
        yield text[:cut]
        text = text[cut:].lstrip("\n")


@client.event
async def on_ready():
    print(f"Logged in as {client.user}. Invite it to a channel and @mention it.")
    if settings.discord_digest_channel_id and not morning_digest.is_running():
        morning_digest.start()


@client.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    is_dm = isinstance(message.channel, discord.DMChannel)
    if not (is_dm or client.user in message.mentions):
        return
    text = message.content.replace(f"<@{client.user.id}>", "").replace(f"<@!{client.user.id}>", "").strip()
    # Long pasted meeting notes often arrive as a .txt attachment
    for a in message.attachments:
        if a.filename.endswith((".txt", ".md")) and a.size < 200_000:
            text += f"\n\n[Attached {a.filename}]\n" + (await a.read()).decode("utf-8", "replace")
    if not text:
        return
    async with message.channel.typing():
        reply = await asyncio.to_thread(
            agent.ask, text, user=message.author.display_name, channel=str(message.channel.id)
        )
    for part in chunks(reply or "(no reply)"):
        await message.reply(part, mention_author=False)


@tasks.loop(time=DIGEST_AT)
async def morning_digest():
    if dt.date.today().weekday() >= 5:
        return
    channel = client.get_channel(int(settings.discord_digest_channel_id))
    if channel:
        text = await asyncio.to_thread(daily_digest, agent.toolbox.erp, agent.toolbox.mem)
        for part in chunks(text):
            await channel.send(part)


if not settings.discord_token:
    raise SystemExit("Set DISCORD_TOKEN in ai_coworker/.env")
client.run(settings.discord_token)
