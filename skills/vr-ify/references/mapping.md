# Cartographie du jeu (niveau 3 et plus)

Sept éléments à localiser, quel que soit le moteur — d'abord **hors ligne** (`map_game`), puis confirmés en jeu :

1. **Caméra principale** — la remplacer ou la piloter par la tête.
2. **Joueur** (pawn, personnage) — position, rotation, hauteur des yeux, échelle du monde.
3. **Objet tenu** (arme, outil, lampe) — l'attacher à la main.
4. **Système d'entrées** — mapper gestes et boutons.
5. **HUD et menus** — les projeter dans l'espace ou au poignet.
6. **Cinématiques** — basculer sur un écran virtuel.
7. **États spéciaux** — pause, chargement, véhicule, mort.

| Moteur | Outils | Où chercher | Produit |
| --- | --- | --- | --- |
| Unreal 4/5 | `map_game` (modules `/Script/`, classes C++), dump RE-UE4SS / Dumper-7 | `PlayerCameraManager`, `Pawn`/`Character`, maillage d'arme, UMG, séquences | Lua UEVR + UObjectHook |
| Unity Mono | `map_game` (métadonnées .NET), ILSpy/dnSpyEx, REA | `Camera.main`, Player/Weapon, `Canvas.renderMode`, Input System/Rewired | Plugin BepInEx + Harmony |
| Unity IL2CPP | `map_game` (table de chaînes), Cpp2IL/Il2CppDumper, REA | mêmes cibles, par noms | Plugin BepInEx 6 (Il2CppInterop) |
| RE Engine | Object Explorer de REFramework | types caméra/joueur/arme/UI | Lua REFramework |
| Source 1 | `map_game` (gameinfo), Source SDK 2013 | `CViewRender`, `C_BasePlayer`, HUD | Mod compilé ou cvars |
| Creation | SKSE/F4SE (+ VR) | plugins existants, Papyrus | Plugin d'extender ou mods VR |
| Godot | `map_game` (index PCK), GDRE Tools | `Camera3D`, `CharacterBody3D`, `CanvasLayer`, `InputMap` | Projet + nœuds XR |
| Open source | code du port | rendu, joueur, armes, HUD | Contribution/fork du port |
| AAA / maison | REA + Ghidra/IDA (lecture seule), imports | matrices vue/projection, présentation | Rapport de faisabilité |
| Java, 2D, émulés | — | — | Niveau 0–1 (Vivecraft déjà complet) |

Statuts : un nom lu dans les métadonnées est **observé** ; son rôle (« c'est la caméra du joueur ») reste **déduit** jusqu'à
confirmation en jeu. Passer les classes retenues aux générateurs (`scaffold_*`), jamais des centaines de candidats.
