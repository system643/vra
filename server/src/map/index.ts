import fs from "node:fs";
import path from "node:path";
import type { EngineFamily, Status } from "../types.js";
import { abs, findFiles, scanGame } from "../detect/scan.js";
import { readAssembly, rootBase } from "./dotnet.js";
import { readPck } from "./godot.js";
import { identifiersFrom, scanFile } from "../util/strings.js";
import { readRange } from "../util/fsx.js";

/**
 * Static game mapping: locate the seven elements VR needs (camera, player,
 * held object, input, HUD/menus, cutscenes, special states) without running
 * the game. Names read from metadata are "observed"; their role stays
 * "deduced" until confirmed in game.
 */

export const CATEGORIES = {
  camera: /camera|cam(?:era)?(?:controller|manager|rig)|viewmodel|mouselook|freelook|lookat|fpscam|playercam/i,
  player: /player|character|pawn|avatar|hero|protagonist|locomotion|firstperson|thirdperson/i,
  held_object: /weapon|gun|rifle|pistol|shotgun|sword|blade|melee|flashlight|torch|tool|equip|holdable|helditem|inhand|grab/i,
  input: /input|controls?(?:ler)?map|keybind|binding|rewired|actionmap|gamepad|joystick/i,
  hud_menus: /hud|crosshair|reticle|menu|canvas|widget|overlay|healthbar|minimap|tooltip|subtitle|dialog(?:ue)?ui/i,
  cutscenes: /cutscene|cinematic|timeline|sequence(?:r|player)?|playable|movie|videoplayer|intro|outro/i,
  special_states: /pause|loading|loadscreen|death|dead|respawn|gameover|vehicle|car|drive|driving|mount|ride|boat|plane|ladder|climb|swim/i,
} as const;

export type Category = keyof typeof CATEGORIES;

export interface Candidate {
  name: string;
  kind: string;
  status: Status;
  evidence: string;
  hooks?: string[];
}

export interface GameMap {
  family: EngineFamily | null;
  method: string;
  categories: Record<Category, Candidate[]>;
  extra: Record<string, unknown>;
  limits: string[];
  nextSteps: string[];
}

function emptyCats(): Record<Category, Candidate[]> {
  return { camera: [], player: [], held_object: [], input: [], hud_menus: [], cutscenes: [], special_states: [] };
}

/** Frequent false positives: "Spawn" contains "pawn", "Tooltip" contains "tool"… */
const EXCLUDE: Partial<Record<Category, RegExp>> = {
  player: /spawn(?!.*(?:player|character))/i,
  held_object: /tool(?:tip|bar|kit)|toolbox|spawn/i,
  input: /^(?!.*(?:input|key|bind|joystick|gamepad|rewired)).*controlmap/i,
};

function classify(name: string): Category[] {
  return (Object.keys(CATEGORIES) as Category[]).filter((c) => CATEGORIES[c].test(name) && !(EXCLUDE[c]?.test(name) ?? false));
}

function push(cats: Record<Category, Candidate[]>, c: Candidate, limit = 25) {
  for (const cat of classify(c.name)) if (cats[cat].length < limit && !cats[cat].some((x) => x.name === c.name)) cats[cat].push(c);
}

const UNITY_HOOK_METHODS = new Set(["Update", "LateUpdate", "FixedUpdate", "OnGUI", "Awake", "Start", "OnEnable", "OnPreRender", "OnPostRender"]);

function mapUnityMono(gamePath: string): GameMap {
  const scan = scanGame(gamePath);
  const cats = emptyCats();
  const limits: string[] = [];
  const extra: Record<string, unknown> = {};
  const asmRel = findFiles(scan, /_data\/managed\/assembly-csharp\.dll$/, 1)[0];
  const managed = findFiles(scan, /_data\/managed\/[^/]+\.dll$/, 400).map((f) => path.posix.basename(f));
  extra.inputSystem = managed.some((m) => /^unity\.inputsystem\.dll$/i.test(m)) ? "Nouveau Input System (Unity.InputSystem.dll)" : managed.some((m) => /^rewired_core\.dll$/i.test(m)) ? "Rewired (Rewired_Core.dll)" : "Ancien Input Manager (probable)";
  extra.renderPipeline = managed.some((m) => /^unity\.renderpipelines\.high-definition/i.test(m)) ? "HDRP" : managed.some((m) => /^unity\.renderpipelines\.universal/i.test(m)) ? "URP" : "Built-in (probable)";
  extra.xrModules = managed.filter((m) => /xr|openxr|openvr|oculus/i.test(m));
  if (!asmRel) {
    limits.push("Assembly-CSharp.dll absent : code du jeu dans d'autres assemblies, voir la liste Managed/.");
  } else {
    try {
      const asm = readAssembly(abs(scan, asmRel));
      extra.typeCount = asm.types.length;
      for (const t of asm.types) {
        if (!t.name || t.name === "<Module>") continue;
        const base = rootBase(asm, t) ?? "";
        const isBehaviour = /UnityEngine\.(?:MonoBehaviour|Behaviour|Component)/.test(base);
        const full = t.namespace ? `${t.namespace}.${t.name}` : t.name;
        push(cats, {
          name: full,
          kind: isBehaviour ? `MonoBehaviour (base : ${t.baseType})` : `classe (base : ${t.baseType ?? "—"})`,
          status: "observed",
          evidence: `TypeDef lu dans ${asmRel}`,
          hooks: t.methods.filter((m) => UNITY_HOOK_METHODS.has(m)),
        });
      }
    } catch (e) {
      limits.push(`Lecture des métadonnées impossible (${(e as Error).message}) : assembly protégée ou obfusquée → utiliser REA ou ILSpy.`);
    }
  }
  return {
    family: "unity_mono",
    method: "Lecture statique des métadonnées .NET d'Assembly-CSharp.dll",
    categories: cats,
    extra,
    limits: [...limits, "Le rôle de chaque classe est déduit de son nom : confirmer avec UnityExplorer en jeu."],
    nextSteps: ["Confirmer les classes caméra/joueur avec UnityExplorer", "Générer le plugin avec scaffold_unity_plugin en passant les classes retenues"],
  };
}

async function mapUnityIl2cpp(gamePath: string): Promise<GameMap> {
  const scan = scanGame(gamePath);
  const cats = emptyCats();
  const limits: string[] = [];
  const extra: Record<string, unknown> = {};
  const metaRel = findFiles(scan, /il2cpp_data\/metadata\/global-metadata\.dat$/, 1)[0];
  if (!metaRel) {
    limits.push("global-metadata.dat introuvable : métadonnées intégrées ou déplacées (protection probable).");
  } else {
    const file = abs(scan, metaRel);
    const head = await readRange(file, 0, 64);
    const sanity = head.length >= 32 ? head.readUInt32LE(0) : 0;
    if (sanity !== 0xfab11baf) {
      limits.push("Signature de global-metadata.dat absente : fichier chiffré ou modifié → métadonnées illisibles (signal metadata_unreadable).");
      extra.metadataReadable = false;
    } else {
      extra.metadataReadable = true;
      extra.metadataVersion = head.readUInt32LE(4);
      const strOff = head.readUInt32LE(24);
      const strSize = head.readUInt32LE(28);
      const size = fs.statSync(file).size;
      if (strOff > 0 && strSize > 0 && strOff + strSize <= size) {
        const buf = await readRange(file, strOff, Math.min(strSize, 64 * 1024 * 1024));
        const ids = [...new Set(identifiersFrom(buf, 4))];
        extra.identifierCount = ids.length;
        for (const id of ids) {
          if (!/^[A-Z]/.test(id)) continue;
          push(cats, { name: id, kind: "identifiant (type, méthode ou champ)", status: "deduced", evidence: `table de chaînes de ${metaRel}` });
        }
      } else {
        limits.push("Table de chaînes non localisée dans l'en-tête (version de métadonnées inhabituelle).");
      }
    }
  }
  return {
    family: "unity_il2cpp",
    method: "Table de chaînes de global-metadata.dat (identifiants, sans structure de classes)",
    categories: cats,
    extra,
    limits: [...limits, "Pour les classes et méthodes exactes : Cpp2IL ou Il2CppDumper, ou l'analyseur IL2CPP de REA."],
    nextSteps: ["Reconstruire les DLL factices (Cpp2IL) pour obtenir les vraies classes", "Confirmer en jeu avec UnityExplorer (build IL2CPP)"],
  };
}

function mapUnreal(gamePath: string): GameMap {
  const scan = scanGame(gamePath);
  const cats = emptyCats();
  const paks = findFiles(scan, /\/content\/paks\/[^/]+\.(?:pak|utoc|ucas|sig)$/, 200);
  const exe = findFiles(scan, /-(?:win64|wingdk)-shipping\.exe$/, 1)[0];
  const extra: Record<string, unknown> = {
    paks: paks.filter((p) => p.endsWith(".pak")).slice(0, 30),
    ioStore: paks.some((p) => p.endsWith(".utoc")),
    signedPaks: paks.some((p) => p.endsWith(".sig")),
  };
  if (exe) {
    const modules = scanFile(abs(scan, exe), /\/Script\/[A-Za-z_][A-Za-z0-9_]{2,60}/, { maxMatches: 400, maxBytes: 768 * 1024 * 1024 });
    const own = modules.filter((m) => !/^\/Script\/(?:Engine|CoreUObject|UMG|Slate\w*|InputCore|EnhancedInput|AIModule|NavigationSystem|GameplayTags|GameplayTasks|MovieScene\w*|LevelSequence|Niagara\w*|Chaos\w*|PhysicsCore|AudioMixer|MediaAssets|OnlineSubsystem\w*|DeveloperSettings|NetCore|Landscape|Foliage|CinematicCamera|HeadMountedDisplay|XRBase|OpenXR\w*|OculusXR\w*|SteamVR\w*)$/.test(m));
    extra.gameModules = own.slice(0, 40);
    extra.enhancedInput = modules.includes("/Script/EnhancedInput");
    extra.sequencer = modules.some((m) => /LevelSequence|MovieScene/.test(m));
    const classes = scanFile(abs(scan, exe), /\b[A-Z][A-Za-z0-9]*(?:Camera(?:Manager|Component|Actor)?|Character|Pawn|PlayerController|Weapon|HUD|Widget|Cinematic|Vehicle)\b/, { maxMatches: 300, maxBytes: 768 * 1024 * 1024 });
    for (const c of classes) push(cats, { name: c, kind: "nom de classe C++ présent dans l'exécutable", status: "deduced", evidence: `chaîne trouvée dans ${exe}` });
  }
  return {
    family: "unreal",
    method: "Modules /Script/ et noms de classes C++ dans l'exécutable (les Blueprints sont dans les .pak)",
    categories: cats,
    extra,
    limits: [
      "Les classes Blueprint (souvent l'arme, le HUD, le joueur réel) sont dans les .pak, chiffrés ou compressés : non listées ici.",
      "Cartographie complète : dump du SDK avec RE-UE4SS ou Dumper-7, ou exploration en direct avec le menu UEVR (UObjectHook).",
    ],
    nextSteps: ["Lancer le jeu avec UEVR, ouvrir UObjectHook, attacher l'arme à la main droite", "Si besoin, installer RE-UE4SS (install_tool_plan ue4ss) et générer les en-têtes"],
  };
}

function mapGodot(gamePath: string): GameMap {
  const scan = scanGame(gamePath);
  const cats = emptyCats();
  const limits: string[] = [];
  const extra: Record<string, unknown> = {};
  const targets = [...findFiles(scan, /\.pck$/, 5), ...findFiles(scan, /\.exe$/, 5)];
  let info = null as ReturnType<typeof readPck>;
  let from = "";
  for (const t of targets) {
    info = readPck(abs(scan, t));
    if (info) {
      from = t;
      break;
    }
  }
  if (!info) {
    limits.push("Aucun PCK Godot lisible trouvé.");
  } else {
    extra.pck = { file: from, format: info.formatVersion, godot: info.godotVersion, embedded: info.embedded, encrypted: info.encryptedDirectory, files: info.fileCount };
    if (info.note) limits.push(info.note);
    const interesting = info.paths.filter((p) => /\.(?:tscn|scn|gd|gdc|cs|remap|tres)$/i.test(p));
    extra.projectGodot = info.paths.some((p) => /project\.(?:godot|binary)$/i.test(p));
    for (const p of interesting) push(cats, { name: p, kind: "ressource Godot", status: "observed", evidence: `index du PCK ${from}` });
  }
  return {
    family: "godot",
    method: "Index du fichier PCK (chemins des scènes et scripts)",
    categories: cats,
    extra,
    limits: [...limits, "Pour modifier : récupérer le projet avec GDRE Tools dans un dossier VRA, jamais dans le jeu."],
    nextSteps: ["install_tool_plan gdre-tools", "Récupérer le projet, puis scaffold_godot_xr sur le dossier récupéré"],
  };
}

function mapSource(gamePath: string): GameMap {
  const scan = scanGame(gamePath);
  const cats = emptyCats();
  const extra: Record<string, unknown> = {};
  const gi = findFiles(scan, /(?:^|\/)gameinfo\.txt$/, 5);
  extra.gameinfo = gi.map((g) => {
    try {
      const t = fs.readFileSync(abs(scan, g), "utf8");
      const game = /^\s*game\s+"?([^"\r\n]+)"?/im.exec(t)?.[1] ?? null;
      const appid = /SteamAppId\s+(\d+)/i.exec(t)?.[1] ?? null;
      return { file: g, game, steamAppId: appid };
    } catch {
      return { file: g };
    }
  });
  extra.vrFolders = scan.dirs.filter((d) => /(?:^|\/)[^/]*vr[^/]*$/i.test(d) && d.split("/").length <= 2);
  return {
    family: "source1",
    method: "gameinfo.txt et dossiers de mods",
    categories: cats,
    extra,
    limits: ["Le code d'un jeu Source n'est modifiable que via le Source SDK public (jeux basés sur HL2) : sinon, s'appuyer sur un mod VR existant."],
    nextSteps: ["Chercher un mod VR existant (vr-scout)", "Vérifier la compatibilité Source SDK 2013"],
  };
}

function mapGeneric(gamePath: string, family: EngineFamily | null): GameMap {
  const scan = scanGame(gamePath);
  const cats = emptyCats();
  const exe = findFiles(scan, /\.exe$/, 1)[0];
  if (exe) {
    const names = scanFile(abs(scan, exe), /\b[A-Z][A-Za-z0-9_]{3,40}(?:Camera|Player|Weapon|Hud|HUD|Menu|Cutscene|Vehicle|Input)[A-Za-z0-9_]{0,20}\b/, { maxMatches: 200, maxBytes: 256 * 1024 * 1024 });
    for (const n of names) push(cats, { name: n, kind: "chaîne de l'exécutable", status: "deduced", evidence: `chaîne trouvée dans ${exe}` });
  }
  return {
    family,
    method: "Chaînes de l'exécutable (heuristique faible)",
    categories: cats,
    extra: {},
    limits: [
      "Sans moteur connu, les noms trouvés ne prouvent rien : analyse native avec REA (Ghidra/IDA en lecture seule) pour aller plus loin.",
      "Recherche des matrices de vue/projection : uniquement via inspection en direct, en dernier recours.",
    ],
    nextSteps: ["Chercher un mod VR dédié en ligne", "Si le jeu en vaut la peine : REA + live_inspect (solo, sans anti-cheat)"],
  };
}

export async function mapGame(gamePath: string, family: EngineFamily | null): Promise<GameMap> {
  switch (family) {
    case "unity_mono":
      return mapUnityMono(gamePath);
    case "unity_il2cpp":
      return mapUnityIl2cpp(gamePath);
    case "unreal":
      return mapUnreal(gamePath);
    case "godot":
      return mapGodot(gamePath);
    case "source1":
      return mapSource(gamePath);
    case "re_engine":
      return {
        family,
        method: "Inspection en jeu (REFramework Object Explorer)",
        categories: emptyCats(),
        extra: {},
        limits: ["Les types RE Engine se lisent en direct : installer REFramework, activer le mode développeur, ouvrir Object Explorer."],
        nextSteps: ["install_tool_plan reframework", "scaffold_reframework_script avec les types trouvés"],
      };
    case "creation":
      return {
        family,
        method: "Écosystème Bethesda (extenders de scripts, mods)",
        categories: emptyCats(),
        extra: {},
        limits: ["Cartographie via les extenders (SKSE/F4SE et variantes VR) et les mods existants, pas par lecture des fichiers."],
        nextSteps: ["Vérifier l'édition VR officielle", "Chercher les mods VR via un gestionnaire à système de fichiers virtuel"],
      };
    case "opensource_port":
    case "java":
    case "2d":
    case "emulator":
      return { family, method: "Aucune cartographie utile", categories: emptyCats(), extra: {}, limits: ["Le source port ou l'outil existant fait déjà le travail, ou le jeu n'a pas de 3D exploitable."], nextSteps: [] };
    default:
      return mapGeneric(gamePath, family);
  }
}
