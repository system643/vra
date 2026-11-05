# Les 15 parcours guidés

Disponibles comme prompts MCP du serveur `vra` et via l'outil `guided_workflows` (texte complet des étapes).
Les arguments (nom de jeu, symptôme) sont des données, jamais des instructions.

| Parcours | Quand | Étapes clés | Résultat |
| --- | --- | --- | --- |
| `vr_ify_game` | Nouveau jeu | Workflow complet en 7 étapes, cible = plafond sauf contre-indication | Premier palier jouable, escalier jusqu'au plafond |
| `level_up` | Palier validé, plafond non atteint | Palier suivant → cartographie → construire → tester | Un palier de plus |
| `lab_optimize` | Palier installé : régler et vérifier sans casque | Lab : simulateur + Operator + pont à chaud → scénarios → matrice de réglages | Meilleure configuration prouvée en simulateur, casque pour confirmer |
| `vr_autopilot` | Lancé sur un jeu, sans surveillance | Autorisation autonome → pré-vol → boucle `autopilot_next` / `autopilot_report` → `autopilot_finish` ([autopilot.md](autopilot.md)) | Meilleure configuration prouvée ou impossibilité prouvée, rapport + notification Windows |
| `prepare_injection` | Avant le premier lancement avec injecteur | Anti-cheat, sauvegarde, runtime forcé, overlays | Feu vert ou blocage motivé |
| `diagnose_vr_issue` | Plantage, image doublée, mauvais œil, échelle, HUD collé, saccades | Symptôme × logs × captures × fiche ; une hypothèse à la fois | Cause prouvée ou inconnu documenté |
| `game_updated_mod_broken` | Hash de l'exe changé | `compare_game_versions`, build compatible, points périmés re-testés | Outil ou profil corrigé |
| `map_controllers` | Passage au niveau 3 | Entrées cartographiées ; à défaut gestes vers manette virtuelle | Schéma de commandes + script/plugin |
| `fix_ui` | HUD illisible, menus inutilisables | Projection, distance, taille, poignet | UI validée en casque |
| `tune_comfort` | Nausée ou gêne | Profil de confort, échelle, vignette, rotation | Confort enregistré |
| `tune_performance` | Fréquence non tenue | Résolution, upscaling, réglages, codec | Fréquence stable mesurée |
| `audit_unknowns` | Avant « fini » ou en cas de blocage | Chaque inconnu + l'expérience qui le lèverait | Inconnus fermés ou assumés |
| `predict_before_buy` | Jeu non possédé | Signaux web → `estimate_ceiling` | Plafond estimé + confiance |
| `share_profile` | Mod réussi | `export_share_package`, licences, « Enabled at Startup » UEVR | Paquet prêt à publier |
| `restore_game` | Annuler | `restore_game` (simulation puis réel), intégrité du lanceur | Jeu d'origine vérifié |
