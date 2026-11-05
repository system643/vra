import fs from "node:fs";

/**
 * Godot PCK reader (formats 1, 2 and a best-effort 3). Lists resource paths so
 * VRA can find cameras, player scenes, HUD and input maps. Read-only.
 */

export interface PckInfo {
  formatVersion: number;
  godotVersion: string;
  encryptedDirectory: boolean;
  embedded: boolean;
  fileCount: number;
  paths: string[];
  note?: string;
}

const MAGIC = 0x43504447; // "GDPC"

function readU32(fd: number, pos: number): number {
  const b = Buffer.alloc(4);
  fs.readSync(fd, b, 0, 4, pos);
  return b.readUInt32LE(0);
}

function readU64(fd: number, pos: number): number {
  const b = Buffer.alloc(8);
  fs.readSync(fd, b, 0, 8, pos);
  return Number(b.readBigUInt64LE(0));
}

function plausiblePath(p: string): boolean {
  return p.length > 0 && p.length < 1024 && /^[\x20-\x7e -￿]+$/.test(p) && !p.includes("\u0000");
}

function readEntries(fd: number, pos: number, count: number, withFlags: boolean, fileSize: number, maxPaths: number): string[] | null {
  const paths: string[] = [];
  let p = pos;
  for (let i = 0; i < count; i++) {
    if (p + 4 > fileSize) return null;
    const len = readU32(fd, p);
    p += 4;
    if (len === 0 || len > 4096 || p + len > fileSize) return null;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, p);
    p += len;
    const name = buf.toString("utf8").replace(/\0+$/, "");
    if (!plausiblePath(name)) return null;
    if (paths.length < maxPaths) paths.push(name);
    p += 8 + 8 + 16 + (withFlags ? 4 : 0);
  }
  return paths;
}

/** Locate the start of a PCK: a standalone .pck, or one embedded at the end of an exe. */
function locate(fd: number, size: number): { start: number; embedded: boolean } | null {
  if (size >= 4 && readU32(fd, 0) === MAGIC) return { start: 0, embedded: false };
  if (size >= 12 && readU32(fd, size - 4) === MAGIC) {
    const pckSize = readU64(fd, size - 12);
    const start = size - 12 - pckSize;
    if (start >= 0 && readU32(fd, start) === MAGIC) return { start, embedded: true };
  }
  return null;
}

export function readPck(file: string, maxPaths = 20000): PckInfo | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const loc = locate(fd, size);
    if (!loc) return null;
    const s = loc.start;
    const formatVersion = readU32(fd, s + 4);
    const major = readU32(fd, s + 8);
    const minor = readU32(fd, s + 12);
    const patch = readU32(fd, s + 16);
    const godotVersion = `${major}.${minor}.${patch}`;
    if (formatVersion <= 1) {
      const count = readU32(fd, s + 20 + 64);
      const paths = readEntries(fd, s + 24 + 64, count, false, size, maxPaths);
      return { formatVersion, godotVersion, encryptedDirectory: false, embedded: loc.embedded, fileCount: count, paths: paths ?? [], note: paths ? undefined : "index illisible" };
    }
    const flags = readU32(fd, s + 20);
    const encryptedDirectory = (flags & 1) === 1;
    if (encryptedDirectory) {
      return { formatVersion, godotVersion, encryptedDirectory, embedded: loc.embedded, fileCount: 0, paths: [], note: "répertoire du PCK chiffré : clé du jeu nécessaire" };
    }
    // Format 2: magic, ver, major, minor, patch, flags, file_base(u64), reserved 16*u32, count, entries.
    const v2Count = readU32(fd, s + 32 + 64);
    const v2 = readEntries(fd, s + 36 + 64, v2Count, true, size, maxPaths);
    if (v2 && formatVersion === 2) {
      return { formatVersion, godotVersion, encryptedDirectory, embedded: loc.embedded, fileCount: v2Count, paths: v2 };
    }
    // Format 3 (Godot 4.4+, best effort): ..., file_base(u64), dir_offset(u64), reserved, then the directory at dir_offset.
    const dirOffset = readU64(fd, s + 32);
    if (dirOffset > 0 && s + dirOffset + 4 < size) {
      const count = readU32(fd, s + dirOffset);
      const v3 = readEntries(fd, s + dirOffset + 4, count, true, size, maxPaths);
      if (v3) return { formatVersion, godotVersion, encryptedDirectory, embedded: loc.embedded, fileCount: count, paths: v3 };
    }
    if (v2) return { formatVersion, godotVersion, encryptedDirectory, embedded: loc.embedded, fileCount: v2Count, paths: v2, note: "format inattendu, lu comme format 2" };
    return { formatVersion, godotVersion, encryptedDirectory, embedded: loc.embedded, fileCount: 0, paths: [], note: "index du PCK non reconnu (format récent ou modifié)" };
  } finally {
    fs.closeSync(fd);
  }
}
