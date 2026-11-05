# Fraîcheur des informations

Toute information web est enregistrée avec lien, date et version (`web_fact_record`), puis revérifiée au-delà de sa durée de
validité (`web_fact_check`, `session_resume` → `faits_web_perimes`). Un fait périmé reste en historique, marqué à revérifier,
et ne sert plus à décider.

| Type (`kind`) | Validité | Revérifié aussi quand |
| --- | --- | --- |
| `anticheat_status` | chaque session | le jeu a été mis à jour |
| `nightly_build` | 7 jours | un problème apparaît |
| `mod_compatibility` | 30 jours | le hash de l'exe change |
| `stable_release` | 30 jours | avant chaque installation |
| `install_paths` | au moment de l'installation | changement de version de l'outil |
| `community_profile` | 30 jours | avant de le recommander |
| `virtual_desktop` | 60 jours | nouvelle version de Virtual Desktop |
| `engine_detected` | illimitée | le hash de l'exe change |
| `other` | 30 jours | — |

Les règles de détection SteamDB embarquées se mettent à jour avec `update_detection_rules`.
