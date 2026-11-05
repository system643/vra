# Godot

**Signatures** : fichier `.pck` (séparé, ou intégré à la fin de l'exe : magie `GDPC`), `GodotSharp.dll` pour C#.
Version du moteur et format lus dans l'en-tête du PCK (observé).

**Plafond : 4** (pas d'injecteur universel : chaque jeu est un projet). OpenXR est intégré à Godot 4.

| Étape | Outil |
| --- | --- |
| Récupérer le projet | GDRE Tools (`install_tool_plan gdre-tools`) → projet dans un dossier **VRA**, jamais dans le jeu |
| Ajouter la VR | `scaffold_godot_xr` : autoload OpenXR + rig `XROrigin3D` / `XRCamera3D` / 2 × `XRController3D`, `xr/openxr/enabled` et `xr/shaders/enabled` |
| Exporter | Éditeur Godot **de la même version** que le jeu, export vers un **nouvel** exécutable à côté de l'original |

**Cartographie** : `map_game` liste les scènes et scripts de l'index du PCK (`.tscn`, `.gd`, `.gdc`) par catégorie.

**Pièges** : PCK chiffré (drapeau dans l'en-tête) → clé du jeu nécessaire, signal `pck_encrypted` ; Godot 3 → nœuds
`ARVROrigin` (le générateur cible Godot 4) ; scripts compilés `.gdc` à décompiler par GDRE Tools.

**Logs** : `%APPDATA%\Godot\app_userdata\<projet>\logs\godot.log` (ou dossier personnalisé du jeu).

**Lab sans casque (pont à chaud)** : `scaffold_godot_xr` ajoute l'autoload `VraLab` (`XRServer.world_scale`, recentrage ; télémétrie caméra, FPS). Le simulateur exige le rendu Vulkan (Forward+/Mobile), pas le mode Compatibilité OpenGL. Voir [../lab.md](../lab.md).
