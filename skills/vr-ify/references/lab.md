# VRA Lab — tester sans casque, en boucle rapide

Objectif : que Claude essaie seul des dizaines de réglages, pilote la tête et les manettes, vérifie stéréo, 6DOF, échelle,
contrôles et HUD, puis garde la meilleure configuration. Le casque ne sert plus qu'à une **confirmation finale courte**
(confort, fréquence, échelle perçue).

## Les trois briques

| Brique | Rôle | Activation |
| --- | --- | --- |
| **Meta XR Simulator** (standalone Windows) | Casque simulé : runtime OpenXR, D3D11/D3D12/Vulkan (pas OpenGL) | `XR_RUNTIME_JSON` **par processus** : ni le registre ni Virtual Desktop ne sont touchés |
| **Meta XR Operator** (standalone) | Pilote pour l'agent : pose de tête/manettes/mains, boutons, captures — couche OpenXR + serveur MCP (SSE, port 8720) | `XR_API_LAYER_PATH` + `XR_ENABLE_API_LAYERS=XR_APILAYER_METAX_operator` |
| **Pont à chaud VRA** | Change les réglages du mod en quelques secondes sans relancer, renvoie la télémétrie (poses, position de vue, FPS, boutons) | Généré par `scaffold_*` : `vra_cmd.json` → `vra_ack.json` + `vra_state.json` |

Téléchargements officiels (installés par l'utilisateur, jamais par VRA) :
- Simulateur : https://developers.meta.com/horizon/downloads/package/meta-xr-simulator-windows/
- Operator : https://developers.meta.com/horizon/documentation/unity/meta-xr-operator/connecting-ai-agents/

Installation sur le PC de test :
- **Simulateur** : l'utilisateur lance lui-même le `.msi` de Meta (ex. `meta_xr_simulator_v207.1.msi`) ; VRA le détecte
  ensuite via le registre OpenXR (`AvailableRuntimes`).
- **Operator** : `install_tool_plan tool_id=meta-xr-operator local_archive=<…\meta-xr-operator-standalone-public-v207.0.1.zip>`
  puis `install_tool_apply` → extrait dans le dossier `tools` de VRA ; `xr_sim_status` choisit la couche **windows**
  (le paquet contient aussi android/ et macos/). Accès direct facultatif pour Claude :
  `claude mcp add meta-xr-operator <…>\windows\meta-xr-operator-mcp-proxy.exe`.
- Outil intégré connu de l'Operator v207 : `openxr_set_head_pose` (pose de la tête ; absent sur un vrai Quest). Les autres
  noms se lisent avec `lab_operator_tools`.
- Ces fichiers Meta ne se publient **jamais** sur GitHub (licence Meta ; le `.msi` dépasse aussi la limite de 100 Mo) : les
  retélécharger ou les copier (clé USB, OneDrive) sur chaque PC.

Si les dossiers ne sont pas trouvés automatiquement : `VRA_XRSIM_JSON=<.json du runtime du simulateur>` et
`VRA_XR_OPERATOR_DIR=<dossier windows du paquet Operator>`.

## Boucle type (parcours `lab_optimize`)

1. `lab_machine_check` — profil `complet` (carte dédiée ≥ 8 Go, ex. RTX A4500) ou `léger` (carte intégrée : jeux légers,
   résolution VR réduite, pas de mesure de performance).
2. `xr_sim_status` — simulateur et Operator présents ?
3. Pont à chaud déployé avec le mod : UEVR `scripts/vra_lab.lua` ; Unity : classe `VraLab` du plugin BepInEx (à compiler) ;
   REFramework `reframework/autorun/vra_lab.lua` ; Godot autoload `VraLab`.
4. `lab_launch` — jeu sur le casque simulé, injection UEVR automatique (`UEVRInjector.exe --attach=<exe>` ; cocher OpenXR
   une fois dans l'injecteur), attente de la première télémétrie.
5. `lab_operator_tools` → `lab_operator_map` (une seule fois) : relier `head_pose`, `controller_pose`, `button`, `capture`
   aux vrais outils de l'Operator (gabarits `{{px}} {{py}} {{pz}} {{qx}} {{qy}} {{qz}} {{qw}} {{yaw}} {{pitch}} {{roll}} {{hand}} {{button}} {{value}}`).
6. `lab_run_scenario` — scénarios intégrés, un seul appel chacun :

| Scénario | Vérifie | Ferme (source simulateur) |
| --- | --- | --- |
| `smoke` | jeu vivant, image non noire, stéréo présente, pas d'œil noir, télémétrie | `stable_start`, `stereo_ok` |
| `head_6dof` | tourner à droite/gauche → la vue glisse dans le bon sens ; se pencher → la vue change | `head_6dof` |
| `world_scale` | tête +0,5 m → la vue du jeu bouge de 0,5 m (Unreal : × world_to_meters) ; rapport 1,00 ± 0,20 | `world_scale` (provisoire) |
| `controllers` | main déplacée → l'arme bouge à l'image ; gâchette envoyée | `hand_aim` |
| `hud` | HUD visible, captures face et regard bas | — (juger l'image) |
| `stability` | N minutes de mouvements aléatoires sans plantage | `stable_start` |

7. `lab_matrix` — produit d'axes de réglages appliqués à chaud, chacun testé ; plantage → variante marquée, jeu relancé,
   dernier bon réglage restauré, on continue. Classement par score puis FPS.
   Exemple Unreal :
   ```json
   {"axes": {
     "rendu": [{"label":"native","commands":[{"command":"set_mod_value","args":{"key":"VR_RenderingMethod","value":"0"}}]},
               {"label":"synchro","commands":[{"command":"set_mod_value","args":{"key":"VR_RenderingMethod","value":"1"}}]}],
     "resolution": [{"label":"100","commands":[{"command":"exec","args":{"command":"r.ScreenPercentage 100"}}]},
                    {"label":"70","commands":[{"command":"exec","args":{"command":"r.ScreenPercentage 70"}}]}]
   }, "builtin": "smoke"}
   ```
   Les noms de réglages UEVR (`VR_RenderingMethod`…) se vérifient dans `config.txt` du profil
   (`%APPDATA%\UnrealVRMod\<exe>\`) ou avec `get_mod_value` avant de lancer une matrice.
8. Appliquer la meilleure variante (`lab_command`), sauvegarder (`save_config` en UEVR), regarder les captures clés (Read).

Contrôle complet du simulateur avec la CLI officielle de Meta :
- `xrsim_control` : démarrage, casque, fréquence, manettes, vidéo MP4, FPS ;
- `xrsim_diagnose` : maillon cassé.

`lab_launch` règle le simulateur tout seul. `lab_stop` ferme le jeu lancé par VRA. Pour tout enchaîner sans
surveillance : [autopilot.md](autopilot.md).

Aller du lancement au jeu sans intervention : `game_ui_*` puis `game_ui_recipe action=save` — la recette est rejouée par
`lab_launch` et après chaque relance de `lab_matrix` ([game-ui.md](game-ui.md)).
9. Une session casque courte : fermer `comfort`, `framerate`, `world_scale` avec `source=casque`.

## Règles

- Le Lab respecte tous les garde-fous : anti-cheat → refus ; aucune écriture sans plan et accord (ou autorisation
  autonome) ; VRA ne ferme que les processus qu'il a lui-même lancés (`lab_stop`).
- Les preuves du Lab portent `source=simulateur` : confort, fréquence et échelle perçue restent **provisoires** jusqu'au casque.
- Le simulateur n'est pas un Quest : les performances mesurées sont indicatives, la perception de l'échelle et le confort
  ne se jugent qu'en casque.
- Outil uniquement OpenVR : repli `steamvr_null_driver` (casque fictif immobile — démarrage et image seulement), à désactiver
  après la session.
- Si l'Operator n'est pas disponible : captures de la fenêtre du simulateur (`window_title`), pas de pilotage tête/manettes —
  les scénarios qui bougent la tête échouent avec un message clair.
- Pour aller vite : enchaîner `lab_command` + `lab_run_scenario` plutôt que des dizaines d'appels unitaires ; une hypothèse =
  une variante de matrice.
