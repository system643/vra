# Prédire avant d'acheter (`predict_before_buy`)

Rien n'est installé ni téléchargé. L'agent `vr-scout` collecte les signaux, puis `estimate_ceiling` calcule le plafond.

| Signal | Source | Effet |
| --- | --- | --- |
| Moteur et SDK | SteamDB (page technologies, détection par noms de fichiers) | fixe le plafond théorique (famille) |
| Moteur, API graphique, mode VR officiel | PCGamingWiki | confirme ou corrige SteamDB |
| Anti-cheat | SteamDB, PCGamingWiki, page Steam | actif en solo → niveau 0 |
| Mod ou profil VR existant | vrdb.app, Flat2VR, Nexus Mods, GitHub des outils | remonte confiance et niveau |
| Retours récents | forums, Discord des outils | régressions après mise à jour |
| Type de jeu | page Steam | 1re personne favorable ; 2D ou vue du dessus limitée |

Réponse type : « Niveau 2 probable, confiance moyenne : Unreal 5 selon SteamDB, pas d'anti-cheat signalé, aucun profil UEVR
trouvé au 5 novembre 2026. » Toujours : niveau, confiance, trois signaux décisifs avec liens et dates, ce qui pourrait décevoir.
