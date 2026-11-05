import fs from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { appData, localAppData, pluginRoot, profileDir, userProfileHome } from "./paths.js";
import { abs, findFiles, pickMainExe, scanGame } from "./detect/scan.js";
import { readJson, tailLines, timestamp } from "./util/fsx.js";

const execFileP = promisify(execFile);

/**
 * Test-loop evidence: logs per tool, mirror captures, in-game markers.
 * VRA never kills the game process.
 */

export interface LogSource {
  label: string;
  path: string;
  exists: boolean;
  modified?: string;
}

function newest(dir: string, re: RegExp): string | null {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => ({ f: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files[0]?.f ?? null;
  } catch {
    return null;
  }
}

function newestSubdirFile(base: string, sub: string, re: RegExp): string | null {
  try {
    const cands = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => newest(path.join(base, d.name, sub), re))
      .filter((x): x is string => !!x)
      .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return cands[0]?.f ?? null;
  } catch {
    return null;
  }
}

export function logSources(gamePath: string): LogSource[] {
  const scan = scanGame(gamePath);
  const main = pickMainExe(scan);
  const exeAbs = main.exe ? abs(scan, main.exe) : null;
  const exeDir = exeAbs ? path.dirname(exeAbs) : scan.root;
  const exeStem = exeAbs ? path.basename(exeAbs, ".exe") : "";
  const out: Array<{ label: string; path: string | null }> = [];

  // Unity Player.log via *_Data/app.info (company, product)
  const appInfo = findFiles(scan, /^[^/]+_data\/app\.info$/, 1)[0] ?? findFiles(scan, /_data\/app\.info$/, 1)[0];
  if (appInfo) {
    const [company, product] = fs.readFileSync(abs(scan, appInfo), "utf8").split(/\r?\n/);
    if (company && product) {
      const dir = path.join(userProfileHome(), "AppData", "LocalLow", company.trim(), product.trim());
      out.push({ label: "Unity Player.log", path: path.join(dir, "Player.log") });
      out.push({ label: "Unity Player-prev.log", path: path.join(dir, "Player-prev.log") });
    }
  }
  // Unreal: <Project>/Binaries/Win64/<exe> → %LOCALAPPDATA%/<Project>/Saved/Logs
  if (main.exe && /-shipping\.exe$/i.test(main.exe)) {
    const project = main.exe.split("/")[0];
    out.push({ label: "Unreal (LocalAppData)", path: newest(path.join(localAppData(), project, "Saved", "Logs"), /\.log$/i) });
    out.push({ label: "Unreal (dossier du jeu)", path: newest(path.join(scan.root, project, "Saved", "Logs"), /\.log$/i) });
  }
  out.push({ label: "BepInEx", path: path.join(exeDir, "BepInEx", "LogOutput.log") });
  out.push({ label: "UE4SS", path: path.join(exeDir, "UE4SS.log") });
  // REFramework writes re2_framework_log.txt next to the exe (same name for every game),
  // or under %APPDATA%/REFramework/<exe> when the game folder is not writable.
  out.push({ label: "REFramework", path: path.join(exeDir, "re2_framework_log.txt") });
  out.push({ label: "REFramework (précédent)", path: path.join(exeDir, "re2_framework_log.prev.txt") });
  if (exeStem) out.push({ label: "REFramework (AppData)", path: path.join(appData(), "REFramework", exeStem, "re2_framework_log.txt") });
  // UEVR: %APPDATA%/UnrealVRMod/<exe stem>/log.txt (config.txt alongside).
  if (exeStem) out.push({ label: "UEVR", path: path.join(appData(), "UnrealVRMod", exeStem, "log.txt") });
  for (const gi of findFiles(scan, /(?:^|\/)gameinfo\.txt$/, 3)) out.push({ label: "Source console.log (-condebug)", path: path.join(path.dirname(abs(scan, gi)), "console.log") });
  out.push({ label: "Godot (dernier projet lancé)", path: newestSubdirFile(path.join(appData(), "Godot", "app_userdata"), "logs", /\.log$/i) });
  for (const steam of ["C:/Program Files (x86)/Steam/logs", "C:/Program Files/Steam/logs"]) {
    out.push({ label: "SteamVR vrserver", path: path.join(steam, "vrserver.txt") });
    out.push({ label: "SteamVR vrcompositor", path: path.join(steam, "vrcompositor.txt") });
  }
  if (exeStem) out.push({ label: "Vidage mémoire Windows", path: newest(path.join(localAppData(), "CrashDumps"), new RegExp(`^${exeStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*\\.dmp$`, "i")) });

  const seen = new Set<string>();
  return out
    .filter((o): o is { label: string; path: string } => !!o.path)
    .filter((o) => (seen.has(o.path) ? false : (seen.add(o.path), true)))
    .map((o) => {
      let exists = false;
      let modified: string | undefined;
      try {
        const st = fs.statSync(o.path);
        exists = st.isFile();
        modified = st.mtime.toISOString();
      } catch {
        /* missing */
      }
      return { label: o.label, path: o.path, exists, modified };
    });
}

export interface EvidenceBundle {
  logs: Array<LogSource & { tail?: string }>;
  uevrMarkers: string[];
  vraMarkers: Array<Record<string, unknown>>;
  captures: string[];
}

export function collectEvidence(gamePath: string, opts: { tailLines?: number; since?: string } = {}): EvidenceBundle {
  const since = opts.since ? Date.parse(opts.since) : 0;
  const logs = logSources(gamePath).map((l) => {
    if (!l.exists || l.path.endsWith(".dmp")) return l;
    if (since && l.modified && Date.parse(l.modified) < since) return { ...l, tail: "(non modifié depuis la date demandée)" };
    return { ...l, tail: tailLines(l.path, opts.tailLines ?? 60) };
  });
  const scan = scanGame(gamePath);
  const main = pickMainExe(scan);
  const exeStem = main.exe ? path.basename(main.exe, ".exe") : "";
  let uevrMarkers: string[] = [];
  if (exeStem) {
    const d = path.join(appData(), "UnrealVRMod", exeStem, "data");
    try {
      uevrMarkers = fs.readdirSync(d).filter((f) => /^vra_marker_.*\.json$/i.test(f)).map((f) => path.join(d, f));
    } catch {
      /* none */
    }
  }
  const mdir = path.join(profileDir(gamePath), "markers");
  let vraMarkers: Array<Record<string, unknown>> = [];
  try {
    vraMarkers = fs
      .readdirSync(mdir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ file: path.join(mdir, f), ...readJson<Record<string, unknown>>(path.join(mdir, f), {}) }) as Record<string, unknown>)
      .filter((m) => !since || Date.parse(String(m.at ?? 0)) >= since);
  } catch {
    /* none */
  }
  const cdir = path.join(profileDir(gamePath), "captures");
  let captures: string[] = [];
  try {
    captures = fs.readdirSync(cdir).filter((f) => f.endsWith(".png")).map((f) => path.join(cdir, f)).slice(-10);
  } catch {
    /* none */
  }
  return { logs, uevrMarkers, vraMarkers, captures };
}

export function markerScript(): string {
  return path.join(pluginRoot(), "marker", "vra-marker.ps1");
}

export function captureScript(): string {
  return path.join(pluginRoot(), "marker", "vra-capture.ps1");
}

export async function captureScreen(gamePath: string, windowTitle?: string): Promise<string> {
  const dir = path.join(profileDir(gamePath), "captures");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `capture_${timestamp()}.png`);
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", captureScript(), "-OutFile", out];
  if (windowTitle) args.push("-WindowTitle", windowTitle);
  await execFileP("powershell.exe", args, { windowsHide: true, timeout: 30000 });
  if (!fs.existsSync(out)) throw new Error("Capture non produite");
  return out;
}

export function startMarker(gamePath: string, opts: { processName?: string; maxMinutes?: number }): { pid: number | undefined; markersDir: string; how: string } {
  const markersDir = path.join(profileDir(gamePath), "markers");
  fs.mkdirSync(markersDir, { recursive: true });
  const logs = logSources(gamePath).filter((l) => !l.path.endsWith(".dmp")).map((l) => l.path);
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", markerScript(), "-MarkersDir", markersDir, "-CaptureScript", captureScript(), "-MaxMinutes", String(opts.maxMinutes ?? 240)];
  if (opts.processName) args.push("-WatchProcess", opts.processName);
  if (logs.length) args.push("-Logs", logs.join("|"));
  const child = spawn("powershell.exe", args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return {
    pid: child.pid,
    markersDir,
    how: "Marqueur : Ctrl+Alt+M au clavier, ou LB+RB+A maintenus 1 s sur une manette XInput. Un bip confirme. Arrêt automatique à la fermeture du jeu ou après la durée maximale.",
  };
}

export function launchGame(gamePath: string, opts: { exe?: string; args?: string[]; env?: NodeJS.ProcessEnv }): { pid: number | undefined; exe: string } {
  const scan = scanGame(gamePath);
  const rel = opts.exe ?? pickMainExe(scan).exe;
  if (!rel) throw new Error("Aucun exécutable à lancer : préciser exe.");
  const exe = path.isAbsolute(rel) ? rel : abs(scan, rel);
  if (!exe.startsWith(scan.root)) throw new Error("L'exécutable doit être dans le dossier du jeu.");
  const child = spawn(exe, opts.args ?? [], { cwd: path.dirname(exe), detached: true, stdio: "ignore", env: opts.env ?? process.env });
  child.unref();
  return { pid: child.pid, exe };
}
