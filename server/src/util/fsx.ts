import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface WalkResult {
  root: string;
  /** Relative POSIX paths of files. */
  files: string[];
  /** Relative POSIX paths of directories. */
  dirs: string[];
  truncated: boolean;
}

const SKIP_DIRS = new Set(["$recycle.bin", "system volume information", "node_modules", ".git"]);

/** Bounded breadth-first walk of a game folder. Never follows symlinks. */
export function walk(root: string, opts: { maxDepth?: number; maxEntries?: number } = {}): WalkResult {
  const maxDepth = opts.maxDepth ?? 7;
  const maxEntries = opts.maxEntries ?? 60000;
  const files: string[] = [];
  const dirs: string[] = [];
  let truncated = false;
  const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: root, rel: "", depth: 0 }];
  while (queue.length) {
    const cur = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (files.length + dirs.length >= maxEntries) {
        truncated = true;
        return { root, files, dirs, truncated };
      }
      const rel = cur.rel ? `${cur.rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        dirs.push(rel);
        if (cur.depth + 1 < maxDepth) queue.push({ abs: path.join(cur.abs, e.name), rel, depth: cur.depth + 1 });
        else truncated = true;
      } else if (e.isFile()) {
        files.push(rel);
      }
    }
  }
  return { root, files, dirs, truncated };
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (c) => hash.update(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

/** Append-only journal line (JSONL). Existing lines are never rewritten. */
export function appendJsonl(file: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* ignore a corrupt line rather than losing the journal */
    }
  }
  return out;
}

export async function readHead(file: string, bytes: number): Promise<Buffer> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function readRange(file: string, start: number, length: number): Promise<Buffer> {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Last N lines of a text file, read from the end (cheap on big logs). */
export function tailLines(file: string, lines = 80, maxBytes = 256 * 1024): string {
  try {
    const stat = fs.statSync(file);
    const size = stat.size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString("utf8");
      const parts = text.split(/\r?\n/);
      return parts.slice(-lines).join("\n");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function baseNameLower(rel: string): string {
  const i = rel.lastIndexOf("/");
  return (i >= 0 ? rel.slice(i + 1) : rel).toLowerCase();
}
