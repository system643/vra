# Unity (Mono)

**Signatures** : `UnityPlayer.dll`, `<Jeu>_Data/Managed/Assembly-CSharp.dll`, `UnityEngine*.dll`.
Version : `globalgamemanagers` / `data.unity3d` (observé) ou FileVersion de `UnityPlayer.dll` (déduit).

**Plafond par défaut : 3** (4 envisageable si le jeu expose proprement ses objets).

| Palier | Outil | Code ? |
| --- | --- | --- |
| 2 | UUVR via Rai Pal (`install_tool_plan rai-pal`, installeur lancé par l'utilisateur) **ou** UnityVRMod (BepInEx 6, `unityvrmod`) | non |
| 3 | Plugin BepInEx + Harmony (`scaffold_unity_plugin`) : HUD en World Space, visée à la main, gestes | oui |

**Chaîne BepInEx** : Mono → BepInEx 5 (`bepinex5`) pour un plugin maison ; UnityVRMod exige BepInEx 6 (`bepinex6-mono`).
Ne pas mélanger BepInEx 5 et 6 dans le même jeu. Premier lancement : génère `BepInEx/config` et `BepInEx/LogOutput.log`.

**Cartographie** : `map_game` lit les métadonnées .NET d'`Assembly-CSharp.dll` (classes, bases, méthodes `Update/LateUpdate`),
le système d'entrées (`Unity.InputSystem.dll`, `Rewired_Core.dll`, ancien Input Manager) et le pipeline (Built-in, URP, HDRP).
Confirmer en jeu avec UnityExplorer (`install_tool_plan unityexplorer`, touche F7).

**Pièges**
- UI en *Screen Space Overlay* invisible ou plaquée → la passer en *World Space* (fait par le plugin généré).
- Post-traitements (flou, vignette, aberration) et piles de caméras URP/HDRP → à désactiver/adapter.
- `Camera.main` peut changer selon la scène : patcher la classe caméra du jeu, pas seulement `Camera.main`.

**Logs** : `%USERPROFILE%\AppData\LocalLow\<éditeur>\<jeu>\Player.log` (lus via `*_Data/app.info`), `BepInEx\LogOutput.log`.

**Lab sans casque (pont à chaud)** : le plugin généré contient la classe `VraLab` (HUD en World Space, distance du HUD, échelle du parent de caméra, `Time.timeScale` ; télémétrie caméra, scène, canvas, FPS), dossier `VRA_LAB_DIR` posé par `lab_launch`. Voir [../lab.md](../lab.md).
