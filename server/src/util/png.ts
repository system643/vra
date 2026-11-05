import fs from "node:fs";
import zlib from "node:zlib";

/** Minimal PNG decoder (8-bit grayscale/RGB/RGBA/gray+alpha, non-interlaced) → luma plane. */

export interface Luma {
  width: number;
  height: number;
  /** Row-major luma 0–255. */
  data: Float32Array;
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePngLuma(file: string): Luma {
  const buf = fs.readFileSync(file);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error("Pas un PNG (seuls les PNG sont analysés ; un JPEG se regarde directement avec Read).");
  let p = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`PNG non pris en charge (profondeur ${depth}, entrelacement ${interlace}).`);
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error(`Type de couleur PNG non pris en charge : ${colorType}.`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Float32Array(width * height);
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1);
    const filter = raw[off];
    for (let x = 0; x < stride; x++) {
      const v = raw[off + 1 + x];
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      cur[x] = filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : paeth(a, b, c) + v;
    }
    for (let x = 0; x < width; x++) {
      const i = x * channels;
      out[y * width + x] = channels >= 3 ? 0.299 * cur[i] + 0.587 * cur[i + 1] + 0.114 * cur[i + 2] : cur[i];
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

/** Box-downsample to a target width (keeps aspect ratio). */
export function downsample(img: Luma, targetWidth: number): Luma {
  const scale = Math.max(1, Math.floor(img.width / targetWidth));
  const w = Math.floor(img.width / scale);
  const h = Math.floor(img.height / scale);
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) s += img.data[(y * scale + dy) * img.width + x * scale + dx];
      data[y * w + x] = s / (scale * scale);
    }
  }
  return { width: w, height: h, data };
}

export function crop(img: Luma, x0: number, y0: number, w: number, h: number): Luma {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = img.data[(y0 + y) * img.width + x0 + x];
  return { width: w, height: h, data };
}

/** Encode an 8-bit grayscale PNG (used by tests to build synthetic frames). */
export function encodePngGray(width: number, height: number, pixel: (x: number, y: number) => number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(pixel(x, y))));
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

let crcTable: Int32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
