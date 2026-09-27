#!/usr/bin/env bash
# Mac/Linux launcher: downloads a private Node.js the first time, then opens the control panel.
set -euo pipefail
cd "$(dirname "$0")"
NODE_DIR="data/runtime/node"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "First run: downloading a private copy of Node.js..."
  case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; *) arch=x64 ;; esac
  base="https://nodejs.org/dist/latest-v22.x/"
  file=$(curl -fsSL "${base}SHASUMS256.txt" | awk '{print $2}' | grep -E "^node-v.*-${os}-${arch}\.tar\.gz$" | head -1)
  mkdir -p data/runtime
  curl -fL "${base}${file}" | tar -xz -C data/runtime
  mv "data/runtime/${file%.tar.gz}" "$NODE_DIR"
fi
exec "$NODE_DIR/bin/node" app/launcher.js
