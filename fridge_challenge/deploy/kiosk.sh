#!/usr/bin/env bash
# Opens the fridge display full screen. Started at desktop login via
# ~/.config/autostart/fridge-kiosk.desktop (installed by install.sh).
set -u
URL="${1:-http://localhost:8080/}"

# Wait for the game server to come up.
for _ in $(seq 1 60); do
  curl -fs "${URL%/}/healthz" >/dev/null && break
  sleep 2
done

BROWSER=$(command -v chromium-browser || command -v chromium)
exec "$BROWSER" \
  --kiosk --noerrdialogs --disable-infobars --incognito \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  "$URL"
