# ⛏️🤖 Minecraft AI Buddies

A one-click family Minecraft server where AI friends
([Mindcraft](https://github.com/mindcraft-bots/mindcraft) by Emergent Garden) play alongside you.
They follow you, fight mobs, gather stuff, build, and remember you between games.

## Start (Windows)
1. Download this folder (GitHub → **Code → Download ZIP**, then unzip it somewhere like `Documents`).
2. Double-click **`Start Minecraft AI.bat`**.
3. Your browser opens the control panel and a setup wizard walks you through it:
   your Minecraft names → paste an AI key (with a **Test** button) → name your first AI friend → pick a world.
4. Press **Let's play**. The first start downloads Java, the Minecraft server, mods and Mindcraft (5-10 min).
   If Windows asks about the firewall, click **Allow**.
5. In Minecraft Java **1.21.1**: Multiplayer → Add Server → the address shown in the panel (`localhost` on the same PC).

After that it's just the double-click: the world and your AI friends start by themselves.
Close the black window to save and shut everything down.

Mac/Linux: run `./start.sh`. Nothing needs installing beforehand; the app downloads its own Node.js and Java into `data/`.

## What's in the panel
- **AI Friends**: make as many as you like. Pick a personality (Helpful Buddy, Brave Knight, Master Builder, Happy Farmer,
  Explorer, Wise Wizard, Funny Joker) or write your own. Choose the AI company and model per friend, how fast it thinks,
  and what it does (fight, hunt, pick up items, place torches…). Changes apply straight away, even mid-game.
- **Worlds**
  - 🤖 **Buddy World**: survival world the AI friends can join (Fabric server with speed-up mods).
  - ✨ **Magic World**: your son's CurseForge "magic" modpack (NeoForge 21.1.252 + Ars Nouveau, Curios, GeckoLib, Jade, JEI),
    same versions as his CurseForge profile. **AI friends can't join this one**: Mindcraft bots can't connect to
    NeoForge servers that add new blocks and items.
- **AI Keys**: Anthropic, OpenAI, Google Gemini (has a free tier), xAI, DeepSeek, Mistral, Groq, OpenRouter, or Ollama (free, local, needs a good GPU).
- **Quick magic** buttons while playing: make it day, clear weather, heal/feed everyone, teleport the AI friends to you.
- **Logs** and a server command box.

## Joining Buddy World with the CurseForge "magic" profile
JEI, Jade, Just Zoom and Durability Tooltip work on Buddy World. If Minecraft refuses to connect because of the magic mods,
switch **Ars Nouveau**, **Curios API** and **GeckoLib** off in CurseForge (the orange toggles) or make a copy of the profile
without them. Plain, unmodded Minecraft 1.21.1 always works.

## Safety
- The server accepts offline logins because the AI players don't have Microsoft accounts. **Family only** (on by default)
  limits it to your names plus the AI friends. Keep it on your home network and don't port-forward it. To play with friends
  elsewhere, use a private VPN like Tailscale.
- API keys are stored only on this computer in `data/config.json`. The panel only accepts connections from this computer.
- The AI can only use Mindcraft's built-in game commands. It can't write or run code on your PC.

## Files
- `data/servers/buddy/world`, `data/servers/magic/world`: your worlds. Copy them to back up.
- `data/mindcraft/bots/<name>`: each AI friend's memories.
- Extra mods: Worlds tab → **Open mods folder**, drop in `.jar` files, then press Stop and Play.
