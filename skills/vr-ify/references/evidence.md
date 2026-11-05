# Fiche de jeu avec preuves

Chaque champ porte un statut — **observé** (`observed`), **déduit** (`deduced`), **inconnu** (`unknown`) — et ses preuves.
Règle de REA : un inconnu reste inconnu, jamais traité comme « absent » ni « compatible ».

| Champ | Ce qu'on cherche | Exemples de preuves |
| --- | --- | --- |
| `engine_family`, `engine`, `version` | Famille + version exacte | `++UE5+Release-5.3` dans l'exe ; `globalgamemanagers` Unity ; `re_chunk_000.pak` ; `gameinfo.gi` ; en-tête `.pck` |
| `runtime_variant` | Mono/IL2CPP, Win64/WinGDK, GDScript/C# | `Managed/` vs `GameAssembly.dll` ; suffixe d'exe ; `GodotSharp.dll` |
| `architecture` | x64, x86 | en-tête PE |
| `graphics_apis` | DX9/11/12, Vulkan, OpenGL | imports PE (une absence ne prouve rien) |
| `anticheat` | présence, type | dossiers `EasyAntiCheat/`, `BEService.exe`, règles SteamDB ; « aucun fichier » = **déduit**, à confirmer en ligne |
| `storefront` | Steam, Epic, GOG, Game Pass | `steam_api64.dll`, `.egstore`, `goggame-*.info`, `WindowsApps` |
| `exe_sha256` | build exacte | SHA-256 de l'exe principal |
| `native_vr` | mode VR officiel possible | `openvr_api.dll`, `openxr_loader.dll` |
| `existing_vr_mods` | nom, niveau réel, version compatible | lien + date (`web_fact_record`) |
| `camera` | 1re/3e personne, vue du dessus | capture, classe caméra cartographiée |
| `cutscenes`, `menus` | vidéo ou temps réel, 2D ou 3D | `.bk2`, `.usm`, `.mp4`, observation |
| `debug_tools` | console Unreal/Source, mode photo | `.ini`, options de lancement |
| `ceiling`, `target` | niveau 0–4 | `plan_target`, avec la chaîne de raisonnement |
| `unknowns` | ce qui n'est pas établi | chaque inconnu + l'expérience qui le lèverait |

Écrire un champ : `game_card_write` (un champ `observed` sans preuve est refusé). Toute décision cite les champs dont elle
dépend (`decision.depends_on`) : si un champ change après une mise à jour, VRA sait quelles décisions revérifier.
Fichiers : `<VRA_HOME>/profiles/<jeu>/fiche.json` (outils) et `fiche.md` (lecture).
