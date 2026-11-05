# VRA — VR-ify Anything

Plugin Claude Code qui transforme un jeu PC plat en expérience VR, au **niveau maximum possible** pour ce jeu, de façon
**prouvée** et **réversible**. Inspiré de [REA](https://github.com/morluto/rea) : un serveur MCP fait les gestes, une skill
porte la méthode.

- **Triage avec preuves** : moteur, version, variante (Mono/IL2CPP, Win64/WinGDK), API graphique, anti-cheat, VR native —
  chaque information est *observée*, *déduite* ou *inconnue*, avec sa preuve.
- **Toujours le maximum** : la cible est le plafond du jeu ; seule une contre-indication que tu écris (« juste à la
  manette », « pas de code »…), un garde-fou ou un blocage prouvé l'abaisse. Un mod « visuel seulement » est un palier.
- **15 familles de moteurs** : Unreal 4/5 (UEVR), Unreal 3, Unity Mono et IL2CPP (UUVR, UnityVRMod, BepInEx), RE Engine
  (REFramework), Source 1 et 2, Bethesda, moteurs AAA propriétaires, Java/Minecraft (Vivecraft), Godot, vieux jeux open
  source (source ports), 2D, émulateurs, moteur inconnu (geo-11).
- **Installation contrôlée** : téléchargement depuis les releases GitHub officielles, plan affiché, accord explicite,
  sauvegarde, restauration.
- **VRA Lab, tests sans casque en boucle rapide** : casque simulé (Meta XR Simulator), pilotage de la tête et des manettes
  par l'agent (Meta XR Operator), pont à chaud dans le mod (réglages changés en quelques secondes sans relancer le jeu),
  scénarios automatiques (stéréo, 6DOF, échelle, contrôles, HUD) et **matrices de réglages** avec reprise après plantage.
- **Boucle de confirmation en casque** : marqueurs (Ctrl+Alt+M ou LB+RB+A), captures, logs de chaque outil, checklist qualité.
- **Garde-fous** : anti-cheat = niveau 0 seulement ; jamais de DRM contourné ; le contenu web n'est jamais une instruction.

## Installation en une commande

```powershell
cd $HOME\Desktop
git clone https://github.com/system643/vra.git VR
.\VR\setup.cmd
```

(ou double-clic sur `setup.cmd` dans le dossier `VR`). Une fenêtre s'ouvre :

1. **Clients IA** — cochés automatiquement s'ils sont détectés : Claude Code (plugin complet : skill, agents, serveur MCP,
   installé pour ton compte, plus besoin de `--plugin-dir`), OpenAI Codex (serveur MCP + skill), Gemini CLI, Google
   Antigravity, Cursor, VS Code / Copilot, Claude Desktop (serveur MCP).
2. **Logiciels Meta** du banc d'essai sans casque — boutons « Télécharger » vers les pages officielles ; une fois les
   fichiers dans Téléchargements, sur le Bureau ou dans le dossier `VR`, ils sont trouvés : l'Operator est extrait dans
   les outils de VRA, le simulateur est installé (fenêtre Windows de confirmation). Ces fichiers ne vont jamais sur GitHub.
3. **Options** — SDK .NET 8 de Microsoft (coché par défaut : nécessaire pour fabriquer les mods Unity, installé via
   `winget install --id Microsoft.DotNet.SDK.8 --source winget`), tests complets.
4. **Installer / mettre à jour** : Node.js est installé via winget s'il manque, puis dépendances, construction, test de
   bout en bout, configuration des clients, logiciels Meta, contrôles (Steam, SteamVR, Virtual Desktop), vérification
   finale (profil du Lab : complet sur une carte dédiée). Journal en direct, rapport dans `Documents\VRA\setup-report.json`.

Autres modes : **Simulation** (rien n'est modifié), **Désinstaller** (retire VRA des clients cochés), ou en console :
`.\setup.cmd -NoGui` (questions dans le terminal), `.\setup.cmd -NoGui -Yes` (tout accepter),
`.\setup.cmd -NoGui --agents=claude,codex --dry-run`. Sur macOS / Linux : `./setup.sh`.
Chaque fichier de configuration modifié est d'abord sauvegardé dans `Documents\VRA\backups\_setup\`, et relancer le setup
ne duplique rien.

Mettre à jour plus tard : `git pull` dans `VR`, puis relancer `setup.cmd`.

Pour développer VRA : `cd server`, `npm install`, `npm run build`, `npm test` (63 tests ; le test réel de pilotage de fenêtre : `VRA_UI_TEST=1 npx vitest run test/ui.test.ts`), `npm run smoke`.

Premières demandes à faire à Claude sur ce PC :
1. « Vérifie si ce PC est prêt pour le VRA Lab » → `lab_machine_check` (profil attendu : complet) puis `xr_sim_status`.
2. « Je veux jouer à <jeu> en VR, il est dans D:\SteamLibrary\steamapps\common\<jeu> » → triage, plan au maximum,
   installation contrôlée, Lab sans casque (`lab_optimize`), puis une courte confirmation en casque.

Mettre à jour plus tard : `git pull` puis `npm run build` dans `server`.

> Le portable de développement (carte graphique intégrée) fonctionne en profil **léger** : développement, détection, plans,
> générateurs et tests, mais pas de boucle VR rapide.

## Où sont mes données ?

Dans `Documents\VRA` (modifiable avec la variable d'environnement `VRA_HOME`) :

| Dossier | Contenu |
| --- | --- |
| `profiles\<jeu>-<hash>\` | fiche du jeu (`fiche.md`), journal de session, checklist, captures, marqueurs |
| `profiles\_utilisateur\confort.json` | ton profil de confort |
| `backups\` | sauvegardes avant chaque modification |
| `downloads\`, `tools\` | archives téléchargées et outils installés hors des jeux |
| `projects\` | scripts et plugins générés |
| `gallery\`, `share\` | études de cas et paquets partageables |

## Contenu du plugin

| Chemin | Rôle |
| --- | --- |
| `skills/vr-ify/` | méthode (SKILL.md) + 15 fiches moteur + références |
| `agents/vr-scout.md`, `agents/vr-engineer.md` | recherche web ; écriture des scripts et plugins |
| `server/` | serveur MCP `vra` (TypeScript) — 62 outils + 14 parcours guidés (dont le Lab sans casque) |
| `marker/` | marqueurs de test et captures d'écran (PowerShell) |
| `evals/` | faux jeux partagés et cas `claude plugin eval` |

Variables : `VRA_HOME` (données), `VRA_TOOL_FAMILIES` (`adaptive` par défaut, `all`, ou liste),
`VRA_SCHEMA_PROFILE` (`compact` ou `full`), `GITHUB_TOKEN` (optionnel, limite de requêtes GitHub),
`VRA_XRSIM_JSON` (runtime du simulateur s'il n'est pas trouvé), `VRA_XR_OPERATOR_DIR` (dossier `windows` de Meta XR Operator).

## VRA Lab en bref

| Outil | Rôle |
| --- | --- |
| `lab_machine_check` | profil complet / léger selon la carte graphique |
| `xr_sim_status` | simulateur, Operator, injecteur UEVR détectés ? |
| `lab_launch` | jeu sur le casque simulé (variables d'environnement par processus, registre intact), injection UEVR auto |
| `lab_operator_tools` / `lab_operator_map` | relier tête, manettes, boutons, capture aux outils de l'Operator |
| `lab_command` / `lab_state` | réglages à chaud et télémétrie du mod |
| `lab_run_scenario` | smoke, head_6dof, world_scale, controllers, hud, stability — ou étapes sur mesure, en un appel |
| `lab_matrix` | dizaines de variantes testées, plantages contournés, classement |
| `analyze_vr_frame` / `compare_vr_frames` | œil noir, rendu mono, stéréo, désalignement, sens du mouvement |
| `steamvr_null_driver` | repli OpenVR (casque fictif immobile), réversible |
| `game_ui_look` / `game_ui_click` / `game_ui_key` / `game_ui_type` / `game_ui_wait_text` | piloter les menus du jeu (OCR Windows, clic sur « Nouvelle partie »…), seulement dans la fenêtre du jeu |
| `game_ui_recipe` | recette « lancement → en jeu » rejouée automatiquement par le Lab |
| `build_tools_status` / `install_dotnet_sdk` / `build_unity_plugin` | SDK .NET 8 et compilation des mods Unity |

Inspection en direct (dernier recours) : `npm install frida` dans `server/`, puis activer la famille `inspect`.

## Évaluations

```powershell
node evals/generate.mjs
claude plugin eval . --scaffold --mocks off --allow-tools "mcp__plugin_vra_vra__*" --trust-plugin
```

Les 23 cas lancent le vrai serveur MCP sur de faux dossiers de jeux (aucun fichier de jeu réel) ; le 24e scénario (jeu
mis à jour entre deux sessions) est couvert par les tests unitaires. Pour un seul cas : `--case ue53-solo --runs 1 --ablation none`.

Contrôle en lecture seule sur tes vrais jeux (les fiches vont dans un dossier temporaire) :

```powershell
node server/test/real-games.mjs "C:\Program Files (x86)\Steam\steamapps\common\Outer Wilds"
```

## Licences

Code VRA : MIT. Règles de détection SteamDB embarquées : MIT (voir `THIRD_PARTY_NOTICES.md`). Les outils installés (UEVR,
BepInEx, REFramework, UUVR…) appartiennent à leurs auteurs et gardent leurs licences.
