import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadsDir, resolveInside, toolsDir } from "./paths.js";
import { nowIso, readJson, sha256File, writeJson } from "./util/fsx.js";
import { createBackup } from "./backup.js";

const execFileP = promisify(execFile);

/** On Windows, use the system bsdtar (handles .zip); Git's GNU tar does not. */
function tarBin(): string {
  if (process.platform === "win32") {
    const sys = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    if (fs.existsSync(sys)) return sys;
  }
  return "tar";
}

/**
 * Controlled installation, modelled on `rea setup`: a plan is shown first
 * (files, source, digest), nothing touches the game before an explicit
 * confirmation, existing files are backed up, and every install is reversible.
 * Downloads only come from the authors' official GitHub releases.
 */

export type Destination = "game_exe_dir" | "game_root" | "tools";

export interface CatalogTool {
  id: string;
  name: string;
  repo?: string;
  /** Release tag filter. */
  tag?: RegExp;
  prerelease?: boolean;
  asset?: RegExp;
  destination: Destination;
  families: string[];
  officialPage: string;
  manual?: string;
  postInstall?: string;
  license?: string;
}

export const CATALOG: CatalogTool[] = [
  { id: "uevr", name: "UEVR (stable)", repo: "praydog/UEVR", asset: /^UEVR.*\.zip$/i, destination: "tools", families: ["unreal"], officialPage: "https://github.com/praydog/uevr", postInstall: "Lancer UEVRInjector.exe, choisir le jeu en cours d'exécution, « Inject ». Le profil est créé dans %APPDATA%\\UnrealVRMod\\<nom de l'exe>.", license: "MIT" },
  { id: "uevr-nightly", name: "UEVR (nightly)", repo: "praydog/UEVR-nightly", asset: /\.zip$/i, destination: "tools", families: ["unreal"], officialPage: "https://github.com/praydog/UEVR-nightly", postInstall: "Même usage que la stable ; nécessaire pour les jeux UE 5.5+.", license: "MIT" },
  { id: "bepinex5", name: "BepInEx 5 (Unity Mono)", repo: "BepInEx/BepInEx", tag: /^v5\./, asset: /BepInEx_win_x64_[\d.]+\.zip$/i, destination: "game_exe_dir", families: ["unity_mono"], officialPage: "https://github.com/BepInEx/BepInEx", postInstall: "Lancer le jeu une fois pour générer BepInEx/config et BepInEx/LogOutput.log.", license: "LGPL-2.1" },
  { id: "bepinex6-mono", name: "BepInEx 6 (Unity Mono)", repo: "BepInEx/BepInEx", tag: /^v6\./, prerelease: true, asset: /BepInEx-Unity\.Mono-win-x64-.*\.zip$/i, destination: "game_exe_dir", families: ["unity_mono"], officialPage: "https://github.com/BepInEx/BepInEx", postInstall: "Lancer le jeu une fois pour générer la configuration.", license: "LGPL-2.1" },
  { id: "bepinex6-il2cpp", name: "BepInEx 6 (Unity IL2CPP)", repo: "BepInEx/BepInEx", tag: /^v6\./, prerelease: true, asset: /BepInEx-Unity\.IL2CPP-win-x64-.*\.zip$/i, destination: "game_exe_dir", families: ["unity_il2cpp"], officialPage: "https://github.com/BepInEx/BepInEx", postInstall: "Premier lancement long : BepInEx génère les assemblies d'interop.", license: "LGPL-2.1" },
  { id: "unityvrmod", name: "UnityVRMod", repo: "NewUnityModder/UnityVRMod", asset: /\.zip$/i, destination: "game_exe_dir", families: ["unity_mono", "unity_il2cpp"], officialPage: "https://github.com/NewUnityModder/UnityVRMod", postInstall: "Nécessite BepInEx 6. Choisir l'archive qui correspond au runtime (Mono/IL2CPP) et au backend (OpenXR/OpenVR).", license: "voir le dépôt" },
  { id: "unityexplorer", name: "UnityExplorer", repo: "yukieiji/UnityExplorer", asset: /BepInEx.*\.zip$/i, destination: "game_exe_dir", families: ["unity_mono", "unity_il2cpp"], officialPage: "https://github.com/yukieiji/UnityExplorer", postInstall: "Inspecteur en jeu (touche F7 par défaut).", license: "GPL-3.0" },
  { id: "rai-pal", name: "Rai Pal (installe UUVR)", repo: "Raicuparta/rai-pal", asset: /\.(?:exe|msi|zip)$/i, destination: "tools", families: ["unity_mono", "unity_il2cpp"], officialPage: "https://github.com/Raicuparta/rai-pal", postInstall: "VRA ne lance jamais d'installeur : ouvre le fichier téléchargé toi-même, puis installe UUVR depuis Rai Pal.", license: "GPL-3.0" },
  { id: "reframework", name: "REFramework", repo: "praydog/REFramework", asset: /\.zip$/i, destination: "game_exe_dir", families: ["re_engine"], officialPage: "https://github.com/praydog/REFramework", postInstall: "Pour la VR, extraire l'archive complète du jeu (pas seulement dinput8.dll). Menu : touche Insert.", license: "MIT" },
  { id: "ue4ss", name: "RE-UE4SS", repo: "UE4SS-RE/RE-UE4SS", asset: /^UE4SS_v[\d.]+\.zip$/i, destination: "game_exe_dir", families: ["unreal"], officialPage: "https://github.com/UE4SS-RE/RE-UE4SS", postInstall: "Dumpers et Live View pour cartographier le jeu. En cas de plantage au démarrage : bUseUObjectArrayCache = false dans UE4SS-settings.ini.", license: "MIT" },
  { id: "gdre-tools", name: "GDRE Tools", repo: "GDRETools/gdsdecomp", asset: /windows.*\.zip$/i, destination: "tools", families: ["godot"], officialPage: "https://github.com/GDRETools/gdsdecomp", postInstall: "Récupérer le projet dans un dossier de VRA (jamais dans le jeu).", license: "MIT" },
  { id: "quakevr", name: "Quake VR", repo: "vittorioromeo/quakevr", asset: /\.zip$/i, destination: "tools", families: ["opensource_port"], officialPage: "https://github.com/vittorioromeo/quakevr", postInstall: "Copier ou pointer le dossier id1 du Quake acheté vers le dossier de Quake VR.", license: "GPL-2.0" },
  { id: "meta-xr-operator", name: "Meta XR Operator (standalone)", destination: "tools", families: ["unreal", "unity_mono", "unity_il2cpp", "re_engine", "godot", "unknown"], officialPage: "https://developers.meta.com/horizon/documentation/unity/meta-xr-operator/connecting-ai-agents/", manual: "Distribué par Meta hors GitHub (compte développeur) : télécharger le .zip standalone, puis install_tool_plan tool_id=meta-xr-operator local_archive=<chemin du .zip>. Il est extrait dans le dossier tools de VRA, où xr_sim_status le trouve.", postInstall: "Accès direct pour Claude (facultatif) : claude mcp add meta-xr-operator <dossier>\\windows\\meta-xr-operator-mcp-proxy.exe", license: "licence Meta (ne pas redistribuer)" },
  { id: "meta-xr-simulator", name: "Meta XR Simulator (standalone)", destination: "tools", families: ["unreal", "unity_mono", "unity_il2cpp", "re_engine", "godot", "unknown"], officialPage: "https://developers.meta.com/horizon/downloads/package/meta-xr-simulator-windows/", manual: "Installeur .msi de Meta : l'utilisateur le lance lui-même (VRA ne lance jamais d'installeur). Ensuite xr_sim_status le détecte via le registre OpenXR (AvailableRuntimes) ou VRA_XRSIM_JSON.", license: "licence Meta (ne pas redistribuer)" },
  { id: "geo-11", name: "geo-11", destination: "game_exe_dir", families: ["unknown", "aaa_proprietary", "unreal_legacy", "emulator", "creation"], officialPage: "https://helixmod.blogspot.com/2022/06/announcing-new-geo-11-3d-driver.html", manual: "Distribué hors GitHub : télécharger depuis la page officielle, puis installer avec install_tool_plan en mode « archive locale » (local_archive)." },
  { id: "vivecraft", name: "Vivecraft", destination: "tools", families: ["java"], officialPage: "https://www.vivecraft.org/", manual: "Installer depuis le site officiel (installeur ou launcher compatible). VRA ne télécharge pas d'installeur exécutable." },
  { id: "real-luke-ross", name: "R.E.A.L. VR (Luke Ross)", destination: "game_exe_dir", families: ["aaa_proprietary"], officialPage: "https://www.patreon.com/LukeRoss", manual: "Distribué par l'auteur hors GitHub. Rappel : 6DOF sans contrôleurs → palier, pas destination." },
  { id: "dumper-7", name: "Dumper-7", destination: "tools", families: ["unreal"], officialPage: "https://github.com/Encryqed/Dumper-7", manual: "Distribué en code source : à compiler (x64-Release) puis injecter. Préférer d'abord les dumpers de RE-UE4SS." },
];

export function catalogEntry(id: string): CatalogTool {
  const t = CATALOG.find((c) => c.id === id);
  if (!t) throw new Error(`Outil inconnu : ${id}. Outils : ${CATALOG.map((c) => c.id).join(", ")}`);
  return t;
}

interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}
interface GhRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string;
  html_url: string;
  assets: GhAsset[];
}

async function gh<T>(url: string): Promise<T> {
  const headers: Record<string, string> = { "User-Agent": "vra-mcp-server", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status} pour ${url}${res.status === 403 ? " (limite de requêtes : définir GITHUB_TOKEN)" : ""}`);
  return (await res.json()) as T;
}

export async function findRelease(t: CatalogTool, version?: string): Promise<GhRelease> {
  if (!t.repo) throw new Error(`${t.name} : ${t.manual ?? "pas de dépôt GitHub"}`);
  if (version && version !== "latest") {
    return gh<GhRelease>(`https://api.github.com/repos/${t.repo}/releases/tags/${encodeURIComponent(version)}`);
  }
  if (!t.tag && !t.prerelease) {
    try {
      return await gh<GhRelease>(`https://api.github.com/repos/${t.repo}/releases/latest`);
    } catch {
      /* repos with only prereleases: fall through */
    }
  }
  const list = await gh<GhRelease[]>(`https://api.github.com/repos/${t.repo}/releases?per_page=30`);
  const ok = list.filter((r) => !r.draft && (!t.tag || t.tag.test(r.tag_name)) && (t.prerelease || !r.prerelease || !t.tag));
  if (!ok.length) throw new Error(`Aucune release trouvée pour ${t.repo}${t.tag ? ` (filtre ${t.tag})` : ""}`);
  return ok.sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
}

export interface InstallPlan {
  planId: string;
  createdAt: string;
  tool: string;
  toolName: string;
  version: string;
  releaseUrl: string;
  asset: string;
  assetUrl: string;
  size: number;
  publishedDigest: string | null;
  computedSha256: string;
  digestVerified: boolean | null;
  archive: string;
  destination: string;
  destinationKind: Destination;
  gamePath: string;
  entries: string[];
  willAdd: string[];
  willReplace: string[];
  postInstall?: string;
  license?: string;
  warnings: string[];
}

function plansDir(): string {
  const d = path.join(downloadsDir(), "_plans");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function listArchive(archive: string): Promise<string[]> {
  const { stdout } = await execFileP(tarBin(), ["-tf", archive], { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function safeEntries(entries: string[]): { files: string[]; problems: string[] } {
  const files: string[] = [];
  const problems: string[] = [];
  for (const e of entries) {
    const norm = e.replace(/\\/g, "/");
    if (norm.startsWith("/") || /^[A-Za-z]:/.test(norm) || norm.split("/").includes("..")) {
      problems.push(`entrée dangereuse refusée : ${e}`);
      continue;
    }
    if (!norm.endsWith("/")) files.push(norm.replace(/^\.\//, ""));
  }
  return { files, problems };
}

export async function makePlan(args: {
  toolId: string;
  gamePath: string;
  exeDir: string;
  version?: string;
  assetName?: string;
  localArchive?: string;
  /** Context used to pick the right archive automatically (runtime, game identity, VR backend). */
  hints?: { runtime?: "mono" | "il2cpp" | null; identity?: string | null; backend?: "openxr" | "openvr" };
}): Promise<InstallPlan | { choose: string[]; message: string }> {
  const t = catalogEntry(args.toolId);
  let assetName: string;
  let assetUrl = "";
  let size = 0;
  let publishedDigest: string | null = null;
  let version = "local";
  let releaseUrl = t.officialPage;
  let archive: string;
  const warnings: string[] = [];
  if (args.localArchive) {
    archive = path.resolve(args.localArchive);
    if (!fs.existsSync(archive)) throw new Error(`Archive locale introuvable : ${archive}`);
    assetName = path.basename(archive);
    size = fs.statSync(archive).size;
    warnings.push("Archive locale : son origine n'est pas vérifiable par VRA. Vérifie qu'elle vient de la page officielle.");
  } else {
    if (!t.repo) return { choose: [], message: `${t.name} : ${t.manual} Page officielle : ${t.officialPage}` };
    const rel = await findRelease(t, args.version);
    version = rel.tag_name;
    releaseUrl = rel.html_url;
    let assets = rel.assets.filter((a) => !t.asset || t.asset.test(a.name));
    if (args.assetName) assets = rel.assets.filter((a) => a.name === args.assetName);
    if (!assets.length) throw new Error(`Aucune archive ne correspond dans ${rel.tag_name}. Archives : ${rel.assets.map((a) => a.name).join(", ")}`);
    if (assets.length > 1 && !args.assetName) {
      const picked = autoPick(t.id, assets.map((a) => a.name), args.hints ?? {});
      if (picked) {
        warnings.push(`Archive choisie automatiquement : ${picked} (autres : ${assets.map((a) => a.name).filter((n) => n !== picked).join(", ")}). Relancer avec asset_name pour en choisir une autre.`);
        assets = assets.filter((a) => a.name === picked);
      }
    }
    if (assets.length > 1) {
      return { choose: assets.map((a) => a.name), message: `Plusieurs archives possibles dans ${t.name} ${rel.tag_name} : relancer avec asset_name.` };
    }
    const a = assets[0];
    assetName = a.name;
    assetUrl = a.browser_download_url;
    size = a.size;
    publishedDigest = a.digest ?? null;
    const dir = path.join(downloadsDir(), t.id, version.replace(/[^A-Za-z0-9._-]/g, "_"));
    fs.mkdirSync(dir, { recursive: true });
    archive = path.join(dir, a.name);
    if (!fs.existsSync(archive) || fs.statSync(archive).size !== a.size) {
      const res = await fetch(a.browser_download_url, { headers: { "User-Agent": "vra-mcp-server" }, redirect: "follow" });
      if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${a.browser_download_url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(archive, buf);
    }
  }
  const computedSha256 = await sha256File(archive);
  let digestVerified: boolean | null = null;
  if (publishedDigest?.startsWith("sha256:")) {
    digestVerified = publishedDigest.slice(7).toLowerCase() === computedSha256;
    if (!digestVerified) throw new Error(`Empreinte SHA-256 différente de celle publiée par GitHub : archive refusée (${assetName}).`);
  } else if (!args.localArchive) warnings.push("Aucune empreinte publiée par GitHub pour cette archive : taille vérifiée seulement.");

  const isArchive = /\.(?:zip|7z|tar|tgz|tar\.gz)$/i.test(assetName);
  let entries: string[] = [];
  if (isArchive) {
    const listed = safeEntries(await listArchive(archive));
    if (listed.problems.length) throw new Error(`Archive refusée : ${listed.problems.join(" ; ")}`);
    entries = listed.files;
  } else {
    entries = [assetName];
    if (/\.(?:exe|msi)$/i.test(assetName)) warnings.push("Installeur exécutable : VRA le télécharge mais ne le lance jamais. Ouvre-le toi-même si tu le souhaites.");
  }
  let destination: string;
  if (t.destination === "tools") destination = path.join(toolsDir(), t.id, version.replace(/[^A-Za-z0-9._-]/g, "_"));
  else if (t.destination === "game_root") destination = path.resolve(args.gamePath);
  else destination = args.exeDir;
  // Archives with a single top folder named like the tool (e.g. "UE4SS/…") are fine; we install as-is.
  const willReplace: string[] = [];
  const willAdd: string[] = [];
  for (const e of entries) {
    const target = resolveInside(destination, e);
    (fs.existsSync(target) ? willReplace : willAdd).push(e);
  }
  if (t.destination !== "tools" && path.resolve(args.gamePath).replace(/\\/g, "/").toLowerCase().includes("/windowsapps/")) {
    warnings.push("Jeu Game Pass (WindowsApps) : l'écriture dans le dossier peut être refusée par Windows. Activer « Options avancées → Activer les mods » dans l'app Xbox si le jeu le permet.");
  }
  const plan: InstallPlan = {
    planId: `plan_${crypto.randomBytes(6).toString("hex")}`,
    createdAt: nowIso(),
    tool: t.id,
    toolName: t.name,
    version,
    releaseUrl,
    asset: assetName,
    assetUrl,
    size,
    publishedDigest,
    computedSha256,
    digestVerified,
    archive,
    destination,
    destinationKind: t.destination,
    gamePath: path.resolve(args.gamePath),
    entries,
    willAdd,
    willReplace,
    postInstall: t.postInstall,
    license: t.license,
    warnings,
  };
  writeJson(path.join(plansDir(), `${plan.planId}.json`), plan);
  return plan;
}

/** Pick one archive among several, from the detected context. Returns null when still ambiguous. */
export function autoPick(toolId: string, names: string[], hints: { runtime?: "mono" | "il2cpp" | null; identity?: string | null; backend?: "openxr" | "openvr" }): string | null {
  let c = names;
  const keep = (re: RegExp) => {
    const f = c.filter((n) => re.test(n));
    if (f.length) c = f;
  };
  if (toolId === "unityvrmod" || toolId === "unityexplorer") {
    if (hints.runtime === "il2cpp") keep(/il2cpp/i);
    if (hints.runtime === "mono") keep(/mono/i);
    if (toolId === "unityvrmod") keep(hints.backend === "openvr" ? /openvr/i : /openxr/i);
    if (toolId === "unityexplorer") {
      keep(/bepinex6|unity\.il2cpp/i);
      if (c.length > 1) {
        const plain = c.filter((n) => !/coreclr/i.test(n));
        if (plain.length) c = plain;
      }
      if (c.length > 1) keep(/unity\./i);
    }
  } else if (toolId === "reframework" && hints.identity) {
    const map: Record<string, string> = { re2: "RE2", re3: "RE3", re4: "RE4", re7: "RE7", re8: "RE8", devilmaycry5: "DMC5", monsterhunterrise: "MHRISE", monsterhunterwilds: "MHWILDS", streetfighter6: "SF6", dd2: "DD2", dragonsdogma2: "DD2" };
    const key = Object.keys(map).find((k) => hints.identity!.toLowerCase().startsWith(k));
    if (key) {
      const exact = c.filter((n) => n.toUpperCase() === `${map[key]}.ZIP`);
      if (exact.length) c = exact;
    }
  } else if (toolId === "rai-pal") {
    keep(/\.exe$/i);
  }
  return c.length === 1 ? c[0] : null;
}

export function readPlan(planId: string): InstallPlan {
  if (!/^plan_[0-9a-f]{12}$/.test(planId)) throw new Error("plan_id invalide");
  const p = readJson<InstallPlan | null>(path.join(plansDir(), `${planId}.json`), null);
  if (!p) throw new Error(`Plan introuvable : ${planId}`);
  return p;
}

export interface ApplyReport {
  planId: string;
  tool: string;
  version: string;
  destination: string;
  backupId: string | null;
  added: string[];
  replaced: string[];
  postInstall?: string;
}

export async function applyPlan(planId: string): Promise<ApplyReport> {
  const plan = readPlan(planId);
  if (!fs.existsSync(plan.archive)) throw new Error("Archive du plan absente : refaire un plan.");
  const sha = await sha256File(plan.archive);
  if (sha !== plan.computedSha256) throw new Error("L'archive a changé depuis le plan : refaire un plan.");
  fs.mkdirSync(plan.destination, { recursive: true });
  let backupId: string | null = null;
  if (plan.destinationKind !== "tools") {
    const m = await createBackup(plan.destination, plan.gamePath, plan.entries, `install-${plan.tool}`);
    backupId = m.id;
  }
  const isArchive = /\.(?:zip|7z|tar|tgz|tar\.gz)$/i.test(plan.asset);
  if (isArchive) {
    await execFileP(tarBin(), ["-xf", plan.archive, "-C", plan.destination], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  } else {
    fs.copyFileSync(plan.archive, path.join(plan.destination, plan.asset));
  }
  return { planId, tool: plan.tool, version: plan.version, destination: plan.destination, backupId, added: plan.willAdd, replaced: plan.willReplace, postInstall: plan.postInstall };
}
