import fs from "node:fs";
import path from "node:path";
import { walk, type WalkResult } from "../util/fsx.js";

export interface GameScan {
  root: string;
  files: string[];
  dirs: string[];
  lowerFiles: string[];
  lowerDirs: string[];
  truncated: boolean;
}

const cache = new Map<string, { at: number; scan: GameScan }>();

export function scanGame(gamePath: string, opts: { fresh?: boolean } = {}): GameScan {
  const root = path.resolve(gamePath);
  if (!fs.existsSync(root)) throw new Error(`Dossier introuvable : ${root}`);
  if (!fs.statSync(root).isDirectory()) throw new Error(`Ce n'est pas un dossier : ${root}`);
  const hit = cache.get(root);
  if (!opts.fresh && hit && Date.now() - hit.at < 60_000) return hit.scan;
  const w: WalkResult = walk(root);
  const scan: GameScan = {
    root,
    files: w.files,
    dirs: w.dirs,
    lowerFiles: w.files.map((f) => f.toLowerCase()),
    lowerDirs: w.dirs.map((d) => d.toLowerCase()),
    truncated: w.truncated,
  };
  cache.set(root, { at: Date.now(), scan });
  return scan;
}

export function findFiles(scan: GameScan, re: RegExp, limit = 50): string[] {
  const out: string[] = [];
  for (let i = 0; i < scan.files.length && out.length < limit; i++) {
    if (re.test(scan.lowerFiles[i])) out.push(scan.files[i]);
  }
  return out;
}

export function findDirs(scan: GameScan, re: RegExp, limit = 50): string[] {
  const out: string[] = [];
  for (let i = 0; i < scan.dirs.length && out.length < limit; i++) {
    if (re.test(scan.lowerDirs[i])) out.push(scan.dirs[i]);
  }
  return out;
}

export function abs(scan: GameScan, rel: string): string {
  return path.join(scan.root, ...rel.split("/"));
}

const HELPER_EXE =
  /(?:^|\/)(?:unitycrashhandler(?:32|64)?|crashreportclient|crashpad_handler|unins\d*|uninstall|vc_?redist[^/]*|dxsetup|dotnet[^/]*|ue4prereqsetup[^/]*|ueprereqsetup[^/]*|easyanticheat[^/]*|start_protected_game|beservice[^/]*|eac[^/]*launcher|launcher[^/]*helper|cefprocess|cef_?subprocess|steamerrorreporter[^/]*|ffmpeg|7za?|python[^/]*|setup|installer[^/]*|redist[^/]*|vrmirror[^/]*)\.exe$/;

/** Pick the most plausible main executable (relative path), with the reason. */
export function pickMainExe(scan: GameScan): { exe: string | null; reason: string; candidates: string[] } {
  const exes = scan.files.filter((f, i) => scan.lowerFiles[i].endsWith(".exe") && !HELPER_EXE.test(scan.lowerFiles[i]));
  const shipping = exes.filter((f) => /-(?:win64|wingdk|wins|win32)-shipping\.exe$/i.test(f));
  if (shipping.length) return { exe: shipping[0], reason: "exécutable Unreal « *-Shipping.exe »", candidates: exes.slice(0, 20) };
  const dataDirs = scan.dirs.filter((d) => /^[^/]+_data$/i.test(d));
  for (const d of dataDirs) {
    const stem = d.slice(0, -5);
    const exe = exes.find((e) => e.toLowerCase() === `${stem.toLowerCase()}.exe`);
    if (exe) return { exe, reason: `exécutable Unity à côté de « ${d}/ »`, candidates: exes.slice(0, 20) };
  }
  const rootExes = exes.filter((e) => !e.includes("/"));
  const pool = rootExes.length ? rootExes : exes.filter((e) => e.split("/").length <= 3);
  if (!pool.length) return { exe: null, reason: "aucun exécutable trouvé", candidates: [] };
  let best = pool[0];
  let bestSize = -1;
  for (const e of pool) {
    try {
      const s = fs.statSync(abs(scan, e)).size;
      if (s > bestSize) {
        best = e;
        bestSize = s;
      }
    } catch {
      /* ignore */
    }
  }
  return { exe: best, reason: "plus gros exécutable proche de la racine (déduction)", candidates: exes.slice(0, 20) };
}
