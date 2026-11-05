# RE Engine (Capcom)

**Signatures** : `re_chunk_000.pak`. Identité par l'exe : `re2`, `re3`, `re4`, `re7`, `re8` (Village), `DevilMayCry5`,
`MonsterHunterRise`, `StreetFighter6`…

**Plafond : 3.**

| Palier | Outil | Code ? |
| --- | --- | --- |
| 2 | REFramework, mode VR 6DOF générique (`install_tool_plan reframework`, archive du jeu concerné) | non |
| 3 | Contrôles par mouvements **intégrés** pour RE2, RE3, RE7, RE8 | non |
| 3 | Autres jeux : scripts Lua REFramework (`scaffold_reframework_script`) | oui |

**Installation** : hors VR, seul `dinput8.dll` suffit ; **pour la VR, extraire l'archive complète** dans le dossier de l'exe.
Runtime : OpenXR (VDXR) ou SteamVR. Menu REFramework : touche **Insert**.

**Cartographie / inspection** : mode développeur → *Object Explorer* et *Game Objects Display* (types, champs, méthodes, hooks).

**Pièges** : une mise à jour du jeu casse souvent REFramework → vérifier la release la plus récente avant d'installer
(`web_fact_record kind=mod_compatibility`). Les mods R.E.A.L. de Luke Ross existent aussi pour certains jeux RE : 6DOF sans
contrôleurs → REFramework passe devant quand il offre les contrôleurs.

**Logs** : `re2_framework_log.txt` à côté de l'exe (même nom pour tous les jeux ; l'ancien devient `re2_framework_log.prev.txt`).
Si le dossier du jeu n'est pas inscriptible : `%APPDATA%\REFramework\<exe>\`.

**Lab sans casque (pont à chaud)** : `scaffold_reframework_script` ajoute `reframework/autorun/vra_lab.lua` (télémétrie caméra via `sdk.get_primary_camera`, FPS ; fichiers dans `reframework/data`). Vérifier l'API `json` de la version REFramework installée. Voir [../lab.md](../lab.md).
