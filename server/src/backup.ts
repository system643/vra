import fs from "node:fs";
import path from "node:path";
import { backupsDir, resolveInside } from "./paths.js";
import { nowIso, readJson, sha256File, timestamp, writeJson } from "./util/fsx.js";

/**
 * Backups before any change, and a documented restore. A file that did not
 * exist before is recorded as "added" so that restore deletes it.
 */

export interface BackupEntry {
  rel: string;
  existed: boolean;
  sha256: string | null;
  size: number | null;
}

export interface BackupManifest {
  id: string;
  at: string;
  label: string;
  root: string;
  entries: BackupEntry[];
  restoredAt?: string;
}

export async function createBackup(root: string, gamePathForSlug: string, relFiles: string[], label: string): Promise<BackupManifest> {
  const id = `${timestamp()}_${label.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40)}`;
  const dir = path.join(backupsDir(gamePathForSlug), id);
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  const entries: BackupEntry[] = [];
  const unique = [...new Set(relFiles.map((r) => r.replace(/\\/g, "/").replace(/^\/+/, "")))];
  for (const rel of unique) {
    const src = resolveInside(root, rel);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      const dst = path.join(dir, "files", ...rel.split("/"));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      entries.push({ rel, existed: true, sha256: await sha256File(src), size: fs.statSync(src).size });
    } else {
      entries.push({ rel, existed: false, sha256: null, size: null });
    }
  }
  const manifest: BackupManifest = { id, at: nowIso(), label, root: path.resolve(root), entries };
  writeJson(path.join(dir, "manifest.json"), manifest);
  return manifest;
}

export function listBackups(gamePathForSlug: string): BackupManifest[] {
  const base = backupsDir(gamePathForSlug);
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readJson<BackupManifest | null>(path.join(base, d.name, "manifest.json"), null))
    .filter((m): m is BackupManifest => !!m)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export interface RestoreReport {
  id: string;
  restored: string[];
  deleted: string[];
  verified: string[];
  problems: string[];
}

export async function restoreBackup(gamePathForSlug: string, id: string | "latest", dryRun: boolean): Promise<RestoreReport> {
  const all = listBackups(gamePathForSlug);
  const m = id === "latest" ? all.filter((b) => !b.restoredAt).at(-1) ?? all.at(-1) : all.find((b) => b.id === id);
  if (!m) throw new Error(`Sauvegarde introuvable : ${id}. Disponibles : ${all.map((b) => b.id).join(", ") || "aucune"}`);
  const dir = path.join(backupsDir(gamePathForSlug), m.id);
  const report: RestoreReport = { id: m.id, restored: [], deleted: [], verified: [], problems: [] };
  for (const e of m.entries) {
    const target = resolveInside(m.root, e.rel);
    if (e.existed) {
      const src = path.join(dir, "files", ...e.rel.split("/"));
      if (!fs.existsSync(src)) {
        report.problems.push(`copie de sauvegarde manquante : ${e.rel}`);
        continue;
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(src, target);
        const h = await sha256File(target);
        if (h === e.sha256) report.verified.push(e.rel);
        else report.problems.push(`empreinte différente après restauration : ${e.rel}`);
      }
      report.restored.push(e.rel);
    } else if (fs.existsSync(target)) {
      if (!dryRun) fs.rmSync(target, { force: true });
      report.deleted.push(e.rel);
    }
  }
  if (!dryRun) {
    // remove directories that became empty because of deletions (never the root)
    const dirs = new Set(report.deleted.map((r) => path.dirname(resolveInside(m.root, r))));
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
      let cur = d;
      while (path.resolve(cur) !== path.resolve(m.root) && fs.existsSync(cur) && fs.readdirSync(cur).length === 0) {
        fs.rmdirSync(cur);
        cur = path.dirname(cur);
      }
    }
    m.restoredAt = nowIso();
    writeJson(path.join(dir, "manifest.json"), m);
  }
  return report;
}
