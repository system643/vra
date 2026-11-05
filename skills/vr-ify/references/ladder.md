# Échelle de faisabilité 0 → 4 et principe du maximum

Un niveau supérieur inclut les précédents. Le **plafond** dépend du moteur, de l'API graphique, de l'anti-cheat et des mods
existants ; la **cible** est le plafond, sauf contre-indication explicite (`plan_target`).

| Niveau | Ce que l'on obtient | Outils typiques | Pour quels jeux | Effort |
| --- | --- | --- | --- | --- |
| 0 — Écran géant | Le jeu sur un écran de cinéma virtuel, rien n'est modifié | Virtual Desktop | Tous, y compris 2D, émulés, anti-cheat | Minutes |
| 1 — Profondeur / 3DOF | Image stéréo 3D, parfois rotation de tête | geo-11 (DX11), shaders de profondeur | DX11 sans injecteur : AAA propriétaires, moteurs maison, émulateurs | Faible |
| 2 — 6DOF | Tête suivie en 6DOF, vraie échelle, UI projetée | UEVR, UUVR, UnityVRMod, REFramework, R.E.A.L. (visuel seulement) | Unreal, Unity, RE Engine, AAA avec mod dédié | Moyen |
| 3 — Contrôleurs et corps | Visée à la main, armes aux mains, menus repositionnés, gestes | UObjectHook + Lua UEVR, plugins BepInEx/Harmony, Lua REFramework, Vivecraft, mods des éditions VR officielles | Niveau 2 cartographiable ; Minecraft Java ; Skyrim VR, Fallout 4 VR | Élevé |
| 4 — Sur mesure | Pensé pour la VR (interactions physiques, IK) | Source ports VR, Source SDK 2013, projets Godot + nœuds XR | Open source, Source 1, Godot, Minecraft (Vivecraft) | Très élevé |

## Ce qui peut abaisser la cible, et rien d'autre

| Origine | Exemples | Effet |
| --- | --- | --- |
| Contre-indication explicite | « juste à la manette », « pas de code », « seulement ce soir », « le visuel me suffit » | Cible abaissée ; rappeler le maximum en une ligne |
| Garde-fou | Anti-cheat actif, multijoueur compétitif | Niveau 0 seulement, avec la preuve |
| Blocage technique prouvé | Aucun point d'accroche, fichiers chiffrés, aucun outil | Plus haut niveau atteignable + ce qui permettrait d'aller plus loin |

Traduction en paramètres `contraindications` : « juste à la manette » → `gamepad_only` ; « le visuel me suffit » →
`visual_only` ; « pas de code » → `no_code` (seuls les outils et mods existants comptent) ; « niveau N max » → `max_level`.
Toujours remplir `quote` avec les mots exacts. Rien d'autre n'est une contre-indication : ni le profil de confort, ni une
supposition sur ce que l'utilisateur « voudrait sans doute ».

## Plan en escalier

1. **Palier rapide** : le premier niveau jouable (souvent 2 en quelques minutes).
2. **Paliers suivants** : contrôleurs, UI, corps, interactions — chacun jouable et validé par la checklist.
3. **Plafond** annoncé dès le départ avec effort, risques, inconnus.

## Voies pour dépasser un mod « visuel seulement »

1. Injecteur du moteur qui gère les contrôleurs (UEVR, REFramework, frameworks Unity).
2. Écosystème de modding du jeu (extender de scripts, SDK officiel, outils communautaires).
3. Gestes vers manette virtuelle (nécessite un pilote de manette virtuelle ; expérimental, à valider jeu par jeu).
4. Mod sur mesure (niveau 4) quand le jeu s'y prête.
