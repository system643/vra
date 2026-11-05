# Moteurs AAA propriétaires (RAGE, REDengine, Decima, Frostbite, Anvil, Snowdrop, Dunia, Glacier…)

**Signatures** : archives et DLL propres à chaque studio ; les règles SteamDB donnent un nom de moteur (indice **déduit**).

**Plafond par défaut : 1 si DX11, sinon 0 — à réévaluer avec la recherche web.**

| Palier | Voie | Note |
| --- | --- | --- |
| 1 | geo-11 | rendu DX11 |
| 2 | Mod dédié (ex. **R.E.A.L. de Luke Ross**) | 6DOF **sans contrôleurs** (manette ou clavier-souris) → palier, pas destination |
| 3 | Écosystème de modding du jeu (extender de scripts, SDK officiel, outils communautaires) | pour ajouter visée et UI |
| 2½ | Gestes des contrôleurs vers manette virtuelle | expérimental, quand rien d'autre n'existe |

**Méthode** : `vr-scout` cherche le mod dédié, sa version de jeu compatible (souvent une build précise), et l'écosystème de
modding. Passer chaque mod trouvé en `signals.existing_mods` (avec `level` réel : R.E.A.L. = 2) à `plan_target`.
Si aucune voie ne dépasse le visuel, le dire **avec la preuve**.

**Pièges** : composants en ligne et anti-cheat fréquents ; mises à jour qui cassent les mods dédiés ; mods distribués hors
GitHub (archive locale : `install_tool_plan local_archive=…`, origine vérifiée par l'utilisateur).
