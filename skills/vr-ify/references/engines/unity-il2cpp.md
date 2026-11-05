# Unity (IL2CPP)

**Signatures** : `GameAssembly.dll`, `<Jeu>_Data/il2cpp_data/Metadata/global-metadata.dat`, pas de `Managed/Assembly-CSharp.dll`.

**Plafond par défaut : 3**, plus coûteux qu'en Mono.

| Palier | Outil | Code ? |
| --- | --- | --- |
| 2 | UnityVRMod build IL2CPP (BepInEx 6, `bepinex6-il2cpp` + `unityvrmod`) ou UUVR via Rai Pal | non |
| 3 | Plugin BepInEx 6 via Il2CppInterop (`scaffold_unity_plugin` détecte IL2CPP) | oui |

**Cartographie** : pas de DLL C# lisible. `map_game` lit la table de chaînes de `global-metadata.dat` (identifiants, rôle déduit).
Pour les vraies classes : Cpp2IL ou Il2CppDumper (DLL factices), ou l'analyseur IL2CPP de REA. En jeu : UnityExplorer (build IL2CPP).

**Pièges**
- Signature `0xFAB11BAF` absente → métadonnées chiffrées/obfusquées : passer le signal `metadata_unreadable` à `plan_target`
  (le niveau 3 devient conditionnel, jamais promis).
- Premier lancement BepInEx 6 long (génération de `BepInEx/interop`) : normal.
- Anti-cheat plus fréquent sur les jeux IL2CPP en ligne → garde-fou.

**Logs** : `Player.log` (LocalLow), `BepInEx\LogOutput.log`.

**Lab sans casque (pont à chaud)** : le plugin généré contient la classe `VraLab` (HUD en World Space, distance du HUD, échelle du parent de caméra, `Time.timeScale` ; télémétrie caméra, scène, canvas, FPS), dossier `VRA_LAB_DIR` posé par `lab_launch`. Voir [../lab.md](../lab.md).
