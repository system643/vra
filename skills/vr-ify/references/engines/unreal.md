# Unreal Engine 4 / 5

**Signatures** : `<Projet>/Binaries/Win64/<Projet>-Win64-Shipping.exe` (Steam) ou `-WinGDK-Shipping.exe` (Game Pass),
`<Projet>/Content/Paks/*.pak` (+ `.utoc/.ucas` = IoStore, UE 4.26+/5), `Engine/Binaries/ThirdParty/`.
Version : chaîne `++UE5+Release-5.x` dans l'exe (observé) ou FileVersion (déduit).

**Plafond par défaut : 3.** Escalier :

| Palier | Outil | Code ? |
| --- | --- | --- |
| 2 | UEVR — stable pour UE 4.8–5.4, **nightly** pour UE 5.5+ (`install_tool_plan uevr` / `uevr-nightly`) | non |
| 3 | UObjectHook (menu UEVR) : attacher arme/lampe à la main | non |
| 3 | Scripts Lua UEVR (`scaffold_uevr_profile`) : visée, gestes, UI, cinématiques | oui |
| 4 | Seulement avec un SDK de mod officiel du jeu | oui |

**Mise en route UEVR**
1. Jeu lancé (fenêtré ou plein écran fenêtré). 2. `UEVRInjector.exe` → choisir le processus → runtime OpenXR (VDXR) ou
OpenVR (SteamVR) → *Inject*. 3. Menu en jeu : **Insert** ou **L3+R3**.
Profil : `%APPDATA%\UnrealVRMod\<nom de l'exe>\` (scripts dans `scripts\`, données Lua `fs.write` dans `data\`).
Game Pass : le dossier du profil porte le suffixe `WinGDK`.

**Modes de rendu** : *Native Stereo* (meilleur, garde TAA ; peut planter) → *Synchronized Sequential* (repli recommandé)
→ *AFR* (dernier recours : désynchronisation des yeux, nausée ; jamais en réglage final).

**Pièges**
- Jeu DX12 instable → essayer l'option de lancement `-dx11` si le jeu la propose.
- UObjectHook est **désactivé par défaut** dans un profil partagé : cocher « Enabled at Startup » avant `export_share_package`.
- UE 5.5/5.6 : seules les builds nightly fonctionnent ; dater la build utilisée (`web_fact_record kind=nightly_build`).
- Anti-cheat EasyAntiCheat fréquent sur les jeux UE en ligne → garde-fou.

**Cartographie** : `map_game` lit les modules `/Script/` et les noms de classes C++ de l'exe ; les Blueprints (souvent l'arme,
le HUD, le vrai joueur) sont dans les `.pak` → dump avec RE-UE4SS (`install_tool_plan ue4ss`) ou Dumper-7, ou exploration
dans le menu UEVR. Classes utiles : sous-classes de `PlayerCameraManager`, `Pawn`/`Character`, maillage de l'arme, widgets UMG.

**Logs** : `%LOCALAPPDATA%\<Projet>\Saved\Logs\*.log`, `%APPDATA%\UnrealVRMod\<exe>\log.txt` (UEVR, à côté de
`config.txt`), `UE4SS.log`.

**Lab sans casque (pont à chaud)** : `scaffold_uevr_profile` ajoute `scripts/vra_lab.lua` (réglages `set_mod_value`, cvars `exec`, rotation, visée, recentrage ; télémétrie poses, position de vue + `world_to_meters`, FPS, boutons). Injection automatique par `lab_launch` (`UEVRInjector.exe --attach`). Voir [../lab.md](../lab.md).
