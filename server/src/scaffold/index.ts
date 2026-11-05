import fs from "node:fs";
import path from "node:path";
import { appData, projectsDir, gameSlug } from "../paths.js";
import { createBackup } from "../backup.js";
import type { ComfortProfile } from "../store.js";
import { GODOT_LAB_GD, REFRAMEWORK_LAB_LUA, UEVR_LAB_LUA, unityLabBridgeCs } from "./bridges.js";

/**
 * Generators. Files are always written first into the VRA projects folder;
 * deploying them next to the game (or into the UEVR profile) needs an
 * explicit confirmation and creates a backup.
 */

export interface GeneratedFile {
  rel: string;
  content: string;
}

export interface ScaffoldResult {
  projectDir: string;
  files: string[];
  deployTarget: string | null;
  deployed: boolean;
  backupId: string | null;
  instructions: string[];
  verifyBeforeUse: string[];
}

function writeAll(dir: string, files: GeneratedFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const p = path.join(dir, ...f.rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content, "utf8");
    out.push(p);
  }
  return out;
}

async function deploy(gamePath: string, targetRoot: string, files: GeneratedFile[], label: string): Promise<string> {
  const m = await createBackup(targetRoot, gamePath, files.map((f) => f.rel), label);
  writeAll(targetRoot, files);
  return m.id;
}

const luaString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const csIdent = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1") || "Jeu";

/* ───────────────────────── UEVR ───────────────────────── */

export async function scaffoldUevr(args: { gamePath: string; exeStem: string; classes: string[]; comfort: ComfortProfile; deploy: boolean; confirm: boolean }): Promise<ScaffoldResult> {
  const snap = args.comfort.rotation ? args.comfort.rotation !== "continue" : (args.comfort.motion_sickness ?? "moyenne") !== "faible";
  const decoupled = args.comfort.third_person === "diorama_fixe" || (args.comfort.motion_sickness ?? "moyenne") === "forte";
  const lua = `-- VRA : script UEVR généré pour ${args.exeStem}
-- Emplacement : %APPDATA%\\UnrealVRMod\\${args.exeStem}\\scripts\\ (chargé automatiquement par UEVR)
-- API : https://docs.uevr.io/plugins/lua.html
-- Ce script ne remplace pas UObjectHook : attacher l'arme à la main se fait d'abord
-- depuis le menu UEVR (Insert ou L3+R3), sans code.

local api = uevr.api
local vr = uevr.params.vr

local VRA = {
    -- Marqueur de test : LB + RB + A maintenus ~1 s (manette, ou contrôleurs mappés en XInput par UEVR)
    marker_buttons = { 0x0100, 0x0200, 0x1000 },
    marker_hold_frames = 60,
    -- Confort (profil VRA)
    snap_turn = ${snap},
    decoupled_pitch = ${decoupled},
    -- Classes repérées par la cartographie (à confirmer en jeu)
    classes = { ${args.classes.slice(0, 30).map(luaString).join(", ")} },
}

local held, markers, applied = 0, 0, false

local function apply_comfort()
    pcall(function() vr.set_snap_turn_enabled(VRA.snap_turn) end)
    pcall(function() vr.set_decoupled_pitch_enabled(VRA.decoupled_pitch) end)
    print("[VRA] confort appliqué : snap_turn=" .. tostring(VRA.snap_turn) .. " decoupled_pitch=" .. tostring(VRA.decoupled_pitch))
end

local function report_classes()
    for _, name in ipairs(VRA.classes) do
        local ok, found = pcall(function() return api:find_uobject("Class " .. name) end)
        print("[VRA] classe " .. name .. " : " .. ((ok and found) and "trouvée" or "non trouvée (nom complet /Script/Module.Classe requis)"))
    end
end

uevr.sdk.callbacks.on_pre_engine_tick(function(engine, delta)
    if not applied then
        applied = true
        apply_comfort()
        report_classes()
    end
end)

uevr.sdk.callbacks.on_xinput_get_state(function(retval, user_index, state)
    local buttons = state.Gamepad.wButtons
    local all = true
    for _, mask in ipairs(VRA.marker_buttons) do
        if (buttons & mask) == 0 then all = false end
    end
    if all then held = held + 1 else held = 0 end
    if held == VRA.marker_hold_frames then
        markers = markers + 1
        local name = "vra_marker_" .. tostring(markers) .. ".json"
        pcall(function() fs.write(name, '{"source":"uevr","index":' .. markers .. '}') end)
        print("[VRA] marqueur " .. markers .. " enregistré (" .. name .. ")")
    end
end)

uevr.sdk.callbacks.on_script_reset(function()
    print("[VRA] script réinitialisé")
end)
`;
  const files: GeneratedFile[] = [
    { rel: "scripts/vra_main.lua", content: lua },
    { rel: "scripts/vra_lab.lua", content: UEVR_LAB_LUA },
    {
      rel: "LISEZMOI-VRA.md",
      content: `# Profil UEVR généré par VRA — ${args.exeStem}\n\n- \`scripts/vra_main.lua\` : confort, marqueurs de test (LB+RB+A), vérification des classes cartographiées.\n- Les marqueurs sont écrits par \`fs.write\` dans \`%APPDATA%\\UnrealVRMod\\${args.exeStem}\\data\\\`.\n- Contrôleurs : ouvrir le menu UEVR → UObjectHook, attacher l'arme à la main, puis cocher « Enabled at Startup » avant de partager le profil.\n`,
    },
  ];
  const projectDir = path.join(projectsDir(args.gamePath), "uevr", args.exeStem);
  const written = writeAll(projectDir, files);
  const target = path.join(appData(), "UnrealVRMod", args.exeStem);
  let backupId: string | null = null;
  const willDeploy = args.deploy && args.confirm;
  if (willDeploy) backupId = await deploy(args.gamePath, target, files.filter((f) => f.rel.startsWith("scripts/")), "uevr-script");
  return {
    projectDir,
    files: written,
    deployTarget: target,
    deployed: willDeploy,
    backupId,
    instructions: willDeploy
      ? ["Script copié dans le profil UEVR. Relancer l'injection ou recharger les scripts depuis le menu UEVR."]
      : [args.deploy ? "Déploiement demandé sans confirm=true : rien n'a été copié. Montrer le plan à l'utilisateur puis relancer avec confirm=true." : "Fichiers générés dans le dossier projet VRA. Relancer avec deploy=true puis confirm=true pour les copier dans le profil UEVR."],
    verifyBeforeUse: ["Noms de classes complets (/Script/Module.Classe) à confirmer avec le menu UEVR ou un dump RE-UE4SS", "API Lua UEVR : https://docs.uevr.io/plugins/lua.html"],
  };
}

/* ───────────────────────── Unity (BepInEx) ───────────────────────── */

export async function scaffoldUnity(args: { gamePath: string; exeDir: string; runtime: "mono" | "il2cpp"; classes: Array<{ name: string; hooks?: string[] }>; comfort: ComfortProfile }): Promise<ScaffoldResult> {
  const slug = gameSlug(args.gamePath);
  const ident = csIdent(slug);
  const dataDir = fs.readdirSync(args.exeDir).find((d) => /_Data$/i.test(d)) ?? "<Jeu>_Data";
  const hudDistance = args.comfort.hud_distance === "proche" ? 1.0 : args.comfort.hud_distance === "loin" ? 2.5 : 1.6;
  const patches = args.classes
    .filter((c) => c.name && /^[A-Za-z_][\w.`]*$/.test(c.name))
    .slice(0, 12)
    .map((c, i) => {
      const method = c.hooks?.find((h) => h === "LateUpdate") ?? c.hooks?.[0] ?? "LateUpdate";
      return `    /// Patch généré pour ${c.name}.${method} (rôle déduit de la cartographie : à confirmer en jeu)
    [HarmonyPatch]
    internal static class Patch_${i}_${csIdent(c.name.split(".").pop() ?? "Type")}
    {
        static readonly System.Type Target = AccessTools.TypeByName("${c.name}");
        static bool Prepare() => Target != null;
        static MethodBase TargetMethod() => AccessTools.Method(Target, "${method}");
        static void Postfix(object __instance)
        {
            // TODO VRA : logique VR pour ${c.name} (ex. orienter selon la tête, attacher à la main)
        }
    }
`;
    })
    .join("\n");
  const common = `using System.Collections.Generic;
using System.Reflection;
using HarmonyLib;
using UnityEngine;
`;
  const ui = `    internal static class VraUi
    {
        static readonly HashSet<int> Done = new HashSet<int>();

        /// Re-place the canvases on the next frame (after a HUD distance change).
        public static void Reset() { Done.Clear(); }

        /// Passe les canvas « Screen Space Overlay » en World Space devant la caméra.
        public static void MoveOverlayCanvasesToWorld(float distance)
        {
            var cam = Camera.main;
            if (cam == null) return;
            foreach (var canvas in Object.FindObjectsOfType<Canvas>())
            {
                if (canvas == null || !canvas.isRootCanvas) continue;
                if (canvas.renderMode != RenderMode.ScreenSpaceOverlay && !(canvas.renderMode == RenderMode.WorldSpace && canvas.transform.parent == cam.transform)) continue;
                if (!Done.Add(canvas.GetInstanceID())) continue;
                canvas.renderMode = RenderMode.WorldSpace;
                canvas.worldCamera = cam;
                var t = canvas.transform;
                t.SetParent(cam.transform, false);
                t.localPosition = new Vector3(0f, 0f, distance);
                t.localRotation = Quaternion.identity;
                t.localScale = Vector3.one * (distance * 0.0012f);
            }
        }
    }
`;
  let pluginCs: string;
  let csproj: string;
  if (args.runtime === "mono") {
    pluginCs = `${common}using BepInEx;
using BepInEx.Configuration;

namespace VRA.${ident}
{
    [BepInPlugin(Guid, Name, Version)]
    public class VraPlugin : BaseUnityPlugin
    {
        public const string Guid = "vra.${slug}";
        public const string Name = "VRA ${ident}";
        public const string Version = "0.1.0";

        internal static ConfigEntry<bool> HudToWorld;
        internal static ConfigEntry<float> HudDistance;

        private void Awake()
        {
            HudToWorld = Config.Bind("UI", "HudEnEspace", true, "Projeter les canvas en World Space devant la caméra");
            HudDistance = Config.Bind("UI", "DistanceHud", ${hudDistance.toFixed(1)}f, "Distance du HUD en mètres");
            new Harmony(Guid).PatchAll();
            VraLab.HudToWorldValue = v => HudToWorld.Value = v;
            VraLab.HudDistanceValue = v => { HudDistance.Value = v; VraUi.Reset(); };
            VraLab.HudWorldGetter = () => HudToWorld.Value;
            VraLab.HudDistanceGetter = () => HudDistance.Value;
            Logger.LogInfo("[VRA] plugin chargé");
        }

        private void LateUpdate()
        {
            if (HudToWorld.Value) VraUi.MoveOverlayCanvasesToWorld(HudDistance.Value);
            VraLab.Tick();
        }
    }

${ui}
${unityLabBridgeCs("mono")}
${patches}}
`;
    csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netstandard2.0</TargetFramework>
    <AssemblyName>VRA.${ident}</AssemblyName>
    <LangVersion>latest</LangVersion>
    <Nullable>disable</Nullable>
    <GameDir>${args.exeDir}</GameDir>
    <Managed>$(GameDir)\\${dataDir}\\Managed</Managed>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="BepInEx"><HintPath>$(GameDir)\\BepInEx\\core\\BepInEx.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="0Harmony"><HintPath>$(GameDir)\\BepInEx\\core\\0Harmony.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="UnityEngine"><HintPath>$(Managed)\\UnityEngine.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="UnityEngine.CoreModule"><HintPath>$(Managed)\\UnityEngine.CoreModule.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="UnityEngine.UIModule"><HintPath>$(Managed)\\UnityEngine.UIModule.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="UnityEngine.JSONSerializeModule"><HintPath>$(Managed)\\UnityEngine.JSONSerializeModule.dll</HintPath><Private>false</Private></Reference>
    <Reference Include="Assembly-CSharp"><HintPath>$(Managed)\\Assembly-CSharp.dll</HintPath><Private>false</Private></Reference>
  </ItemGroup>
</Project>
`;
  } else {
    pluginCs = `${common}using BepInEx;
using BepInEx.Unity.IL2CPP;
using BepInEx.Configuration;

namespace VRA.${ident}
{
    [BepInPlugin(Guid, Name, Version)]
    public class VraPlugin : BasePlugin
    {
        public const string Guid = "vra.${slug}";
        public const string Name = "VRA ${ident}";
        public const string Version = "0.1.0";

        internal static ConfigEntry<bool> HudToWorld;
        internal static ConfigEntry<float> HudDistance;

        public override void Load()
        {
            HudToWorld = Config.Bind("UI", "HudEnEspace", true, "Projeter les canvas en World Space devant la caméra");
            HudDistance = Config.Bind("UI", "DistanceHud", ${hudDistance.toFixed(1)}f, "Distance du HUD en mètres");
            new Harmony(Guid).PatchAll();
            AddComponent<VraBehaviour>();
            VraLab.HudToWorldValue = v => HudToWorld.Value = v;
            VraLab.HudDistanceValue = v => { HudDistance.Value = v; VraUi.Reset(); };
            VraLab.HudWorldGetter = () => HudToWorld.Value;
            VraLab.HudDistanceGetter = () => HudDistance.Value;
            Log.LogInfo("[VRA] plugin chargé");
        }
    }

    public class VraBehaviour : MonoBehaviour
    {
        public VraBehaviour(System.IntPtr ptr) : base(ptr) { }

        private void LateUpdate()
        {
            if (VraPlugin.HudToWorld.Value) VraUi.MoveOverlayCanvasesToWorld(VraPlugin.HudDistance.Value);
            VraLab.Tick();
        }
    }

${ui}
${unityLabBridgeCs("il2cpp")}
${patches}}
`;
    csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
    <AssemblyName>VRA.${ident}</AssemblyName>
    <LangVersion>latest</LangVersion>
    <Nullable>disable</Nullable>
    <GameDir>${args.exeDir}</GameDir>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="$(GameDir)\\BepInEx\\core\\*.dll"><Private>false</Private></Reference>
    <Reference Include="$(GameDir)\\BepInEx\\interop\\*.dll"><Private>false</Private></Reference>
  </ItemGroup>
</Project>
`;
  }
  const readme = `# Plugin BepInEx généré par VRA (${args.runtime === "mono" ? "Mono, BepInEx 5" : "IL2CPP, BepInEx 6"})

1. Installer BepInEx (install_tool_plan ${args.runtime === "mono" ? "bepinex5" : "bepinex6-il2cpp"}) et lancer le jeu une fois${args.runtime === "il2cpp" ? " (génère BepInEx/interop)" : ""}.
2. Compiler : \`dotnet build -c Release\` (SDK .NET requis).
3. Copier \`bin/Release/*/VRA.${ident}.dll\` dans \`BepInEx/plugins/\` (avec sauvegarde, via VRA).
4. Lire \`BepInEx/LogOutput.log\` : la ligne « [VRA] plugin chargé » doit apparaître.

Les patchs générés ciblent des classes dont le rôle est **déduit** de leur nom : les confirmer avec UnityExplorer avant d'écrire la logique VR.
`;
  const files: GeneratedFile[] = [
    { rel: "VraPlugin.cs", content: pluginCs },
    { rel: `VRA.${ident}.csproj`, content: csproj },
    { rel: "LISEZMOI-VRA.md", content: readme },
  ];
  const projectDir = path.join(projectsDir(args.gamePath), `unity-${args.runtime}`);
  const written = writeAll(projectDir, files);
  return {
    projectDir,
    files: written,
    deployTarget: path.join(args.exeDir, "BepInEx", "plugins"),
    deployed: false,
    backupId: null,
    instructions: ["Compiler avec `dotnet build -c Release` dans le dossier projet, puis déployer la DLL avec deploy_files (confirm=true)."],
    verifyBeforeUse: ["API BepInEx de la version installée (5.x ou 6.x)", "Classes ciblées confirmées en jeu"],
  };
}

/* ───────────────────────── REFramework ───────────────────────── */

export async function scaffoldReframework(args: { gamePath: string; exeDir: string; types: string[]; deploy: boolean; confirm: boolean }): Promise<ScaffoldResult> {
  const slug = gameSlug(args.gamePath).replace(/[^a-z0-9_]/g, "_");
  const lua = `-- VRA : script REFramework généré pour ${slug}
-- Emplacement : <dossier du jeu>\\reframework\\autorun\\
-- API : re.on_draw_ui, re.on_frame, sdk.find_type_definition, sdk.hook

local VRA = {
    types = { ${args.types.slice(0, 30).map(luaString).join(", ")} },
}

re.on_draw_ui(function()
    if imgui.tree_node("VRA") then
        imgui.text("Script VRA chargé")
        for _, name in ipairs(VRA.types) do
            local td = sdk.find_type_definition(name)
            imgui.text(name .. " : " .. (td ~= nil and "trouvé" or "absent"))
        end
        imgui.tree_pop()
    end
end)

-- Exemple de hook à adapter après cartographie (Object Explorer) :
-- local td = sdk.find_type_definition("app.NomDuType")
-- local m = td and td:get_method("update")
-- if m then
--     sdk.hook(m, function(args) end, function(retval) return retval end)
-- end
`;
  const files: GeneratedFile[] = [
    { rel: `reframework/autorun/vra_${slug}.lua`, content: lua },
    { rel: "reframework/autorun/vra_lab.lua", content: REFRAMEWORK_LAB_LUA },
  ];
  const projectDir = path.join(projectsDir(args.gamePath), "reframework");
  const written = writeAll(projectDir, files);
  let backupId: string | null = null;
  const willDeploy = args.deploy && args.confirm;
  if (willDeploy) backupId = await deploy(args.gamePath, args.exeDir, files, "reframework-script");
  return {
    projectDir,
    files: written,
    deployTarget: path.join(args.exeDir, "reframework", "autorun"),
    deployed: willDeploy,
    backupId,
    instructions: [willDeploy ? "Script copié : menu REFramework (Insert) → Script Runner → Reset scripts." : "Relancer avec deploy=true et confirm=true pour copier le script dans reframework/autorun."],
    verifyBeforeUse: ["Noms de types confirmés dans Object Explorer"],
  };
}

/* ───────────────────────── Godot ───────────────────────── */

export async function scaffoldGodot(args: { gamePath: string; projectPath: string; godotVersion: string | null }): Promise<ScaffoldResult> {
  const major = args.godotVersion ? Number(args.godotVersion.split(".")[0]) : 4;
  const projectFile = path.join(args.projectPath, "project.godot");
  if (!fs.existsSync(projectFile)) throw new Error(`project.godot introuvable dans ${args.projectPath} : récupérer d'abord le projet avec GDRE Tools.`);
  if (path.resolve(args.projectPath).toLowerCase().startsWith(path.resolve(args.gamePath).toLowerCase())) {
    throw new Error("Le projet récupéré est dans le dossier du jeu : le déplacer dans un dossier VRA (jamais modifier le jeu en place).");
  }
  if (major < 4) throw new Error(`Godot ${args.godotVersion} : le générateur cible Godot 4 (nœuds XROrigin3D). Pour Godot 3, adapter à ARVROrigin à la main.`);
  const gd = `extends Node
## VRA : active OpenXR et place un rig XR sur la caméra active du jeu.

var xr_interface: XRInterface

func _ready() -> void:
	xr_interface = XRServer.find_interface("OpenXR")
	if xr_interface and xr_interface.is_initialized():
		get_viewport().use_xr = true
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		print("[VRA] OpenXR actif")
	else:
		push_warning("[VRA] OpenXR non initialisé : vérifier xr/openxr/enabled dans project.godot")
	get_tree().node_added.connect(_on_node_added)

func _on_node_added(node: Node) -> void:
	if node is Camera3D and not (node is XRCamera3D):
		call_deferred("_attach_rig", node)

func _attach_rig(cam: Camera3D) -> void:
	if not is_instance_valid(cam) or not cam.current or cam.get_parent() == null:
		return
	if cam.get_parent().has_node("VraXRRig"):
		return
	var rig: XROrigin3D = preload("res://addons/vra_xr/vra_xr_rig.tscn").instantiate()
	cam.get_parent().add_child(rig)
	rig.global_transform = cam.global_transform
	(rig.get_node("XRCamera3D") as XRCamera3D).current = true
	print("[VRA] rig XR attaché à ", cam.get_path())
`;
  const tscn = `[gd_scene format=3]

[node name="VraXRRig" type="XROrigin3D"]

[node name="XRCamera3D" type="XRCamera3D" parent="."]

[node name="LeftHand" type="XRController3D" parent="."]
tracker = &"left_hand"

[node name="RightHand" type="XRController3D" parent="."]
tracker = &"right_hand"
`;
  const files: GeneratedFile[] = [
    { rel: "addons/vra_xr/vra_xr.gd", content: gd },
    { rel: "addons/vra_xr/vra_xr_rig.tscn", content: tscn },
    { rel: "addons/vra_xr/vra_lab.gd", content: GODOT_LAB_GD },
  ];
  const written = writeAll(args.projectPath, files);
  const original = fs.readFileSync(projectFile, "utf8");
  fs.writeFileSync(`${projectFile}.vra-bak`, original, "utf8");
  const updated = upsertIni(upsertIni(upsertIni(original, "xr", "openxr/enabled", "true"), "xr", "shaders/enabled", "true"), "autoload", "VraXR", '"*res://addons/vra_xr/vra_xr.gd"');
  const withLab = upsertIni(updated, "autoload", "VraLab", '"*res://addons/vra_xr/vra_lab.gd"');
  fs.writeFileSync(projectFile, withLab, "utf8");
  return {
    projectDir: args.projectPath,
    files: [...written, projectFile],
    deployTarget: null,
    deployed: false,
    backupId: null,
    instructions: [
      "Ouvrir le projet dans l'éditeur Godot de la même version que le jeu.",
      "Exporter vers un NOUVEL exécutable à côté de l'original (jamais à sa place).",
      `Sauvegarde de project.godot : ${projectFile}.vra-bak`,
    ],
    verifyBeforeUse: ["Caméra du joueur réelle (le rig s'attache à la caméra « current »)", "Version exacte de l'éditeur Godot"],
  };
}

/** Set key=value inside [section] of a Godot project.godot (INI-like), adding the section if needed. */
export function upsertIni(text: string, section: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  const header = `[${section}]`;
  let start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", header, "", `${key}=${value}`, "");
    return lines.join("\n");
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\[.+\]\s*$/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  for (let i = start + 1; i < end; i++) {
    if (lines[i].split("=")[0].trim() === key) {
      lines[i] = `${key}=${value}`;
      return lines.join("\n");
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, `${key}=${value}`);
  return lines.join("\n");
}

/* ───────────────────────── Generic deploy ───────────────────────── */

export async function deployFiles(args: { gamePath: string; sourceDir: string; files: string[]; targetRoot: string; confirm: boolean }): Promise<{ plan: Array<{ from: string; to: string; replaces: boolean }>; deployed: boolean; backupId: string | null }> {
  const plan = args.files.map((rel) => {
    const from = path.resolve(args.sourceDir, rel);
    const relTarget = path.basename(rel);
    const to = path.join(args.targetRoot, relTarget);
    return { from, to, replaces: fs.existsSync(to) };
  });
  for (const p of plan) if (!fs.existsSync(p.from)) throw new Error(`Fichier source introuvable : ${p.from}`);
  if (!args.confirm) return { plan, deployed: false, backupId: null };
  const m = await createBackup(args.targetRoot, args.gamePath, plan.map((p) => path.basename(p.to)), "deploy");
  fs.mkdirSync(args.targetRoot, { recursive: true });
  for (const p of plan) fs.copyFileSync(p.from, p.to);
  return { plan, deployed: true, backupId: m.id };
}
