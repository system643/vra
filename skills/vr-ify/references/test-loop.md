# Boucle de test augmentée

> Avant de mettre le casque : faire tourner le **VRA Lab** ([lab.md](lab.md)) pour trouver les réglages et vérifier
> stéréo, 6DOF, échelle, contrôles et HUD sans casque. Cette boucle-ci sert ensuite à la **confirmation** en casque.

En casque, l'utilisateur ne peut ni taper ni montrer l'écran. Trois mécanismes donnent quand même des preuves.

## 1. Marqueurs pendant le jeu
- **Externe, tous les jeux** : `start_marker` lance un petit programme ; **Ctrl+Alt+M** au clavier ou **LB+RB+A** maintenus
  ~1 s sur une manette XInput. Bip de confirmation (audible dans le casque via Virtual Desktop).
- **Interne, Unreal** : le script UEVR généré écrit `vra_marker_*.json` via `fs.write` (LB+RB+A, y compris contrôleurs
  mappés en XInput par UEVR).
- À chaque marqueur : horodatage, capture, fin de chaque log connu. Après la session : `collect_evidence`, analyser chaque
  marqueur, proposer un correctif par problème, `mark_marker_analyzed`.

## 2. Vision sur la fenêtre miroir
`capture_screen` / `launch_and_capture` (paramètre `window_title` pour viser le miroir Virtual Desktop ou SteamVR). Lire
l'image pour repérer HUD mal placé, image doublée, œil noir, image étirée. Le miroir ne montre souvent qu'un œil recadré :
conclusions **déduites** jusqu'à confirmation en casque.

## 3. Logs à lire (`collect_evidence`)

| Source | Emplacement habituel |
| --- | --- |
| Unity | `%USERPROFILE%\AppData\LocalLow\<éditeur>\<jeu>\Player.log` |
| Unreal | `%LOCALAPPDATA%\<Projet>\Saved\Logs\` |
| Source 1 | `console.log` avec `-condebug` |
| Godot | `%APPDATA%\Godot\app_userdata\<projet>\logs\` |
| BepInEx | `BepInEx\LogOutput.log` |
| UEVR | `%APPDATA%\UnrealVRMod\<exe>\log.txt` (à côté de `config.txt`) |
| REFramework | `re2_framework_log.txt` à côté de l'exe (même nom pour tous les jeux), sinon `%APPDATA%\REFramework\<exe>\` |
| UE4SS | `UE4SS.log` |
| SteamVR | `Steam\logs\vrserver.txt`, `vrcompositor.txt` |
| Windows | `%LOCALAPPDATA%\CrashDumps` (si activé), Observateur d'événements |

## Règles de diagnostic
- Une hypothèse à la fois, journalisée (`session_log kind=setting|result`) ; ne jamais retenter un réglage échoué.
- Performance : overlay de performances Virtual Desktop ; baisser résolution et effets avant de parler de « bug ».
