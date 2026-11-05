# Quest + Virtual Desktop

Choisir d'abord le runtime, dans le Streamer Virtual Desktop (Automatic, SteamVR ou VDXR) — le **forcer** pendant les tests
pour un comportement prévisible.

| Situation | Runtime | Pourquoi |
| --- | --- | --- |
| Outil OpenXR (UEVR mode OpenXR, UnityVRMod OpenXR, REFramework OpenXR, Godot) | VDXR | Pas de couche SteamVR ; Virtual Desktop annonce environ 10 % de performances en plus |
| Outil uniquement OpenVR | SteamVR | VDXR ne sert que les applications OpenXR |
| Niveau 0 | aucun | Mode bureau/cinéma de Virtual Desktop |

Réglages à vérifier avec l'utilisateur :
- **Codec** : AV1 ou H.264+ sur Quest 3 selon la latence ressentie ; débit adapté au réseau (Wi-Fi 6/6E, PC en Ethernet).
- **Performances** : rendre deux vues coûte bien plus cher qu'en écran plat ; baisser résolution et effets avant de
  diagnostiquer un « bug ». Overlay de performances de Virtual Desktop pour mesurer.
- **Confort** : voir [comfort.md](comfort.md).

Débits, codecs et liste des jeux en mode Automatic évoluent : revérifier à chaque nouvelle version de Virtual Desktop
(`web_fact_record kind=virtual_desktop`, validité 60 jours).
