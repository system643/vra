import fs from "node:fs";

/**
 * Streaming pattern search in (possibly huge) binary files, in ASCII and UTF-16LE.
 * Bounded by maxBytes so a 300 MB executable never blocks the server.
 */
export interface ScanOptions {
  maxBytes?: number;
  chunkSize?: number;
  utf16?: boolean;
  maxMatches?: number;
}

export function scanFile(file: string, pattern: RegExp, opts: ScanOptions = {}): string[] {
  const maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;
  const chunkSize = opts.chunkSize ?? 8 * 1024 * 1024;
  const maxMatches = opts.maxMatches ?? 50;
  const overlap = 512;
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  const found = new Set<string>();
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return [];
  }
  try {
    const size = Math.min(fs.fstatSync(fd).size, maxBytes);
    let pos = 0;
    const buf = Buffer.alloc(chunkSize + overlap);
    while (pos < size && found.size < maxMatches) {
      const len = Math.min(chunkSize + overlap, size - pos);
      const n = fs.readSync(fd, buf, 0, len, pos);
      if (n <= 0) break;
      const slice = buf.subarray(0, n);
      const ascii = slice.toString("latin1");
      for (const m of ascii.matchAll(re)) {
        found.add(m[0]);
        if (found.size >= maxMatches) break;
      }
      if (opts.utf16 !== false && found.size < maxMatches) {
        for (const parity of [0, 1]) {
          const sub = slice.subarray(parity, n - ((n - parity) % 2));
          const u16 = sub.toString("utf16le");
          for (const m of u16.matchAll(re)) {
            found.add(m[0]);
            if (found.size >= maxMatches) break;
          }
        }
      }
      if (pos + n >= size) break;
      pos += chunkSize;
    }
  } finally {
    fs.closeSync(fd);
  }
  return [...found];
}

/** Extract printable identifier-like strings from a buffer (for metadata string tables). */
export function identifiersFrom(buf: Buffer, minLen = 4, maxCount = 200000): string[] {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const b = i < buf.length ? buf[i] : 0;
    const ok = (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f || b === 0x2e || b === 0x60 || b === 0x3c || b === 0x3e;
    if (ok) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minLen) {
        out.push(buf.toString("latin1", start, i));
        if (out.length >= maxCount) break;
      }
      start = -1;
    }
  }
  return out;
}

/** Read the FileVersion string from a PE version resource (heuristic, UTF-16 search). */
export function fileVersionOf(file: string): string | null {
  const hits = scanFile(file, /FileVersion\u0000+[0-9][0-9.,\s]{2,30}/, { maxBytes: 128 * 1024 * 1024, utf16: true, maxMatches: 3 });
  for (const h of hits) {
    const v = h.replace(/^FileVersion\u0000+/, "").replace(/\s+/g, "").replace(/,/g, ".");
    if (/^\d+(\.\d+)+$/.test(v)) return v;
  }
  return null;
}
