# Outils de compilation

Les mods **Unity** (plugins BepInEx générés par `scaffold_unity_plugin`) doivent être compilés : il faut le
**SDK .NET 8** de Microsoft. Les autres moteurs (Lua UEVR, Lua REFramework, GDScript) n'ont besoin de rien.

Texte à montrer à l'utilisateur s'il manque :

> Pour fabriquer le mod VR, il faut installer un outil de programmation qui manque sur ton PC : le SDK .NET 8 de
> Microsoft. Sans lui, on ne peut pas transformer le code du mod en fichier utilisable par le jeu.
> - D'où il vient : de Microsoft, gratuitement, via le gestionnaire officiel de Windows (winget).
> - La commande : `winget install --id Microsoft.DotNet.SDK.8 --source winget`

Enchaînement :
1. `build_tools_status` → SDK présent ?
2. Sinon : montrer le texte ci-dessus, obtenir l'accord, `install_dotnet_sdk confirm=true` (le setup VRA le propose aussi,
   case cochée par défaut ; en console `setup.cmd -NoGui --dotnet`).
3. `build_unity_plugin` → DLL compilée + valeurs prêtes pour `deploy_files` (plan, puis `confirm=true`).
4. Après installation, le SDK peut n'être visible qu'après avoir rouvert le terminal / Claude Code.
