import fs from "node:fs";
import path from "node:path";
import { type Claim, type Evidence, deduced, observed, unknown } from "../types.js";
import { findDirs, findFiles, scanGame } from "./scan.js";
import { matchRules } from "./steamdb.js";
import { detectEngine } from "./engine.js";

export interface AntiCheatDetection {
  present: Claim<boolean>;
  systems: string[];
  evidence: Evidence[];
  /** Whether injection, live inspection and online play with mods must be refused. */
  blocksInjection: boolean;
  notes: string[];
}

const LOCAL_RULES: Array<[RegExp, string, "file" | "dir"]> = [
  [/(?:^|\/)easyanticheat(?:_eos)?$/, "EasyAntiCheat", "dir"],
  [/(?:^|\/)start_protected_game\.exe$/, "EasyAntiCheat", "file"],
  [/(?:^|\/)easyanticheat[^/]*\.(?:exe|dll|sys)$/, "EasyAntiCheat", "file"],
  [/(?:^|\/)battleye$/, "BattlEye", "dir"],
  [/(?:^|\/)(?:beservice(?:_x64)?\.exe|beclient(?:_x64)?\.dll)$/, "BattlEye", "file"],
  [/_be\.exe$/, "BattlEye", "file"],
  [/(?:^|\/)gameguard$/, "nProtect GameGuard", "dir"],
  [/(?:^|\/)(?:xigncode|xigncode3)$/, "XIGNCODE3", "dir"],
  [/\.xem$/, "XIGNCODE3", "file"],
  [/(?:^|\/)equ8[^/]*$/, "EQU8", "file"],
  [/(?:^|\/)mhyprot\d?\.sys$|(?:^|\/)mhypbase\.dll$/, "mhyprot (HoYoverse)", "file"],
  [/(?:^|\/)(?:pnkbstra|pnkbstrb|pbsvc)\.exe$/, "PunkBuster", "file"],
  [/(?:^|\/)anticheatexpert$/, "Anti-Cheat Expert (Tencent)", "dir"],
  [/(?:^|\/)eaanticheat[^/]*$/, "EA Javelin Anticheat", "file"],
];

export async function detectAntiCheat(gamePath: string): Promise<AntiCheatDetection> {
  const scan = scanGame(gamePath);
  const evidence: Evidence[] = [];
  const systems = new Set<string>();
  for (const [re, name, kind] of LOCAL_RULES) {
    const hits = kind === "dir" ? findDirs(scan, re, 1) : findFiles(scan, re, 1);
    if (hits.length) {
      systems.add(name);
      evidence.push({ kind: "file", detail: `${name} : ${kind === "dir" ? "dossier" : "fichier"} trouvé`, path: hits[0] });
    }
  }
  for (const m of matchRules(scan.files, ["AntiCheat"])) {
    const name = m.name.replace(/_/g, " ");
    if (![...systems].some((s) => s.toLowerCase().replace(/\s/g, "").includes(name.toLowerCase().replace(/\s/g, "").slice(0, 8)))) {
      systems.add(name);
    }
    evidence.push({ kind: "rule", detail: `règle SteamDB AntiCheat.${m.name}`, path: m.file });
  }
  const notes: string[] = [];
  // Riot Vanguard is a system driver, not in the game folder.
  const vanguard = ["C:/Program Files/Riot Vanguard", "C:/Program Files (x86)/Riot Vanguard"].find((p) => fs.existsSync(p));
  if (vanguard) notes.push(`Riot Vanguard est installé sur ce PC (${vanguard}) : il protège les jeux Riot, pas forcément ce jeu.`);
  const det = await detectEngine(gamePath);
  if (det.family.value === "source1" || det.family.value === "source2") {
    notes.push("Les jeux Source multijoueur sont protégés par VAC côté serveur : aucun fichier ne le prouve. Considérer VAC comme possible tant que le jeu n'est pas confirmé solo.");
  }
  notes.push("L'anti-cheat peut aussi arriver avec une mise à jour : revérifier à chaque session.");
  if (systems.size) {
    return {
      present: observed(true, evidence),
      systems: [...systems],
      evidence,
      blocksInjection: true,
      notes: [
        "Garde-fou : aucune injection, aucune inspection en direct. Seul le niveau 0 (écran géant) est proposé.",
        ...notes,
      ],
    };
  }
  const exes = findFiles(scan, /\.exe$/, 200).map((e) => path.posix.basename(e).toLowerCase());
  if (exes.some((e) => e.includes("launcher"))) notes.push("Un lanceur d'éditeur est présent : il peut installer un anti-cheat au premier lancement.");
  return {
    present: deduced(false, [{ kind: "reasoning", detail: "aucun fichier d'anti-cheat connu dans le dossier du jeu" }], "absence de fichier ≠ absence prouvée : confirmer en ligne (PCGamingWiki, page Steam)"),
    systems: [],
    evidence,
    blocksInjection: false,
    notes,
  };
}

export function unknownAntiCheat(): Claim<boolean> {
  return unknown("anti-cheat non vérifié");
}
