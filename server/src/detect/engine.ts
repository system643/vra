import fs from "node:fs";
import path from "node:path";
import { type Claim, type EngineFamily, type Evidence, deduced, observed, unknown } from "../types.js";
import { type GameScan, abs, findDirs, findFiles, pickMainExe, scanGame } from "./scan.js";
import { matchRules, type SteamDbMatch } from "./steamdb.js";
import { scanFile, fileVersionOf } from "../util/strings.js";
import { readHead } from "../util/fsx.js";
import { tryReadPe } from "../util/pe.js";
import { readPck } from "../map/godot.js";

export interface EngineCandidate {
  family: EngineFamily;
  name: string;
  evidence: Evidence[];
  /** Higher wins when several families match. */
  priority: number;
}

export interface EngineDetection {
  gamePath: string;
  family: Claim<EngineFamily>;
  engine: Claim<string>;
  version: Claim<string>;
  runtimeVariant: Claim<string>;
  gameIdentity: Claim<string>;
  mainExe: Claim<string>;
  architecture: Claim<string>;
  storefront: Claim<string>;
  candidates: Array<{ family: EngineFamily; name: string; evidence: Evidence[] }>;
  steamdb: SteamDbMatch[];
  scanTruncated: boolean;
}

const AAA_ENGINES = new Set(
  [
    "RAGE", "REDengine", "Decima", "Frostbite", "AnvilNext", "Anvil", "Snowdrop", "Dunia", "Glacier", "Foundation",
    "IW", "IW_Engine", "Northlight", "Luminous", "Fox", "FoxEngine", "ForgeLight", "Disrupt", "Ego", "Apex", "Asura",
    "Bitsquid", "Stingray", "CryEngine", "Amazon_Lumberyard", "Dagor", "Chrome", "ChromeEngine", "4A_Engine", "Clausewitz",
    "Jade", "Void", "idTech", "Havok_Vision", "Vicious", "X-Ray", "Unigine", "Saber", "Kinetica", "Avalanche",
  ].map((n) => n.toLowerCase()),
);

const RE_ENGINE_GAMES: Record<string, string> = {
  re2: "Resident Evil 2 (remake)",
  re3: "Resident Evil 3 (remake)",
  re4: "Resident Evil 4 (remake)",
  re7: "Resident Evil 7",
  re8: "Resident Evil Village",
  devilmaycry5: "Devil May Cry 5",
  monsterhunterrise: "Monster Hunter Rise",
  monsterhunterwilds: "Monster Hunter Wilds",
  streetfighter6: "Street Fighter 6",
  dd2: "Dragon's Dogma 2",
  dragonsdogma2: "Dragon's Dogma 2",
};

const EMULATORS: Array<[RegExp, string]> = [
  [/(?:^|\/)dolphin(?:-[^/]*)?\.exe$/, "Dolphin (GameCube/Wii)"],
  [/(?:^|\/)pcsx2[^/]*\.exe$/, "PCSX2 (PS2)"],
  [/(?:^|\/)duckstation[^/]*\.exe$/, "DuckStation (PS1)"],
  [/(?:^|\/)rpcs3\.exe$/, "RPCS3 (PS3)"],
  [/(?:^|\/)ppsspp[^/]*\.exe$/, "PPSSPP (PSP)"],
  [/(?:^|\/)cemu\.exe$/, "Cemu (Wii U)"],
  [/(?:^|\/)xemu\.exe$/, "xemu (Xbox)"],
  [/(?:^|\/)xenia[^/]*\.exe$/, "Xenia (Xbox 360)"],
  [/(?:^|\/)retroarch\.exe$/, "RetroArch"],
  [/(?:^|\/)flycast\.exe$/, "Flycast (Dreamcast)"],
  [/(?:^|\/)redream\.exe$/, "Redream (Dreamcast)"],
  [/(?:^|\/)mame[^/]*\.exe$/, "MAME"],
];

function ev(kind: Evidence["kind"], detail: string, p?: string): Evidence {
  return p ? { kind, detail, path: p } : { kind, detail };
}

function collectCandidates(scan: GameScan, steamdb: SteamDbMatch[]): EngineCandidate[] {
  const c: EngineCandidate[] = [];
  const has = (re: RegExp) => findFiles(scan, re, 3);
  const hasDir = (re: RegExp) => findDirs(scan, re, 3);

  // Unreal Engine 4/5
  const ueExe = has(/-(?:win64|wingdk|wins|win32)-shipping\.exe$/);
  const uePak = has(/\/content\/paks\/[^/]+\.(?:pak|utoc|ucas)$/);
  const ueThird = hasDir(/(?:^|\/)engine\/binaries\/thirdparty$/);
  if (ueExe.length || uePak.length || ueThird.length) {
    c.push({
      family: "unreal",
      name: "Unreal Engine 4/5",
      priority: 100,
      evidence: [
        ...ueExe.map((f) => ev("file", "exécutable Unreal *-Shipping.exe", f)),
        ...uePak.map((f) => ev("file", "archive Unreal dans Content/Paks", f)),
        ...ueThird.map((d) => ev("file", "dossier Engine/Binaries/ThirdParty", d)),
      ].slice(0, 4),
    });
  }
  // Unreal Engine 1–3
  const upk = has(/\.(?:upk|u|xxx)$/);
  const cooked = hasDir(/(?:^|\/)cooked(?:pc|pcconsole|win64)$/);
  if (!ueExe.length && !uePak.length && (upk.length || cooked.length)) {
    c.push({
      family: "unreal_legacy",
      name: "Unreal Engine 3 ou antérieur",
      priority: 90,
      evidence: [...upk.map((f) => ev("file", "paquet Unreal ancien (.upk/.u)", f)), ...cooked.map((d) => ev("file", "dossier CookedPC", d))].slice(0, 4),
    });
  }
  // Unity
  const unityPlayer = has(/(?:^|\/)unityplayer\.dll$/);
  const ggm = has(/_data\/(?:globalgamemanagers|data\.unity3d|globalgamemanagers\.assets)$/);
  if (unityPlayer.length || ggm.length) {
    const il2cpp = [...has(/(?:^|\/)gameassembly\.dll$/), ...has(/il2cpp_data\/metadata\/global-metadata\.dat$/)];
    const mono = [...has(/_data\/managed\/assembly-csharp\.dll$/), ...has(/_data\/managed\/unityengine(?:\.coremodule)?\.dll$/)];
    const base = [...unityPlayer.map((f) => ev("file", "UnityPlayer.dll", f)), ...ggm.map((f) => ev("file", "données Unity *_Data", f))].slice(0, 2);
    if (il2cpp.length) {
      c.push({ family: "unity_il2cpp", name: "Unity (IL2CPP)", priority: 95, evidence: [...base, ...il2cpp.map((f) => ev("file", "marqueur IL2CPP", f))].slice(0, 4) });
    } else if (mono.length) {
      c.push({ family: "unity_mono", name: "Unity (Mono)", priority: 95, evidence: [...base, ...mono.map((f) => ev("file", "assemblies .NET Mono", f))].slice(0, 4) });
    } else {
      c.push({ family: "unity_mono", name: "Unity (variante inconnue)", priority: 80, evidence: base });
    }
  }
  // RE Engine
  const reChunk = has(/(?:^|\/)re_chunk_000\.pak$/);
  if (reChunk.length) c.push({ family: "re_engine", name: "RE Engine (Capcom)", priority: 95, evidence: reChunk.map((f) => ev("file", "re_chunk_000.pak", f)) });
  // Source 2 / Source 1
  const gi2 = has(/(?:^|\/)gameinfo\.gi$/);
  if (gi2.length) c.push({ family: "source2", name: "Source 2", priority: 92, evidence: gi2.map((f) => ev("file", "gameinfo.gi", f)) });
  const gi1 = has(/(?:^|\/)gameinfo\.txt$/);
  const srcBin = has(/(?:^|\/)bin\/(?:engine|vphysics)\.dll$/);
  if (!gi2.length && (gi1.length || srcBin.length)) {
    c.push({ family: "source1", name: "Source", priority: 88, evidence: [...gi1, ...srcBin].slice(0, 3).map((f) => ev("file", "fichier Source", f)) });
  }
  // Creation Engine / Gamebryo
  const esm = has(/\.esm$/);
  const ba = has(/\.(?:bsa|ba2)$/);
  if (esm.length && ba.length) {
    c.push({ family: "creation", name: "Creation Engine / Gamebryo (Bethesda)", priority: 90, evidence: [...esm.slice(0, 2), ...ba.slice(0, 1)].map((f) => ev("file", "données Bethesda", f)) });
  }
  // Godot
  const pcks = has(/\.pck$/);
  const godotSharp = has(/(?:^|\/)godotsharp\.dll$/);
  let godotEvidence: Evidence[] = [];
  for (const p of pcks) {
    const info = readPck(abs(scan, p), 0);
    if (info) {
      godotEvidence.push(ev("metadata", `PCK Godot (format ${info.formatVersion}, moteur ${info.godotVersion})`, p));
      break;
    }
  }
  if (!godotEvidence.length) {
    for (const e of findFiles(scan, /\.exe$/, 6)) {
      const info = readPck(abs(scan, e), 0);
      if (info) {
        godotEvidence.push(ev("metadata", `PCK Godot intégré à l'exécutable (moteur ${info.godotVersion})`, e));
        break;
      }
    }
  }
  if (godotSharp.length) godotEvidence.push(ev("file", "GodotSharp.dll", godotSharp[0]));
  if (godotEvidence.length) c.push({ family: "godot", name: "Godot", priority: 90, evidence: godotEvidence });
  // Java / Minecraft
  const mc = [...has(/(?:^|\/)\.minecraft\//), ...has(/(?:^|\/)minecraft(?:launcher)?\.(?:exe|jar)$/), ...has(/(?:^|\/)versions\/[^/]+\/[^/]+\.jar$/)];
  const jars = has(/\.jar$/);
  if (mc.length) c.push({ family: "java", name: "Java (Minecraft Java Edition)", priority: 85, evidence: mc.slice(0, 3).map((f) => ev("file", "fichier Minecraft Java", f)) });
  else if (jars.length && has(/(?:^|\/)(?:jre|jdk|java)[^/]*\/bin\/javaw?\.exe$/).length) {
    c.push({ family: "java", name: "Java (LWJGL ou autre)", priority: 60, evidence: jars.slice(0, 2).map((f) => ev("file", "archive Java", f)) });
  }
  // Open-source-port games (id Tech 1–4, Build, Wolf3D)
  const ports: Array<[RegExp, string]> = [
    [/(?:^|\/)id1\/pak0\.pak$/, "quake"],
    [/(?:^|\/)baseq2\/pak0\.pak$/, "quake2"],
    [/(?:^|\/)baseq3\/pak0\.pk3$/, "quake3"],
    [/(?:^|\/)(?:doom|doom2|plutonia|tnt|doomu|freedoom\d?)\.wad$/, "doom"],
    [/(?:^|\/)(?:heretic|hexen)\.wad$/, "heretic_hexen"],
    [/(?:^|\/)base\/pak000\.pk4$/, "doom3"],
    [/(?:^|\/)duke3d\.grp$/, "duke3d"],
    [/(?:^|\/)vswap\.wl6$/, "wolf3d"],
  ];
  for (const [re, id] of ports) {
    const f = has(re);
    if (f.length) {
      c.push({ family: "opensource_port", name: `Jeu à moteur libéré (${id})`, priority: 86, evidence: [ev("file", `données de ${id}`, f[0])] });
      break;
    }
  }
  // 2D engines
  const gm = has(/(?:^|\/)data\.win$/);
  const rpg = [...has(/(?:^|\/)js\/(?:rpg|rmmz)_core\.js$/), ...has(/\.(?:rgss3a|rgss2a|rgssad)$/), ...has(/(?:^|\/)rpg_rt\.(?:exe|ini)$/)];
  const renpy = [...hasDir(/(?:^|\/)renpy$/), ...has(/\.rpa$/)];
  if (gm.length) c.push({ family: "2d", name: "GameMaker", priority: 70, evidence: [ev("file", "data.win (GameMaker)", gm[0])] });
  if (rpg.length) c.push({ family: "2d", name: "RPG Maker", priority: 70, evidence: [ev("file", "fichier RPG Maker", rpg[0])] });
  if (renpy.length) c.push({ family: "2d", name: "Ren'Py", priority: 70, evidence: [ev("file", "Ren'Py", renpy[0])] });
  // Emulators
  for (const [re, name] of EMULATORS) {
    const f = has(re);
    if (f.length) {
      c.push({ family: "emulator", name, priority: 75, evidence: [ev("file", `exécutable de ${name}`, f[0])] });
      break;
    }
  }
  // SteamDB engine guesses not covered above → proprietary/other engine
  const known = new Set(["unity", "unreal", "re_engine", "source", "source2", "godot", "gamemaker", "rpgmaker", "renpy"]);
  for (const m of steamdb.filter((x) => x.section === "Engine")) {
    const key = m.name.toLowerCase();
    if (known.has(key)) continue;
    const family: EngineFamily = AAA_ENGINES.has(key) ? "aaa_proprietary" : "unknown";
    c.push({ family, name: m.name.replace(/_/g, " "), priority: family === "aaa_proprietary" ? 65 : 40, evidence: [{ kind: "rule", detail: `règle SteamDB Engine.${m.name} (supposition)`, path: m.file }] });
  }
  return c.sort((a, b) => b.priority - a.priority);
}

async function unrealVersion(scan: GameScan, exeRel: string | null): Promise<Claim<string>> {
  if (!exeRel) return unknown("exécutable Unreal non trouvé");
  const exePath = abs(scan, exeRel);
  const hits = scanFile(exePath, /\+\+UE[45]\+Release-[45]\.\d+/, { maxMatches: 3 });
  if (hits.length) {
    const v = hits[0].replace(/^\+\+UE[45]\+Release-/, "");
    return observed(v, [ev("string", `chaîne « ${hits[0]} » dans l'exécutable`, exeRel)]);
  }
  const fv = fileVersionOf(exePath);
  if (fv && /^[45]\.\d+/.test(fv)) return deduced(fv.split(".").slice(0, 2).join("."), [ev("metadata", `FileVersion ${fv}`, exeRel)], "version de fichier, souvent égale à la version du moteur");
  return unknown("aucune chaîne de version Unreal trouvée (exécutable compressé ou version personnalisée)");
}

async function unityVersion(scan: GameScan): Promise<Claim<string>> {
  const re = /(?:6000|20\d\d|5)\.\d{1,2}\.\d{1,3}[abfpx]\d{1,3}/;
  for (const rel of findFiles(scan, /_data\/(?:globalgamemanagers|data\.unity3d|mainData|unity default resources)$/, 4)) {
    try {
      const head = await readHead(abs(scan, rel), 64 * 1024);
      const m = re.exec(head.toString("latin1"));
      if (m) return observed(m[0], [ev("string", `version lue dans ${path.posix.basename(rel)}`, rel)]);
    } catch {
      /* next */
    }
  }
  const up = findFiles(scan, /(?:^|\/)unityplayer\.dll$/, 1)[0];
  if (up) {
    const fv = fileVersionOf(abs(scan, up));
    if (fv) return deduced(fv, [ev("metadata", `FileVersion de UnityPlayer.dll`, up)], "numéro de build, proche de la version Unity");
  }
  return unknown("version Unity non trouvée");
}

function identity(scan: GameScan, family: EngineFamily, exeRel: string | null): Claim<string> {
  const stem = exeRel ? path.posix.basename(exeRel).replace(/\.exe$/i, "").toLowerCase() : "";
  if (family === "re_engine") {
    const key = Object.keys(RE_ENGINE_GAMES).find((k) => stem === k || stem.startsWith(k));
    if (key) return observed(key, [ev("file", `exécutable ${exeRel} → ${RE_ENGINE_GAMES[key]}`, exeRel ?? undefined)]);
  }
  if (family === "creation") {
    const table: Array<[RegExp, string]> = [
      [/(?:^|\/)skyrimvr\.exe$/, "skyrim_vr"],
      [/(?:^|\/)fallout4vr\.exe$/, "fallout4_vr"],
      [/(?:^|\/)skyrim\.esm$/, "skyrim"],
      [/(?:^|\/)fallout4\.esm$/, "fallout4"],
      [/(?:^|\/)starfield\.esm$/, "starfield"],
      [/(?:^|\/)falloutnv\.esm$/, "fallout_nv"],
      [/(?:^|\/)fallout3\.esm$/, "fallout3"],
      [/(?:^|\/)oblivion\.esm$/, "oblivion"],
      [/(?:^|\/)morrowind\.esm$/, "morrowind"],
    ];
    for (const [re, id] of table) {
      const f = findFiles(scan, re, 1);
      if (f.length) return observed(id, [ev("file", "fichier d'identification Bethesda", f[0])]);
    }
  }
  if (family === "opensource_port" || family === "emulator" || family === "java") return unknown("voir la famille détectée");
  if (stem) return deduced(stem, [ev("file", "nom de l'exécutable principal", exeRel ?? undefined)]);
  return unknown("identité du jeu non établie");
}

function storefront(scan: GameScan): Claim<string> {
  const root = scan.root.replace(/\\/g, "/").toLowerCase();
  if (root.includes("/windowsapps/") || findFiles(scan, /(?:^|\/)microsoftgame\.config$/, 1).length || findFiles(scan, /-wingdk-shipping\.exe$/, 1).length) {
    return observed("game_pass", [ev("file", "dossier WindowsApps, MicrosoftGame.config ou exécutable WinGDK")], "accès en écriture souvent restreint");
  }
  const steam = findFiles(scan, /(?:^|\/)(?:steam_api(?:64)?\.dll|steam_appid\.txt)$/, 1);
  if (steam.length) return observed("steam", [ev("file", "bibliothèque Steam", steam[0])]);
  if (findDirs(scan, /(?:^|\/)\.egstore$/, 1).length) return observed("epic", [ev("file", "dossier .egstore (Epic)")]);
  const gog = findFiles(scan, /(?:^|\/)goggame-\d+\.(?:info|dll)$/, 1);
  if (gog.length) return observed("gog", [ev("file", "fichier GOG", gog[0])]);
  return unknown("lanceur non identifié");
}

export async function detectEngine(gamePath: string): Promise<EngineDetection> {
  const scan = scanGame(gamePath);
  const steamdb = matchRules(scan.files);
  const cands = collectCandidates(scan, steamdb);
  const main = pickMainExe(scan);
  const mainExe: Claim<string> = main.exe
    ? (main.reason.includes("déduction") ? deduced(main.exe, [ev("file", main.reason, main.exe)]) : observed(main.exe, [ev("file", main.reason, main.exe)]))
    : unknown(main.reason);
  const pe = main.exe ? tryReadPe(abs(scan, main.exe)) : null;
  const architecture: Claim<string> = pe ? observed(pe.machine, [ev("metadata", "en-tête PE de l'exécutable principal", main.exe ?? undefined)]) : unknown("architecture non lue");

  const top = cands[0];
  let family: Claim<EngineFamily>;
  let engine: Claim<string>;
  let version: Claim<string> = unknown("version non recherchée pour cette famille");
  let runtimeVariant: Claim<string> = unknown("sans objet ou non établi");
  if (!top) {
    family = unknown<EngineFamily>("aucune signature de moteur reconnue");
    engine = unknown("moteur inconnu : lire les imports graphiques et chercher le jeu en ligne");
  } else {
    const fromRule = top.evidence.every((e) => e.kind === "rule");
    family = fromRule ? deduced(top.family, top.evidence) : observed(top.family, top.evidence);
    engine = fromRule ? deduced(top.name, top.evidence) : observed(top.name, top.evidence);
    if (top.family === "unreal") {
      version = await unrealVersion(scan, main.exe);
      runtimeVariant = main.exe && /-wingdk-/i.test(main.exe) ? observed("wingdk", [ev("file", "exécutable -WinGDK- (Game Pass)", main.exe)]) : main.exe ? observed("win64", [ev("file", "exécutable -Win64-", main.exe)]) : unknown("exécutable non trouvé");
    } else if (top.family === "unity_mono" || top.family === "unity_il2cpp") {
      version = await unityVersion(scan);
      runtimeVariant = top.name.includes("inconnue") ? unknown("ni Managed/ ni GameAssembly.dll trouvés") : observed(top.family === "unity_il2cpp" ? "il2cpp" : "mono", top.evidence);
    } else if (top.family === "godot") {
      const m = /moteur ([\d.]+)/.exec(top.evidence[0]?.detail ?? "");
      version = m ? observed(m[1], [top.evidence[0]]) : unknown("version Godot non lue");
      runtimeVariant = findFiles(scan, /(?:^|\/)godotsharp\.dll$/, 1).length ? observed("csharp", [ev("file", "GodotSharp.dll")]) : deduced("gdscript", [ev("reasoning", "pas de GodotSharp.dll")]);
    }
  }
  return {
    gamePath: scan.root,
    family,
    engine,
    version,
    runtimeVariant,
    gameIdentity: identity(scan, top?.family ?? "unknown", main.exe),
    mainExe,
    architecture,
    storefront: storefront(scan),
    candidates: cands.map(({ family: f, name, evidence }) => ({ family: f, name, evidence })),
    steamdb,
    scanTruncated: scan.truncated,
  };
}

export function exeDir(scan: GameScan, exeRel: string | null): string {
  return exeRel ? path.dirname(abs(scan, exeRel)) : scan.root;
}

export function existsRel(scan: GameScan, rel: string): boolean {
  return fs.existsSync(abs(scan, rel));
}
