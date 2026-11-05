import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pluginRoot, toolsDir } from "../paths.js";
import { launchGame } from "../runtime.js";
import { abs, pickMainExe, scanGame } from "../detect/scan.js";
import { createBackup, restoreBackup, listBackups } from "../backup.js";

const execFileP = promisify(execFile);

/**
 * Simulated headset for the VRA Lab. The simulator runtime and the agent layer
 * are activated PER PROCESS through OpenXR loader environment variables
 * (XR_RUNTIME_JSON, XR_API_LAYER_PATH, XR_ENABLE_API_LAYERS): the registry and
 * the user's real headset setup (Virtual Desktop, VDXR) are never touched.
 */

export const OPERATOR_LAYER = "XR_APILAYER_METAX_operator";
export const OPERATOR_PORT = 8720;
export const DOWNLOADS = {
  simulator: "https://developers.meta.com/horizon/downloads/package/meta-xr-simulator-windows/",
  operator: "https://developers.meta.com/horizon/documentation/unity/meta-xr-operator/connecting-ai-agents/",
};

async function regValues(key: string): Promise<Array<{ name: string; data: string }>> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileP("reg.exe", ["query", key], { windowsHide: true, timeout: 10000 });
    const out: Array<{ name: string; data: string }> = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(line);
      if (m) out.push({ name: m[1].trim(), data: m[3].trim() });
    }
    return out;
  } catch {
    return [];
  }
}

function readJsonSafe(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

export function isRuntimeManifest(file: string): boolean {
  const j = readJsonSafe(file);
  return !!(j && j.runtime && typeof j.runtime.library_path === "string");
}

/** True when the layer library named by the manifest exists next to it and suits this OS (.dll / .dylib / .so). */
export function manifestMatchesPlatform(file: string, platform: NodeJS.Platform = process.platform): boolean {
  const j = readJsonSafe(file);
  const lib: unknown = j?.api_layer?.library_path ?? j?.runtime?.library_path;
  if (typeof lib !== "string") return false;
  const ext = platform === "win32" ? /\.dll$/i : platform === "darwin" ? /\.dylib$/i : /\.so$/i;
  if (!ext.test(lib)) return false;
  const libPath = path.isAbsolute(lib) ? lib : path.join(path.dirname(file), lib);
  return fs.existsSync(libPath);
}

export function isOperatorManifest(file: string): boolean {
  const j = readJsonSafe(file);
  return !!(j && j.api_layer && j.api_layer.name === OPERATOR_LAYER);
}

/** Bounded search; topFilter limits which first-level folders are explored (big roots like Program Files). */
function shallowFind(root: string, test: (f: string) => boolean, depth = 4, topFilter?: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && d === 0 && topFilter && !topFilter.test(e.name)) continue;
      if (e.isDirectory() && /^(node_modules|\.git|winsxs|\$recycle\.bin)$/i.test(e.name) && d > 0) continue;
      if (e.isDirectory() && d < depth) walk(p, d + 1);
      else if (e.isFile() && test(p)) out.push(p);
      if (out.length > 20) return;
    }
  };
  walk(root, 0);
  return out;
}

/** Where Meta's standalone packages usually land; big roots are only explored in Meta/Oculus/XR folders. */
const META_DIRS = /meta|oculus|xr|simulator|operator/i;
const SEARCH_ROOTS = (): Array<{ root: string; filter?: RegExp }> =>
  [
    { root: process.env.LOCALAPPDATA ?? "", filter: META_DIRS },
    { root: process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs") : "", filter: META_DIRS },
    { root: process.env.ProgramFiles ?? "", filter: META_DIRS },
    { root: process.env["ProgramFiles(x86)"] ?? "", filter: META_DIRS },
    { root: process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Downloads") : "", filter: META_DIRS },
    { root: process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : "", filter: META_DIRS },
    { root: toolsDir() },
    { root: pluginRoot() },
  ].filter((x) => !!x.root && fs.existsSync(x.root));

export async function findSimulatorRuntime(explicit?: string): Promise<{ json: string | null; source: string; candidates: string[] }> {
  if (explicit) return { json: isRuntimeManifest(explicit) ? path.resolve(explicit) : null, source: "paramètre", candidates: [explicit] };
  if (process.env.VRA_XRSIM_JSON) return { json: isRuntimeManifest(process.env.VRA_XRSIM_JSON) ? process.env.VRA_XRSIM_JSON : null, source: "VRA_XRSIM_JSON", candidates: [process.env.VRA_XRSIM_JSON] };
  const reg = await regValues("HKLM\\SOFTWARE\\Khronos\\OpenXR\\1\\AvailableRuntimes");
  const regFiles = reg.map((r) => r.name).filter((n) => n.toLowerCase().endsWith(".json"));
  const sim = regFiles.filter((f) => /simulat|xrsim|xr_sim/i.test(f) && isRuntimeManifest(f));
  if (sim.length) return { json: sim[0], source: "registre OpenXR (AvailableRuntimes)", candidates: regFiles };
  for (const { root, filter } of SEARCH_ROOTS()) {
    const hits = shallowFind(root, (f) => /\.json$/i.test(f) && /simulat|xrsim/i.test(f) && isRuntimeManifest(f), 5, filter);
    if (hits.length) return { json: hits[0], source: `recherche dans ${root}`, candidates: hits };
  }
  return { json: null, source: "introuvable", candidates: regFiles };
}

export async function findOperator(explicitDir?: string): Promise<{ layerDir: string | null; manifest: string | null; proxy: string | null }> {
  const roots = [explicitDir, process.env.VRA_XR_OPERATOR_DIR].filter((x): x is string => !!x).map((root) => ({ root, filter: undefined as RegExp | undefined }));
  const searchIn = roots.length ? roots : SEARCH_ROOTS();
  for (const { root, filter } of searchIn) {
    if (!fs.existsSync(root)) continue;
    const all = shallowFind(root, (f) => /\.json$/i.test(f) && /operator|apilayer|api_layer|metax/i.test(path.basename(f)) && isOperatorManifest(f), 6, filter);
    // The standalone package ships android/, macos/ and windows/ layers: keep the one for this OS
    // (its library must sit next to the manifest, since library_path is relative).
    const manifests = all.filter((m) => manifestMatchesPlatform(m));
    if (manifests.length) {
      const layerDir = path.dirname(manifests[0]);
      const proxyName = process.platform === "win32" ? /meta-xr-operator-mcp-proxy\.exe$/i : /meta-xr-operator-mcp-proxy$/i;
      const proxyCands = [layerDir, path.dirname(layerDir)].flatMap((d) => shallowFind(d, (f) => proxyName.test(f), 2));
      return { layerDir, manifest: manifests[0], proxy: proxyCands[0] ?? null };
    }
  }
  return { layerDir: null, manifest: null, proxy: null };
}

export async function activeOpenXrRuntime(): Promise<string | null> {
  const v = await regValues("HKLM\\SOFTWARE\\Khronos\\OpenXR\\1");
  return v.find((x) => x.name === "ActiveRuntime")?.data ?? null;
}

/** Environment variables for a game process that must use the simulated headset (and optionally the agent layer). */
export function buildLabEnv(opts: { runtimeJson: string; operatorLayerDir?: string | null; labDir?: string | null; base?: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.base ?? process.env), XR_RUNTIME_JSON: opts.runtimeJson };
  if (opts.operatorLayerDir) {
    env.XR_API_LAYER_PATH = opts.operatorLayerDir;
    const existing = (opts.base ?? process.env).XR_ENABLE_API_LAYERS;
    env.XR_ENABLE_API_LAYERS = existing && !existing.split(path.delimiter).includes(OPERATOR_LAYER) ? `${existing}${path.delimiter}${OPERATOR_LAYER}` : OPERATOR_LAYER;
  }
  if (opts.labDir) env.VRA_LAB_DIR = opts.labDir;
  return env;
}

export function findUevrInjector(explicit?: string): string | null {
  if (explicit) return fs.existsSync(explicit) ? path.resolve(explicit) : null;
  for (const id of ["uevr-nightly", "uevr"]) {
    const base = path.join(toolsDir(), id);
    if (!fs.existsSync(base)) continue;
    const versions = fs.readdirSync(base).map((v) => path.join(base, v)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const v of versions) {
      const hit = shallowFind(v, (f) => /uevrinjector\.exe$/i.test(f), 3)[0];
      if (hit) return hit;
    }
  }
  return null;
}

export interface LabLaunchResult {
  game: { pid: number | undefined; exe: string };
  injector: { pid: number | undefined; exe: string; attach: string } | null;
  env: Record<string, string>;
  notes: string[];
}

export function labLaunch(gamePath: string, opts: { runtimeJson: string; operatorLayerDir?: string | null; labDir?: string | null; exe?: string; args?: string[]; injectUevr?: boolean; injectorPath?: string | null }): LabLaunchResult {
  const env = buildLabEnv({ runtimeJson: opts.runtimeJson, operatorLayerDir: opts.operatorLayerDir, labDir: opts.labDir });
  const game = launchGame(gamePath, { exe: opts.exe, args: opts.args, env });
  const notes: string[] = [];
  let injector: LabLaunchResult["injector"] = null;
  if (opts.injectUevr) {
    const inj = opts.injectorPath ?? findUevrInjector();
    if (!inj) notes.push("UEVRInjector.exe introuvable : installer UEVR (install_tool_plan uevr) ou passer injector_path.");
    else {
      const attach = path.basename(game.exe);
      const child = spawn(inj, [`--attach=${attach}`], { cwd: path.dirname(inj), detached: true, stdio: "ignore" });
      child.unref();
      injector = { pid: child.pid, exe: inj, attach };
      notes.push("UEVRInjector attend le processus et injecte automatiquement. Le runtime utilisé est celui coché dans l'injecteur : choisir OpenXR une fois (réglage mémorisé).");
    }
  }
  const shown: Record<string, string> = {};
  for (const k of ["XR_RUNTIME_JSON", "XR_API_LAYER_PATH", "XR_ENABLE_API_LAYERS", "VRA_LAB_DIR"]) if (env[k]) shown[k] = env[k]!;
  notes.push("Le registre OpenXR n'est pas modifié : Virtual Desktop et VDXR restent tels quels pour le casque réel.");
  return { game, injector, env: shown, notes };
}

export function mainExeName(gamePath: string): string | null {
  const exe = pickMainExe(scanGame(gamePath)).exe;
  return exe ? path.basename(abs(scanGame(gamePath), exe)) : null;
}

/* ───────────────────────── SteamVR null driver (OpenVR-only fallback) ───────────────────────── */

export async function steamPath(): Promise<string | null> {
  const v = await regValues("HKCU\\Software\\Valve\\Steam");
  const p = v.find((x) => x.name === "SteamPath")?.data;
  if (p && fs.existsSync(p)) return path.resolve(p);
  for (const c of ["C:/Program Files (x86)/Steam", "C:/Program Files/Steam"]) if (fs.existsSync(c)) return path.resolve(c);
  return null;
}

export function mergeSteamVrSettings(text: string | null, enable: boolean): string {
  const j = text ? (JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, any>) : {};
  j.steamvr = j.steamvr ?? {};
  if (enable) {
    j.steamvr.requireHmd = false;
    j.steamvr.forcedDriver = "null";
    j.steamvr.activateMultipleDrivers = true;
  }
  return JSON.stringify(j, null, 3) + "\n";
}

export function enableNullDriverDefaults(text: string): string {
  const j = JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, any>;
  j.driver_null = j.driver_null ?? {};
  j.driver_null.enable = true;
  return JSON.stringify(j, null, 3) + "\n";
}

export interface NullDriverPlan {
  steam: string;
  files: Array<{ rel: string; exists: boolean; change: string }>;
  warnings: string[];
}

const SETTINGS_REL = "config/steamvr.vrsettings";
const NULL_REL = "steamapps/common/SteamVR/drivers/null/resources/settings/default.vrsettings";

export async function nullDriverPlan(): Promise<NullDriverPlan> {
  const steam = await steamPath();
  if (!steam) throw new Error("Steam introuvable.");
  const nullFile = path.join(steam, ...NULL_REL.split("/"));
  if (!fs.existsSync(nullFile)) throw new Error("Pilote null de SteamVR introuvable : SteamVR est-il installé ?");
  return {
    steam,
    files: [
      { rel: SETTINGS_REL, exists: fs.existsSync(path.join(steam, ...SETTINGS_REL.split("/"))), change: "steamvr.requireHmd=false, steamvr.forcedDriver=\"null\", steamvr.activateMultipleDrivers=true" },
      { rel: NULL_REL, exists: true, change: "driver_null.enable=true" },
    ],
    warnings: [
      "Tant que c'est actif, SteamVR utilise un casque fictif MÊME si un vrai casque est branché : désactiver après la session Lab (steamvr_null_driver action=disable).",
      "Le casque fictif ne bouge pas : utile pour vérifier qu'un outil OpenVR démarre et rend une image, pas pour tester le 6DOF. Préférer Meta XR Simulator (OpenXR) quand l'outil le permet.",
      "Fermer SteamVR avant d'appliquer.",
    ],
  };
}

export async function nullDriverEnable(gamePathForSlug: string): Promise<{ backupId: string; steam: string }> {
  const plan = await nullDriverPlan();
  const m = await createBackup(plan.steam, gamePathForSlug, [SETTINGS_REL, NULL_REL], "steamvr-null-driver");
  const settingsFile = path.join(plan.steam, ...SETTINGS_REL.split("/"));
  const nullFile = path.join(plan.steam, ...NULL_REL.split("/"));
  fs.writeFileSync(settingsFile, mergeSteamVrSettings(fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : null, true), "utf8");
  fs.writeFileSync(nullFile, enableNullDriverDefaults(fs.readFileSync(nullFile, "utf8")), "utf8");
  return { backupId: m.id, steam: plan.steam };
}

export async function nullDriverDisable(gamePathForSlug: string) {
  const b = listBackups(gamePathForSlug).filter((x) => x.label === "steamvr-null-driver" && !x.restoredAt).at(-1);
  if (!b) throw new Error("Aucune activation du pilote null à annuler.");
  return restoreBackup(gamePathForSlug, b.id, false);
}
