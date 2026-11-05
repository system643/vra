import fs from "node:fs";

/**
 * Minimal, defensive PE reader: machine type, sections, import DLL names,
 * CLR (.NET) header location. Reads only what it needs.
 */

export interface Section {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawPointer: number;
  rawSize: number;
}

export interface PeInfo {
  machine: "x86" | "x64" | "arm64" | "other";
  is64: boolean;
  sections: Section[];
  imports: string[];
  /** Data directory entries (rva, size) by index. */
  dataDirs: Array<{ rva: number; size: number }>;
  isDotNet: boolean;
}

export class PeError extends Error {}

function readAt(fd: number, pos: number, len: number): Buffer {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

export function rvaToOffset(sections: Section[], rva: number): number | null {
  for (const s of sections) {
    const size = Math.max(s.virtualSize, s.rawSize);
    if (rva >= s.virtualAddress && rva < s.virtualAddress + size) {
      return rva - s.virtualAddress + s.rawPointer;
    }
  }
  return null;
}

function readCString(fd: number, pos: number, max = 256): string {
  const buf = readAt(fd, pos, max);
  const end = buf.indexOf(0);
  return buf.subarray(0, end >= 0 ? end : buf.length).toString("latin1");
}

export function readPe(file: string): PeInfo {
  const fd = fs.openSync(file, "r");
  try {
    const dos = readAt(fd, 0, 64);
    if (dos.length < 64 || dos.readUInt16LE(0) !== 0x5a4d) throw new PeError("Pas un exécutable PE (signature MZ absente)");
    const peOff = dos.readUInt32LE(0x3c);
    const nt = readAt(fd, peOff, 24);
    if (nt.length < 24 || nt.readUInt32LE(0) !== 0x00004550) throw new PeError("En-tête PE invalide");
    const machineRaw = nt.readUInt16LE(4);
    const numSections = nt.readUInt16LE(6);
    const optSize = nt.readUInt16LE(20);
    const opt = readAt(fd, peOff + 24, optSize);
    const magic = opt.readUInt16LE(0);
    const is64 = magic === 0x20b;
    const ddOffset = is64 ? 112 : 96;
    const numDirs = Math.min(opt.readUInt32LE(ddOffset - 4), 16);
    const dataDirs: Array<{ rva: number; size: number }> = [];
    for (let i = 0; i < numDirs; i++) {
      const o = ddOffset + i * 8;
      if (o + 8 > opt.length) break;
      dataDirs.push({ rva: opt.readUInt32LE(o), size: opt.readUInt32LE(o + 4) });
    }
    const secTable = readAt(fd, peOff + 24 + optSize, numSections * 40);
    const sections: Section[] = [];
    for (let i = 0; i < numSections; i++) {
      const o = i * 40;
      if (o + 40 > secTable.length) break;
      sections.push({
        name: secTable.subarray(o, o + 8).toString("latin1").replace(/\0+$/, ""),
        virtualSize: secTable.readUInt32LE(o + 8),
        virtualAddress: secTable.readUInt32LE(o + 12),
        rawSize: secTable.readUInt32LE(o + 16),
        rawPointer: secTable.readUInt32LE(o + 20),
      });
    }
    const imports: string[] = [];
    const imp = dataDirs[1];
    if (imp && imp.rva && imp.size) {
      const off = rvaToOffset(sections, imp.rva);
      if (off !== null) {
        for (let i = 0; i < 4096; i++) {
          const desc = readAt(fd, off + i * 20, 20);
          if (desc.length < 20) break;
          const nameRva = desc.readUInt32LE(12);
          const allZero = desc.every((b) => b === 0);
          if (allZero) break;
          const nameOff = rvaToOffset(sections, nameRva);
          if (nameOff !== null) imports.push(readCString(fd, nameOff).toLowerCase());
        }
      }
    }
    const delay = dataDirs[13];
    if (delay && delay.rva && delay.size) {
      const off = rvaToOffset(sections, delay.rva);
      if (off !== null) {
        for (let i = 0; i < 1024; i++) {
          const desc = readAt(fd, off + i * 32, 32);
          if (desc.length < 32 || desc.every((b) => b === 0)) break;
          const nameRva = desc.readUInt32LE(4);
          const nameOff = rvaToOffset(sections, nameRva);
          if (nameOff !== null) imports.push(readCString(fd, nameOff).toLowerCase());
        }
      }
    }
    const clr = dataDirs[14];
    const machine = machineRaw === 0x8664 ? "x64" : machineRaw === 0x14c ? "x86" : machineRaw === 0xaa64 ? "arm64" : "other";
    return {
      machine,
      is64,
      sections,
      imports: [...new Set(imports.filter(Boolean))],
      dataDirs,
      isDotNet: !!(clr && clr.rva && clr.size),
    };
  } finally {
    fs.closeSync(fd);
  }
}

export function tryReadPe(file: string): PeInfo | null {
  try {
    return readPe(file);
  } catch {
    return null;
  }
}
