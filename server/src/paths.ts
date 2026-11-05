import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

/**
 * Where VRA keeps user state (profiles, sessions, backups, downloads).
 * Never inside the plugin root: that folder is replaced on plugin updates.
 * Override with the VRA_HOME environment variable.
 */
export function vraHome(): string {
  const fromEnv = process.env.VRA_HOME;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  const docs = path.join(os.homedir(), "Documents");
  const base = fs.existsSync(docs) ? docs : os.homedir();
  return path.join(base, "VRA");
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Stable, filesystem-safe identifier for a game: folder name + short hash of the
 * full path, so two games installed in folders with the same name never collide.
 */
export function gameSlug(gamePath: string): string {
  const resolved = path.resolve(gamePath);
  const hash = crypto.createHash("sha1").update(resolved.toLowerCase()).digest("hex").slice(0, 6);
  const base = path.basename(resolved) || "jeu";
  const slug = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug || "jeu"}-${hash}`;
}

export function profileDir(gamePath: string): string {
  return ensureDir(path.join(vraHome(), "profiles", gameSlug(gamePath)));
}

export function userProfileDir(): string {
  return ensureDir(path.join(vraHome(), "profiles", "_utilisateur"));
}

export function backupsDir(gamePath: string): string {
  return ensureDir(path.join(vraHome(), "backups", gameSlug(gamePath)));
}

export function downloadsDir(): string {
  return ensureDir(path.join(vraHome(), "downloads"));
}

export function toolsDir(): string {
  return ensureDir(path.join(vraHome(), "tools"));
}

export function projectsDir(gamePath: string): string {
  return ensureDir(path.join(vraHome(), "projects", gameSlug(gamePath)));
}

export function cacheDir(): string {
  return ensureDir(path.join(vraHome(), "cache"));
}

/** Directory of the compiled server (dist/) or sources (src/) — used to find bundled data. */
export function serverRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

export function bundledDataDir(): string {
  return path.join(serverRoot(), "data");
}

export function pluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT
    ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
    : path.resolve(serverRoot(), "..");
}

export function appData(): string {
  return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
}

export function localAppData(): string {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
}

export function userProfileHome(): string {
  return process.env.USERPROFILE ?? os.homedir();
}

/** Resolve a path and make sure it stays inside a root (zip-slip / traversal guard). */
export function resolveInside(root: string, rel: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, rel);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Chemin hors du dossier autorisé : ${rel}`);
  }
  return target;
}
