#!/usr/bin/env bash
# One-time setup on the Raspberry Pi. Run from inside the fridge_challenge folder:
#   bash deploy/install.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"

echo "==> Installing system packages"
sudo apt-get update
sudo apt-get install -y python3-venv python3-gpiozero python3-lgpio curl

echo "==> Creating virtualenv (with system gpiozero)"
python3 -m venv --system-site-packages "$DIR/.venv"
"$DIR/.venv/bin/pip" install -r "$DIR/requirements.txt"

if [ ! -f "$DIR/config.json" ]; then
  cp "$DIR/config.example.json" "$DIR/config.json"
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')"
  sed -i "s/change-me-to-something-long/$TOKEN/" "$DIR/config.json"
  echo "==> Created config.json - edit family/challenges there. Admin token: $TOKEN"
fi

echo "==> Installing systemd service"
sed -e "s#__USER__#$USER_NAME#g" -e "s#__DIR__#$DIR#g" "$DIR/deploy/fridge-challenge.service" \
  | sudo tee /etc/systemd/system/fridge-challenge.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now fridge-challenge

echo "==> Installing kiosk autostart"
chmod +x "$DIR/deploy/kiosk.sh"
mkdir -p "$HOME/.config/autostart"
sed -e "s#__DIR__#$DIR#g" "$DIR/deploy/fridge-kiosk.desktop" > "$HOME/.config/autostart/fridge-kiosk.desktop"

echo
echo "Done! Reboot to start the kiosk, or test now: $DIR/deploy/kiosk.sh"
echo "Admin page: http://$(hostname -I | awk '{print $1}'):8080/admin?token=<admin_token from config.json>"
