#!/usr/bin/env bash
# VRA - installation en une commande (macOS / Linux / Git Bash). Les jeux VR visés sont surtout sous Windows :
# sur Windows, préférer setup.cmd (interface graphique, logiciels Meta, Steam...).
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "Node.js 22+ est requis : https://nodejs.org" >&2
  exit 1
fi
exec node setup/setup.mjs "$@"
