# Moteur maison / inconnu

**Signatures** : aucune reconnue. Indices : imports graphiques (`detect_graphics_api`), règles SteamDB, page PCGamingWiki/SteamDB.

**Plafond par défaut : 1 si DX11, sinon 0** — jamais plus sans preuve.

1. Chercher le jeu en ligne : moteur réel, mod VR dédié, mode VR officiel.
2. DX11 → geo-11 (niveau 1). Mod dédié trouvé → l'intégrer en `signals.existing_mods`.
3. Pour aller plus loin si le jeu en vaut la peine : analyse native avec REA (Ghidra/IDA en lecture seule), puis
   `live_inspect` en dernier recours (solo, sans anti-cheat, accord explicite) pour trouver matrices de vue/projection.
4. Toujours dire clairement le plafond et ce qui le bloque.
