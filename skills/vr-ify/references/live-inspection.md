# Inspection en direct

Uniquement en solo, hors ligne, sans anti-cheat, avec l'accord explicite de l'utilisateur. D'abord l'inspecteur du moteur :

| Moteur | Inspecteur | Permet |
| --- | --- | --- |
| Unreal 4/5 | Menu UEVR (Insert / L3+R3), UObjectHook, console Lua ; Live View de RE-UE4SS | objets, attaches aux mains, valeurs en direct |
| Unity | UnityExplorer via BepInEx (F7) | scène, composants, caméras, canvas, console C# |
| RE Engine | Object Explorer, Game Objects Display | types, champs, méthodes, hooks |
| Source 1 | Console développeur (`-dev -console`) | cvars de vue, FOV, HUD |
| Creation | Console en jeu | positions, échelle, états |
| Godot, propriétaire, maison | aucun en version exportée | Frida si le jeu en vaut la peine |

## Frida en dernier recours (`live_inspect`, famille `inspect`)

Règles reprises de REA :
- Le jeu est lancé **en pause**, le script chargé, puis seulement le jeu reprend.
- Script enregistré par chemin + SHA-256 ; capture bornée (≤ 120 s, ≤ 2000 messages, ≤ 4 Mo).
- Avant de reprendre un processus en pause, l'instrumentation est déchargée ; si le nettoyage échoue, le jeu reste en
  pause et l'erreur est conservée.
- VRA ne **tue jamais** le processus du jeu.
- Le résultat devient une preuve dans la fiche, avec ses limites (« observé dans tel niveau, pas ailleurs »).

Frida est une dépendance optionnelle : `npm install frida` dans `server/` si l'utilisateur l'accepte. Activer la famille
avec `enable_tool_family inspect`.
