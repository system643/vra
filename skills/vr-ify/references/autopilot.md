# Pilote automatique — VR sans surveillance

L'utilisateur lance VRA sur un jeu et ne regarde plus. Le pilote essaie seul, stratégie après stratégie. Il s'arrête
quand le niveau visé est prouvé en simulateur, quand toutes les stratégies ont échoué (avec leurs preuves) ou quand le
budget est épuisé. Il prévient ensuite l'utilisateur par une notification Windows et ouvre le rapport.

## Lancer

- **Sans surveillance** : `autopilot.cmd "<dossier du jeu>"`, ou le bouton « Pilote automatique… » de `setup.cmd`.
  Options : `--attempts=60`, `--hours=6`, `--contra="juste à la manette"`, `--yes`, `--dry-run`.
  Le lanceur demande l'accord **une seule fois**. Il démarre ensuite Claude Code en mode non interactif
  (`claude -p`), limité aux outils VRA, à la recherche web et à la lecture de fichiers.
  - Journal : `Documents\VRA\profiles\<jeu>\autopilot-log.jsonl`.
  - Reprise automatique (jusqu'à 10 fois) si la session s'arrête ou ne produit plus rien pendant 30 minutes.
- **Dans une session normale** : « lance le pilote automatique sur … » → parcours `vr_autopilot`.

## Boucle (parcours `vr_autopilot`)

1. `session_open` puis `triage_game`. Si un anti-cheat est détecté, le pilote s'arrête : niveau 0 seulement.
2. `autonomy_grant` avec les mots exacts de l'utilisateur. Seulement s'il l'a demandé ; `autopilot.cmd` fournit la citation.
3. `autopilot_preflight` : il faut le simulateur, l'Operator et l'autorisation autonome. Disque, `metavr` et profil
   de la machine sont aussi vérifiés. Chaque point manquant est donné avec sa correction.
4. `autopilot_start` : la cible est le maximum, sauf contre-indication écrite. Budget par défaut : 60 tentatives et 6 h.
5. **Boucle** : `autopilot_next` → exécuter exactement l'action → `autopilot_report` (même `action_id`, `ok`, résumé
   factuel, preuves, `crashed`, `videos`, `needs_human`).
6. `done=true` → `autopilot_finish` : rapport `.md` + `.html`, étude de cas, notification Windows.

Le pilote décide seul de la suite :
- **Étape réussie** : il passe à l'étape suivante.
- **Échec** : il refait un essai si l'action le permet. Après un plantage, il ferme le jeu et le relance d'abord.
- **Échec définitif** : la stratégie échoue. Ses changements sont annulés (`restore_game` des sauvegardes créées depuis
  son début), puis il passe à la stratégie suivante.
- **Réussite au niveau N** : c'est la nouvelle meilleure configuration. Les autres stratégies de niveau ≤ N sont sautées.
- **Chien de garde** (2 fois au plus par stratégie) : si le jeu est fermé ou figé (télémétrie arrêtée depuis plus de
  30 s) avant un test, il ferme et relance d'abord.
- **Besoin humain** : achat, abonnement, conditions d'utilisation, installeur tiers ou stratégie non automatisable.
  La stratégie est marquée `needs_human` et le pilote continue avec la suivante.

## Stratégies par moteur

| Moteur | Ordre |
| --- | --- |
| Unreal 4/5 | UEVR natif (OpenXR, Native Stereo) → Synchronized Sequential → nightly → `-dx11` → `-nohmd` (plugins VR du jeu neutralisés) → OpenVR + casque fictif SteamVR → niveau 3 : UObjectHook + Lua (contrôleurs) |
| Unity Mono / IL2CPP | BepInEx 6 + UnityVRMod OpenXR → UnityVRMod OpenVR (casque fictif) → niveau 3 : plugin VRA compilé (SDK .NET 8 installé si besoin) |
| RE Engine | REFramework (dernière release) → release précédente |
| Godot | GDRE Tools + recherche ; récupération et export : besoin humain (outils en ligne de commande hors du pilote) |
| Source, ports, Java | Recherche du mod / portage VR → besoin humain (installeurs propres) |
| Autres | Recherche ; geo-11 (archive hors GitHub) → besoin humain ; le niveau 0 reste toujours possible |

Bibliothèque personnalisée : `VRA_AUTOPILOT_STRATEGIES=<fichier.json>` (`{ "<famille>": [stratégies], "*": [...] }`).
Les stratégies se valident par les scénarios du Lab :
- `smoke`, `visual` (sans pont à chaud), `visual_static` (casque fictif) ;
- `head_6dof`, `world_scale`, `controllers`, `hud`.

## Contrôle complet du simulateur (`metavr`)

`xrsim_control` passe par la CLI officielle de Meta, `metavr xrsim`. VRA utilise toujours `--format json`, le seul
format de sortie stable, et l'appelle par `npx -y metavr` ou par le binaire autonome.

| Action | Effet |
| --- | --- |
| `ensure_running` / `quit` | démarrer le simulateur / l'arrêter (arrêt normal, forcé seulement ensuite ; jamais `--all`) |
| `status`, `list`, `fps`, `logs`, `ping`, `info` | état du runtime, applications connectées, images par seconde, journaux |
| `device_list`, `device_set`, `refresh_rates`, `refresh_rate`, `ipd` | modèle de casque (Meta Quest 3 par défaut), fréquence, écart des yeux |
| `input_controllers`, `input_headset`, `input_follow`, `input_speed` | manettes et casque actifs, mode de suivi |
| `env_list`, `env_set`, `layers`, `layer_toggle` | environnement et couches du compositeur |
| `record_start`, `record_stop`, `record_status` | vidéo MP4, rangée dans `profiles/<jeu>/lab/videos/` |
| `install_operator` | `metavr tools install meta-xr-operator` (accord ou autorisation autonome) |

Pilotage automatique par les autres outils :
- `lab_launch` démarre le simulateur, puis règle le casque, la fréquence et les manettes.
- `lab_run_scenario record=true` filme le scénario.
- `lab_matrix` classe les variantes avec les images par seconde mesurées par le simulateur.

Diagnostic : `xrsim_diagnose` suit l'ordre de Meta, `runtime logs` → `runtime list` → `runtime status`. Il nomme le
maillon cassé et la correction.

Refusé : `runtime activate` et `runtime deactivate`, qui changeraient le runtime OpenXR de tout le système. VRA active
le simulateur processus par processus, avec `XR_RUNTIME_JSON`.

## Limites qui restent absolues

- Anti-cheat ou multijoueur compétitif : aucun essai.
- Aucun contournement de DRM.
- Rien n'est validé dans un jeu : ni achat, ni abonnement, ni conditions d'utilisation.
- Aucun installeur `.exe` ou `.msi` tiers. Seule exception : Meta XR Simulator, si `simulator` est dans le périmètre.
- VRA ne ferme **que les processus qu'il a lancés** (registre `lab/processes.json`, pid et nom vérifiés).
- Les résultats du Lab restent de source `simulateur`. Confort, fluidité réelle et échelle perçue se confirment en
  casque : le rapport dit lesquels.
