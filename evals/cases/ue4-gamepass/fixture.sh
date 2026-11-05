#!/usr/bin/env bash
set -euo pipefail
mkdir -p game
mkdir -p 'game/Game/Binaries/WinGDK'
printf '\x4d\x5a\x20\x2b\x2b\x55\x45\x34\x2b\x52\x65\x6c\x65\x61\x73\x65\x2d\x34\x2e\x32\x37' > 'game/Game/Binaries/WinGDK/Game-WinGDK-Shipping.exe'
mkdir -p 'game/Game/Content/Paks'
: > 'game/Game/Content/Paks/Game-WinGDK.pak'
mkdir -p 'game'
printf '\x3c\x47\x61\x6d\x65\x2f\x3e' > 'game/MicrosoftGame.config'
