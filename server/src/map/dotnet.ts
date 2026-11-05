import fs from "node:fs";
import { readPe, rvaToOffset } from "../util/pe.js";

/**
 * Minimal ECMA-335 metadata reader: type names, namespaces, base types and
 * method names of a .NET assembly (e.g. Unity's Assembly-CSharp.dll).
 * Static and read-only: the game is never executed.
 */

export interface DotNetType {
  namespace: string;
  name: string;
  baseType: string | null;
  methods: string[];
  fields: string[];
}

export interface DotNetAssembly {
  types: DotNetType[];
  typeRefs: string[];
}

const TABLE_NAMES = 64;

export function readAssembly(file: string): DotNetAssembly {
  const pe = readPe(file);
  if (!pe.isDotNet) throw new Error("Pas une assembly .NET (en-tête CLR absent)");
  const data = fs.readFileSync(file);
  const clr = pe.dataDirs[14];
  const clrOff = rvaToOffset(pe.sections, clr.rva);
  if (clrOff === null) throw new Error("En-tête CLR introuvable");
  const mdRva = data.readUInt32LE(clrOff + 8);
  const mdOff = rvaToOffset(pe.sections, mdRva);
  if (mdOff === null || data.readUInt32LE(mdOff) !== 0x424a5342) throw new Error("Racine de métadonnées invalide (assembly protégée ?)");
  const verLen = data.readUInt32LE(mdOff + 12);
  let p = mdOff + 16 + verLen;
  p += 2; // flags
  const nStreams = data.readUInt16LE(p);
  p += 2;
  const streams: Record<string, { off: number; size: number }> = {};
  for (let i = 0; i < nStreams; i++) {
    const off = data.readUInt32LE(p);
    const size = data.readUInt32LE(p + 4);
    p += 8;
    let end = p;
    while (data[end] !== 0) end++;
    const name = data.toString("latin1", p, end);
    p = end + 1;
    p = (p + 3) & ~3;
    streams[name] = { off: mdOff + off, size };
  }
  const tbl = streams["#~"] ?? streams["#-"];
  const strs = streams["#Strings"];
  if (!tbl || !strs) throw new Error("Flux de métadonnées manquants");
  const heapSizes = data[tbl.off + 6];
  const valid = data.readBigUInt64LE(tbl.off + 8);
  const strIdx = heapSizes & 1 ? 4 : 2;
  const guidIdx = heapSizes & 2 ? 4 : 2;
  const blobIdx = heapSizes & 4 ? 4 : 2;
  const rows: number[] = new Array(TABLE_NAMES).fill(0);
  let rp = tbl.off + 24;
  for (let i = 0; i < TABLE_NAMES; i++) {
    if ((valid >> BigInt(i)) & 1n) {
      rows[i] = data.readUInt32LE(rp);
      rp += 4;
    }
  }
  if (streams["#-"] && heapSizes & 0x20) rp += 4; // extra data in uncompressed tables
  const idx = (t: number) => (rows[t] > 0xffff ? 4 : 2);
  const coded = (tables: number[], bits: number) => (Math.max(...tables.map((t) => rows[t])) < 1 << (16 - bits) ? 2 : 4);
  const resolutionScope = coded([0x00, 0x1a, 0x23, 0x01], 2);
  const typeDefOrRef = coded([0x02, 0x01, 0x1b], 2);
  const sizes: Record<number, number> = {
    0x00: 2 + strIdx + guidIdx * 3,
    0x01: resolutionScope + strIdx * 2,
    0x02: 4 + strIdx * 2 + typeDefOrRef + idx(0x04) + idx(0x06),
    0x03: idx(0x04),
    0x04: 2 + strIdx + blobIdx,
    0x05: idx(0x06),
    0x06: 4 + 2 + 2 + strIdx + blobIdx + idx(0x08),
  };
  const read = (off: number, n: number) => (n === 2 ? data.readUInt16LE(off) : data.readUInt32LE(off));
  const str = (i: number) => {
    const s = strs.off + i;
    let e = s;
    while (e < strs.off + strs.size && data[e] !== 0) e++;
    return data.toString("utf8", s, e);
  };
  const tableStart: Record<number, number> = {};
  let cur = rp;
  for (let t = 0; t <= 0x06; t++) {
    tableStart[t] = cur;
    cur += (sizes[t] ?? 0) * rows[t];
  }
  // TypeRef
  const typeRefs: string[] = [];
  for (let i = 0; i < rows[0x01]; i++) {
    const o = tableStart[0x01] + i * sizes[0x01] + resolutionScope;
    const name = str(read(o, strIdx));
    const ns = str(read(o + strIdx, strIdx));
    typeRefs.push(ns ? `${ns}.${name}` : name);
  }
  // Fields and MethodDefs (names only)
  const fieldNames: string[] = [];
  for (let i = 0; i < rows[0x04]; i++) fieldNames.push(str(read(tableStart[0x04] + i * sizes[0x04] + 2, strIdx)));
  const methodNames: string[] = [];
  for (let i = 0; i < rows[0x06]; i++) methodNames.push(str(read(tableStart[0x06] + i * sizes[0x06] + 8, strIdx)));
  // TypeDef
  const raw: Array<{ ns: string; name: string; ext: number; fieldList: number; methodList: number }> = [];
  for (let i = 0; i < rows[0x02]; i++) {
    let o = tableStart[0x02] + i * sizes[0x02] + 4;
    const name = str(read(o, strIdx));
    o += strIdx;
    const ns = str(read(o, strIdx));
    o += strIdx;
    const ext = read(o, typeDefOrRef);
    o += typeDefOrRef;
    const fieldList = read(o, idx(0x04));
    o += idx(0x04);
    const methodList = read(o, idx(0x06));
    raw.push({ ns, name, ext, fieldList, methodList });
  }
  const fullName = (r: { ns: string; name: string }) => (r.ns ? `${r.ns}.${r.name}` : r.name);
  const types: DotNetType[] = raw.map((r, i) => {
    const tag = r.ext & 3;
    const ri = r.ext >> 2;
    let baseType: string | null = null;
    if (ri > 0) {
      if (tag === 0 && raw[ri - 1]) baseType = fullName(raw[ri - 1]);
      else if (tag === 1 && typeRefs[ri - 1]) baseType = typeRefs[ri - 1];
      else if (tag === 2) baseType = "(TypeSpec)";
    }
    const mEnd = i + 1 < raw.length ? raw[i + 1].methodList : rows[0x06] + 1;
    const fEnd = i + 1 < raw.length ? raw[i + 1].fieldList : rows[0x04] + 1;
    return {
      namespace: r.ns,
      name: r.name,
      baseType,
      methods: methodNames.slice(r.methodList - 1, mEnd - 1),
      fields: fieldNames.slice(r.fieldList - 1, fEnd - 1),
    };
  });
  return { types, typeRefs };
}

/** Walk base types inside the assembly until an external base (e.g. UnityEngine.MonoBehaviour) is reached. */
export function rootBase(asm: DotNetAssembly, t: DotNetType, depth = 0): string | null {
  if (!t.baseType || depth > 20) return t.baseType;
  const local = asm.types.find((x) => (x.namespace ? `${x.namespace}.${x.name}` : x.name) === t.baseType);
  if (!local) return t.baseType;
  return rootBase(asm, local, depth + 1);
}
