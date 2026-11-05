# Unreal Engine 3 et antérieurs (UE1, UE2, UE3/UDK)

**Signatures** : paquets `*.upk` / `*.u`, dossiers `CookedPC`, `CookedPCConsole`, absence de `Content/Paks`.

**Plafond par défaut : 0, ou 1 si DX11 prouvé.** UEVR ne gère pas UE3 et antérieurs. Beaucoup de jeux UE3 sont en DX9.

| Palier | Outil | Condition |
| --- | --- | --- |
| 0 | Virtual Desktop écran géant | toujours |
| 1 | geo-11 | rendu DX11 observé (`detect_graphics_api`) |
| 2+ | Mod VR dédié | uniquement s'il existe (recherche `vr-scout`) |

**Pour monter quand même** : chercher un mod VR dédié au jeu ; à défaut, gestes des contrôleurs vers manette virtuelle
(expérimental). Ne jamais promettre le 6DOF sans outil identifié.
