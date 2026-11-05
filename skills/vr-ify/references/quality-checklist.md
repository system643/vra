# Checklist qualité VR

Un mod n'est « fini » que lorsque chaque point de son niveau est **fermé par une preuve, sur la build actuelle du jeu et la
version actuelle de l'outil** (`quality_checklist`). Une preuve d'avant une mise à jour devient « périmée » (`stale`).
États possibles : `open`, `closed`, `stale`, `blocked` (impossible avec cet outil), `out_of_scope` (non souhaité) — ces deux
derniers ne comptent jamais comme réussis.

| Point (id) | Dès le niveau | Preuve exigée | Attention selon le moteur |
| --- | --- | --- | --- |
| Démarrage stable (`stable_start`) | 1 | Log sans erreur + 10 min sans plantage | UEVR : mode de rendu ; BepInEx : LogOutput.log ; REFramework : version supportée |
| Image stéréo correcte (`stereo_ok`) | 1 | Capture miroir + confirmation en casque | geo-11 : convergence ; UEVR : jamais AFR en final |
| Suivi de tête 6DOF (`head_6dof`) | 2 | Se pencher, s'accroupir, regarder derrière soi | Unity : caméra réellement remplacée |
| Échelle du monde (`world_scale`) | 2 | Une porte ≈ 2 m, hauteur des yeux cohérente | UEVR : world scale ; Unity : parent de caméra ; Godot : XROrigin3D |
| Effets d'écran (`screen_effects`) | 2 | Captures sans fantômes ni effets 2D plaqués | Unreal : cvars ; Unity : post-traitements |
| HUD lisible (`hud_readable`) | 2 | Lisible sans mouvement de tête gênant | UMG ; canvas World Space ; cvars Source |
| Menus utilisables (`menus_usable`) | 2 | Parcours complet jusqu'à la sauvegarde | curseur ou pointeur laser |
| Cinématiques (`cutscenes_ok`) | 2 | Une cinématique en entier | vidéo → écran virtuel ; temps réel → caméra fixe |
| Fréquence (`framerate`) | 2 | Overlay VD : fréquence tenue 5 min en zone chargée | résolution, réglages graphiques |
| Confort (`comfort`) | 2 | 20 min sans gêne, profil appliqué | rotation par crans, vignette |
| Visée à la main (`hand_aim`) | 3 | L'arme suit la main (confirmation + capture) | UObjectHook ; plugin ; REFramework |
| Toutes les actions (`all_actions`) | 3 | Chaque action du jeu avec son geste ou bouton | système d'entrées cartographié |
| Interactions physiques (`physical_interactions`) | 4 | Vidéo ou confirmation par interaction | source ports, Godot |
| Restauration testée (`restore_tested`) | tous | Restauration puis réinstallation réussies | empreinte de l'outil |
