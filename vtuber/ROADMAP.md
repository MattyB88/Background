# AI VTuber — Roadmap

A fully autonomous anime VTuber who lives in a small 3D room in the corner of the
stream and reacts live to whatever content is playing (Pokémon AI videos first).
Vibe: loud, opinionated, reactive gamer streamer. Original character.

## The rules

1. **One stage at a time.** We don't start the next stage until the current one passes
   its "Done when" check, run by you on your machine.
2. **New ideas go in the Parking Lot**, not into the current stage. Ideas are welcome.
   They wait their turn.
3. **Free first.** Free tools while proving things work, then a cheap paid tier, then
   a normal paid tier, and only when free is the actual bottleneck.
4. **Smallest version that proves the point.** Polish comes after it works end to end.

## Stages

| # | Stage | Done when | Status |
|---|-------|-----------|--------|
| 1 | **Room + placeholder avatar.** 3D room, simple stand-in character, actions (sit, walk, jump, angry, throw + pick up, talk bubble) triggered by buttons/keys. | You see it running in OBS as a browser source in the corner, over one of your Pokémon videos, and every button works. | **Built — awaiting your test** |
| 2 | **Real avatar.** Swap the stand-in for a VRM model made in VRoid Studio (free). Same actions, real face expressions. | Your VRoid girl does all the Stage 1 actions in OBS. | Not started |
| 3 | **Voice.** Free text-to-speech + mouth moves with audio. | Typing a line makes her say it out loud through OBS with lip movement. | Not started |
| 4 | **Brain.** Gemini (free tier) receives a text event like "Charizard fainted" and replies with `{say, emotion, action}`, which drives the avatar. | You type a fake event and she reacts in character, by herself. | Not started |
| 5 | **Content hook.** Real events from the Pokémon generator (or screenshots for non-Pokémon content) feed the brain automatically. | She reacts to a full Pokémon video with no input from you. | Not started |
| 6 | **YouTube chat.** Read live chat and occasionally respond. | She replies to a chat message during a test stream. | Not started |
| 7 | **Overnight run.** Rate limits, cost cap, crash auto-restart, logs. | An unattended stream runs for 8+ hours. | Not started |

## Stage 1 — how to test

1. From the repo folder, start a local web server (Python is all you need):
   ```bash
   python -m http.server 8000 -d vtuber
   ```
2. Open http://localhost:8000 in Chrome. Click every button: `1 sit`, `2 stand`,
   `3 walk`, `4 jump`, `5 angry`, `6 throw`, `7 wave`. Type in the box and press Enter
   to make her talk. Try different emotions. Tick **Auto demo** to watch her act alone.
3. In OBS, play one of your Pokémon videos full screen, then add a **Browser** source:
   - URL: `http://localhost:8000/?obs&demo` (transparent background, no buttons,
     auto demo running)
   - Width 960, Height 600, then shrink it into a corner.
4. Stage 1 passes when she's visible in the OBS corner over your video and every
   action looked right in step 2. Tell me anything that looked broken or wrong.

## Parking Lot (later, not now)

- Twitch support (after YouTube works)
- Paid voice (ElevenLabs) once free TTS is proven
- Paid / stronger LLM once Gemini free tier is the bottleneck
- Mixamo motion-captured animations instead of procedural ones
- Memory of past streams and regular chatters
- More room props and interactions
- PS4 camera / face tracking (only needed if you ever drive her yourself)
- Voice changer for your own voice

## What's needed from you, by stage

- Stage 1: OBS installed (you have it). Nothing else.
- Stage 2: A VRM file exported from VRoid Studio.
- Stage 4: A free Gemini API key from Google AI Studio.
- Stage 5: Answer: does the Pokémon generator write a log or events, and what
  programming language is it in?
- Stage 6: YouTube Live stream (you've done one already).
