# Family Minecraft server with an AI buddy

A Fabric Minecraft server plus [Mindcraft](https://github.com/mindcraft-bots/mindcraft) (by Emergent Garden) running an AI
player named **Buddy** who follows you, helps, fights mobs, and sets its own goals when you're busy.

## What you need
- A PC that stays on (Windows/Mac/Linux), 8 GB+ RAM, with [Docker Desktop](https://www.docker.com/products/docker-desktop/).
- An API key for the AI (default: Anthropic — https://console.anthropic.com). Budget a few dollars per long session.
- Minecraft **Java Edition** 1.21.1 for you and your son (no client mods needed).

## Start it
```bash
cd minecraft-ai
cp .env.example .env      # paste your API key, add your usernames to MC_OPS
docker compose up -d --build
docker compose logs -f    # first start downloads the server + mods, ~2-5 min
```
In Minecraft: **Multiplayer → Add Server →** the host PC's IP (e.g. `192.168.1.20`), or `localhost` on that PC.
Buddy joins automatically. Dashboard: `http://<host-ip>:8080`.

## Talking to Buddy
Just chat normally: "Buddy, come here", "can you get us some wood?", "help me build a house", "stay here".
Buddy remembers things between sessions (saved in `bot-memory/`).

## Customize
- **Personality/model:** `profiles/buddy.json` (e.g. `claude-haiku-4-5-20251001` for cheaper, or `{"api":"openai","model":"gpt-..."}`).
  Restart with `docker compose restart mindcraft`.
- **More bots:** copy the profile, change `name`, add it to `profiles` in `docker-compose.yml`.
- **Mods:** edit `MODRINTH_PROJECTS`. Server-side mods only unless you also install them on your clients.
  Mindcraft works best near vanilla — avoid mods that add lots of new blocks.

## Safety notes
- The server runs in **offline mode** (required for the bot to log in). Keep it on your home network; do **not**
  port-forward 25565. To play with friends remotely, use a private VPN like Tailscale.
- `allow_insecure_coding` is off, so the AI can only use Mindcraft's built-in commands, not run arbitrary code.

## Stop / back up
`docker compose down` stops everything. Your world lives in `data/world` — copy that folder to back it up.
