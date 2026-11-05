# Installation contrôlée et empreinte de chaque outil

Règles (comme `rea setup`) :
1. **Plan affiché** — `install_tool_plan` télécharge dans le cache VRA (jamais dans le jeu), vérifie l'empreinte publiée
   par GitHub quand elle existe, liste exactement les fichiers ajoutés et remplacés.
2. **Accord explicite** — `install_tool_apply confirm=true` seulement après le « oui » de l'utilisateur.
3. **Sauvegarde** de chaque fichier remplacé ; les fichiers ajoutés sont notés pour être supprimés à la restauration.
4. **Ajout seulement, rejouable** — relancer ne casse rien.
5. **Rien d'autre** — aucun logiciel non lié installé ; VRA ne lance jamais d'installeur exécutable.
6. **Restauration** — `restore_game` (simulation, puis `confirm=true`) ; en dernier recours « Vérifier l'intégrité des fichiers ».

| Outil (id catalogue) | Ce qu'il ajoute ou modifie | Annuler |
| --- | --- | --- |
| Virtual Desktop (niveau 0) | Rien dans le jeu | — |
| geo-11 (`geo-11`, archive locale) | DLL proxy `d3d11.dll` + configuration à côté de l'exe | `restore_game` |
| UEVR (`uevr`, `uevr-nightly`) | Rien dans le jeu (injection au lancement) ; profil `%APPDATA%\UnrealVRMod\<exe>` | supprimer le dossier du profil |
| UUVR (`rai-pal`) | Fichiers installés et suivis par Rai Pal | désinstaller depuis Rai Pal |
| BepInEx (`bepinex5`, `bepinex6-mono`, `bepinex6-il2cpp`) | `winhttp.dll`, `doorstop_config.ini`, dossier `BepInEx/` | `restore_game` |
| UnityVRMod, UnityExplorer | fichiers dans `BepInEx/` | `restore_game` |
| REFramework (`reframework`) | `dinput8.dll` (+ fichiers VR), `reframework/` | `restore_game` |
| RE-UE4SS (`ue4ss`) | fichiers à côté de l'exe Unreal | `restore_game` |
| Mods Source 1 | dossier de mod séparé | supprimer le dossier |
| Mods Creation Engine | gestionnaire à système de fichiers virtuel (Mod Organizer 2) | désactiver le profil |
| Godot modifié | nouvel exe / `.pck` à côté de l'original | supprimer la copie |
| Source ports (`quakevr`) | dossier séparé dans VRA tools | supprimer le dossier |
| Vivecraft | profil dans le lanceur Minecraft | supprimer le profil |
| Frida | rien dans le jeu | fermer la session |

Les chemins exacts se revérifient dans la documentation de l'outil à chaque installation (`web_fact_record kind=install_paths`).
Game Pass (`WindowsApps`) : écriture souvent refusée ; certains jeux proposent « Activer les mods » dans l'app Xbox.
