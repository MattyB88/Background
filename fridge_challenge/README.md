# 🧊 Fridge Challenge

A family buzzer game for a Raspberry Pi 4B with a screen on the fridge.

At random times during the day the screen goes off: **"⚡ CHALLENGE TIME ⚡ — SAM: Do 15 star jumps!"**
A countdown starts. Sam does the challenge and **smashes the buzzer** before time runs out → points on
the weekly leaderboard. If nobody hits the buzzer in time → **everyone** gets a punishment chore
(unload the dishwasher together, 5-minute tidy blitz, family walk…).

```
idle (clock + leaderboard) ──random time──▶ announce (8s get-ready) ──▶ active (countdown)
        ▲                                                                 │         │
        └──────── result screen (20s) ◀── success (buzzer pressed) ◀──────┘         │
                                     ◀── fail (time out → chore for everyone) ◀─────┘
```

## Features

- **Random surprise times** inside after-school / weekend windows, with a minimum gap between them.
- **Age-aware challenges** (`min_age` / `max_age`, or `only: ["Dad"]`), `{name}` placeholders, no quick repeats.
- **Fair picking**: the same person is rarely picked twice in a row.
- **Physical buzzer** on GPIO, plus an optional LED that flashes during the countdown. Pressing during the
  "get ready" phase doesn't count, so no cheating.
- **Sounds**: alarm, ticking for the last 10 seconds, fanfare, sad trombone.
- **Weekly leaderboard** and "chores owed" counter on the idle screen.
- **Admin page** (phone friendly): start a challenge now, pick who, cancel, pause for holidays/sick days,
  re-roll today's times, tick off chores when done, see history.
- **Webhook to ourorganiser.com** so missed challenges can land on the family chore roster automatically.

## Hardware

| Part | Notes |
|---|---|
| Raspberry Pi 4B + screen | Any HDMI / DSI screen; the layout scales from 800×480 up. |
| Big arcade / buzzer button | Momentary push button. |
| (Optional) LED | Built into many arcade buttons, or a separate LED + 330 Ω resistor. |
| Speaker | Screen speakers, HDMI audio, or a small USB / 3.5 mm speaker for the sounds. |

Wiring (BCM numbering, matches `config.example.json`):

```
Button:  GPIO17 (physical pin 11) ──┤ button ├── GND (pin 9)     # internal pull-up, no resistor needed
LED:     GPIO27 (physical pin 13) ── 330Ω ── LED(+)  LED(−) ── GND (pin 14)
```

> Arcade buttons with **12 V** LEDs won't light from a GPIO pin. Get a 5 V LED version and drive it
> through an NPN transistor, or use a separate small LED.

## Install on the Pi

Raspberry Pi OS (Bookworm, desktop) with auto-login to the desktop enabled.

```bash
git clone https://github.com/MattyB88/Background.git
cd Background/fridge_challenge
bash deploy/install.sh
nano config.json        # family names/ages, challenges, punishments, times
sudo systemctl restart fridge-challenge
sudo reboot             # kiosk browser opens full screen on login
```

`install.sh` creates a virtualenv, copies `config.example.json` → `config.json` with a random
**admin token** (printed at the end), installs a systemd service for the game, and adds a desktop
autostart entry that opens Chromium in kiosk mode on `http://localhost:8080/`.

```bash
journalctl -u fridge-challenge -f          # live logs
sudo systemctl restart fridge-challenge    # after editing config.json
```

## Configuration (`config.json`)

| Key | Meaning |
|---|---|
| `family` | `[{ "name": "Sam", "age": 11 }, …]` |
| `schedule.events_per_day` | How many surprise challenges per day (on average). |
| `schedule.min_gap_minutes` | Minimum time between challenges. |
| `schedule.weekday` / `weekend` | `{ "start": "16:30", "end": "19:30" }`: when challenges may happen. Remove one to switch those days off. |
| `timing.announce_seconds` | "Get ready" countdown before the clock starts. |
| `timing.result_seconds` | How long the win/lose screen stays up. |
| `hardware.button_pin` / `led_pin` | BCM pin numbers. Set `led_pin` to `null` if there's no LED. |
| `display.allow_screen_press` | `true` shows an on-screen BUZZ button (touchscreen, no physical button yet). |
| `admin_token` | Required for the admin page and admin API. |
| `webhook.url` / `token` | Optional: POST each result to ourorganiser.com (see below). |
| `challenges` | `{ "text", "seconds", "points", "min_age"?, "max_age"?, "only"? }`; `text` may use `{name}`. |
| `punishments` | Chores given to *everyone* when a challenge is missed. |

## Admin page & ourorganiser.com

On the home network: `http://<pi-ip>:8080/admin?token=<admin_token>` (the token is remembered on
that phone after the first visit).

To reach it from anywhere through the Cloudflare tunnel already running on the spare PC, add an
ingress rule pointing at the Pi (see [`deploy/cloudflared-ingress.example.yml`](deploy/cloudflared-ingress.example.yml)),
e.g. `https://fridge.ourorganiser.com/admin`. **Put that hostname behind Cloudflare Access**
(allow only the family's email addresses) as well as keeping the admin token set. You can then link
to it from the family login on ourorganiser.com.

### Webhook payload

If `webhook.url` is set, every result is POSTed as JSON (with `Authorization: Bearer <token>` if
`webhook.token` is set), so ourorganiser.com can add the chore to the roster:

```json
{
  "type": "challenge_result",
  "event_id": 42,
  "member": "Sam",
  "challenge": "Do 15 star jumps",
  "success": false,
  "reaction_seconds": 60.0,
  "points": 0,
  "punishment": "Everyone unloads the dishwasher together",
  "assigned_to": ["Dad", "Mum", "Sam", "Ella"],
  "timestamp": "2026-10-15T17:42:10"
}
```

## API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/` | none | Fridge display |
| GET | `/admin` | token in page | Admin page |
| GET | `/api/state` | none | Current game state (the display polls this) |
| POST | `/api/press` | admin, or `allow_screen_press` | Press the buzzer |
| GET | `/api/admin/summary` | admin | State, today's plan, history, chores owed |
| POST | `/api/admin/trigger` | admin | `{ "member": "Sam" }` (optional): start now |
| POST | `/api/admin/cancel` | admin | Abort the current challenge (nothing recorded) |
| POST | `/api/admin/pause` | admin | `{ "paused": true }` |
| POST | `/api/admin/replan` | admin | Re-roll the rest of today's times |
| POST | `/api/admin/punishments/<id>/done` | admin | Mark a chore as done |

Admin auth is the `X-Admin-Token` header or a `?token=` query parameter.

## Develop / test without a Pi

```bash
cd fridge_challenge
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest
cp config.example.json config.json
python app.py --no-gpio                 # http://localhost:8080  and  /admin?token=...
python -m pytest tests
```

With `--no-gpio`, use the admin page's **Press buzzer** button (or set `allow_screen_press` and
press Space on the display).
