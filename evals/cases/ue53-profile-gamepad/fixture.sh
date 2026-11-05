#!/usr/bin/env bash
set -euo pipefail
mkdir -p game
mkdir -p 'game/Game/Binaries/Win64'
printf '\x4d\x5a\x20\x66\x61\x6b\x65\x20\x2b\x2b\x55\x45\x35\x2b\x52\x65\x6c\x65\x61\x73\x65\x2d\x35\x2e\x33\x20\x62\x75\x69\x6c\x64' > 'game/Game/Binaries/Win64/Game-Win64-Shipping.exe'
mkdir -p 'game/Game/Binaries/Win64'
: > 'game/Game/Binaries/Win64/steam_api64.dll'
mkdir -p 'game/Game/Content/Paks'
: > 'game/Game/Content/Paks/Game-Windows.pak'
mkdir -p 'game/Engine/Binaries/ThirdParty/Ogg/Win64'
: > 'game/Engine/Binaries/ThirdParty/Ogg/Win64/libogg.dll'
