# Source (1)

**Signatures** : `gameinfo.txt`, `bin/engine.dll` ou `bin/vphysics.dll`, archives `*.vpk`.

**Plafond envisagé : 4**, conditionné.

| Palier | Outil | Condition |
| --- | --- | --- |
| 3 | Mod VR communautaire existant | à rechercher en premier (`vr-scout`) |
| 4 | Mod compilé avec le Source SDK 2013 | uniquement pour les jeux basés sur le SDK public (HL2 et dérivés) |
| 1 | geo-11 | si DX11 (rare : Source 1 est souvent DX9) |

**Méthode** : `map_game` lit `gameinfo.txt` (nom du jeu, AppID) et repère des dossiers de mods VR déjà présents.
Installer un mod dans un **dossier séparé** (sourcemods ou dossier dédié), jamais en écrasant le jeu.

**Pièges** : jeux multijoueur protégés par VAC côté serveur (aucun fichier ne le prouve) → pas de mod en ligne.
Console développeur : options `-dev -console`, log avec `-condebug` → `console.log`.
