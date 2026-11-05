# Profil de confort

Saisi une seule fois (`comfort_profile set`), appliqué à chaque jeu, surchargeable par jeu (`game_path`). Il règle le confort
et le schéma de commandes ; il **n'abaisse jamais** la cible VR.

| Préférence (clé) | Valeurs | Traduction selon l'outil |
| --- | --- | --- |
| `position` | assis, debout, roomscale | hauteur de caméra et recentrage (UEVR, plugin Unity, `XROrigin3D`, cvars des ports) |
| `input` | manette, controleurs, les_deux | oriente le schéma de commandes proposé (jamais la cible) |
| `rotation` | crans_30, crans_45, continue | option de l'outil, sinon script/plugin (`vr.set_snap_turn_enabled` en UEVR) |
| `motion_sickness` | faible, moyenne, forte | vignette, rotation par crans forcée, caméra fixe en véhicule |
| `third_person` | derriere_personnage, diorama_fixe | tangage découplé UEVR (`vr.set_decoupled_pitch_enabled`) ; découplage dans les plugins |
| `dominant_hand` | droite, gauche | arme et pointeur sur la bonne main |
| `height_cm` | cm | échelle du monde |
| `hud_distance`, `hud_size` | proche/moyen/loin ; petit/moyen/grand | projection UI de chaque outil (distance HUD du plugin Unity) |
| `cutscenes` | ecran_virtuel, immersif | bascule automatique quand l'outil le permet |
| `session_minutes` | minutes | rappel de pause dans la boucle de test |

Ne demander que les clés listées dans `a_demander`. Un jeu de course peut surcharger `position=assis` même si l'utilisateur
préfère être debout.
