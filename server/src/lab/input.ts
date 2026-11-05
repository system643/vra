import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { ensureDir, pluginRoot, profileDir } from "../paths.js";
import { readJson, timestamp, writeJson } from "../util/fsx.js";

/**
 * Game UI control: lets the agent drive the game's own menus (click "Nouvelle partie",
 * press Enter, type a name…) so the Lab can go from launch to gameplay by itself.
 * A long-lived PowerShell worker (marker/vra-input-worker.ps1) does the Win32 input and the
 * built-in Windows OCR; every input is refused unless the game window is in the foreground,
 * and the automation stops as soon as the user moves the mouse.
 */

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OcrLine extends OcrWord {
  words: OcrWord[];
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

class InputWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private start() {
    const script = path.join(pluginRoot(), "marker", "vra-input-worker.ps1");
    if (!fs.existsSync(script)) throw new Error(`Script de contrôle introuvable : ${script}`);
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
    this.proc = p;
    createInterface({ input: p.stdout }).on("line", (line) => {
      let msg: { id: number; ok: boolean; result?: unknown; error?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const w = this.pending.get(msg.id);
      if (!w) return;
      clearTimeout(w.timer);
      this.pending.delete(msg.id);
      if (msg.ok) w.resolve(msg.result);
      else w.reject(new Error(msg.error ?? "erreur du contrôleur"));
    });
    p.on("exit", () => {
      for (const w of this.pending.values()) {
        clearTimeout(w.timer);
        w.reject(new Error("le contrôleur d'interface s'est arrêté"));
      }
      this.pending.clear();
      this.proc = null;
    });
  }

  call<T = any>(op: string, args: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
    if (process.platform !== "win32") return Promise.reject(new Error("Contrôle de l'interface des jeux : Windows uniquement."));
    if (!this.proc) this.start();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`délai dépassé pour « ${op} »`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin.write(JSON.stringify({ id, op, ...args }) + "\n");
    });
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
  }
}

export const worker = new InputWorker();

/** PID of a running process by executable name (first match), or null. */
export function pidByExe(exeName: string): number | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("tasklist", ["/FO", "CSV", "/NH", "/FI", `IMAGENAME eq ${exeName}`], { encoding: "utf8", windowsHide: true });
    const m = /^"[^"]+","(\d+)"/m.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Accent/case-insensitive normalisation used to match on-screen text. */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Best OCR match for a query: whole line containing the query, else consecutive words. */
export function matchText(lines: OcrLine[], query: string): { text: string; x: number; y: number; w: number; h: number; score: number } | null {
  const q = norm(query);
  if (!q) return null;
  let best: { text: string; x: number; y: number; w: number; h: number; score: number } | null = null;
  const consider = (text: string, box: OcrWord, score: number) => {
    if (!best || score > best.score) best = { text, x: box.x, y: box.y, w: box.w, h: box.h, score };
  };
  for (const l of lines) {
    const ln = norm(l.text);
    if (ln === q) consider(l.text, l, 1);
    // consecutive words of the line that spell the query
    for (let i = 0; i < l.words.length; i++) {
      for (let j = i; j < l.words.length && j < i + 6; j++) {
        const seg = l.words.slice(i, j + 1);
        const t = norm(seg.map((w) => w.text).join(" "));
        if (t === q) {
          const x0 = Math.min(...seg.map((w) => w.x)), y0 = Math.min(...seg.map((w) => w.y));
          const x1 = Math.max(...seg.map((w) => w.x + w.w)), y1 = Math.max(...seg.map((w) => w.y + w.h));
          consider(seg.map((w) => w.text).join(" "), { text: t, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 0.95);
        }
      }
    }
    if (ln.includes(q)) consider(l.text, l, 0.7 - Math.min(0.3, (ln.length - q.length) / 100));
  }
  return best;
}

export interface UiTarget {
  pid: number;
  gamePath: string;
}

function capDir(gamePath: string): string {
  return ensureDir(path.join(profileDir(gamePath), "lab", "ui"));
}

export async function uiWindow(t: UiTarget) {
  return worker.call("window", { pid: t.pid });
}

export async function uiCapture(t: UiTarget, focus = true): Promise<{ file: string; w: number; h: number; foreground: boolean }> {
  const out = path.join(capDir(t.gamePath), `ui_${timestamp()}.png`);
  return worker.call("capture", { pid: t.pid, out, focus });
}

export async function uiOcr(file: string): Promise<{ language: string; lines: OcrLine[] }> {
  const r = await worker.call<{ language: string; lines: OcrLine[] | OcrLine }>("ocr", { file }, 60000);
  const lines = Array.isArray(r.lines) ? r.lines : r.lines ? [r.lines] : [];
  return { language: r.language, lines: lines.map((l) => ({ ...l, words: Array.isArray(l.words) ? l.words : l.words ? [l.words as unknown as OcrWord] : [] })) };
}

export async function uiFindText(t: UiTarget, query: string) {
  const cap = await uiCapture(t);
  const ocr = await uiOcr(cap.file);
  const m = matchText(ocr.lines, query);
  return { capture: cap.file, match: m, visibleText: ocr.lines.map((l) => l.text).slice(0, 40) };
}

export async function uiClick(t: UiTarget, x: number, y: number, opts: { button?: "left" | "right"; count?: number } = {}) {
  await worker.call("focus", { pid: t.pid });
  return worker.call("click", { pid: t.pid, x: Math.round(x), y: Math.round(y), button: opts.button ?? "left", count: opts.count ?? 1 });
}

export async function uiClickText(t: UiTarget, query: string) {
  const f = await uiFindText(t, query);
  if (!f.match) throw new Error(`texte « ${query} » introuvable à l'écran. Texte visible : ${f.visibleText.join(" | ").slice(0, 400)}`);
  const cx = f.match.x + f.match.w / 2, cy = f.match.y + f.match.h / 2;
  await uiClick(t, cx, cy);
  return { clicked: f.match.text, x: Math.round(cx), y: Math.round(cy), capture: f.capture };
}

export async function uiKey(t: UiTarget, keys: string, opts: { repeat?: number; hold_ms?: number } = {}) {
  await worker.call("focus", { pid: t.pid });
  return worker.call("key", { pid: t.pid, keys, repeat: opts.repeat ?? 1, hold_ms: opts.hold_ms ?? 60 });
}

export async function uiType(t: UiTarget, text: string) {
  await worker.call("focus", { pid: t.pid });
  return worker.call("type", { pid: t.pid, text });
}

export async function uiWaitText(t: UiTarget, query: string, timeoutMs = 60000, intervalMs = 1500) {
  const t0 = Date.now();
  let last: string[] = [];
  while (Date.now() - t0 < timeoutMs) {
    const f = await uiFindText(t, query);
    if (f.match) return { found: f.match.text, after_ms: Date.now() - t0, capture: f.capture };
    last = f.visibleText;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`« ${query} » n'est pas apparu en ${Math.round(timeoutMs / 1000)} s. Dernier texte visible : ${last.join(" | ").slice(0, 300)}`);
}

/* ───────────────────────── Menu recipes (launch → gameplay, replayable) ───────────────────────── */

export type UiStep =
  | { do: "wait_text"; text: string; timeout_s?: number }
  | { do: "click_text"; text: string }
  | { do: "click"; x: number; y: number }
  | { do: "key"; keys: string; repeat?: number; hold_ms?: number }
  | { do: "type"; text: string }
  | { do: "wait"; ms: number };

export function recipeFile(gamePath: string): string {
  return path.join(ensureDir(path.join(profileDir(gamePath), "lab")), "menu_recipe.json");
}

export function readRecipe(gamePath: string): { name: string; steps: UiStep[]; savedAt?: string } | null {
  return readJson(recipeFile(gamePath), null as { name: string; steps: UiStep[]; savedAt?: string } | null);
}

export function saveRecipe(gamePath: string, name: string, steps: UiStep[]) {
  writeJson(recipeFile(gamePath), { name, steps, savedAt: new Date().toISOString() });
}

export async function runUiSteps(t: UiTarget, steps: UiStep[]): Promise<Array<{ step: UiStep; ok: boolean; detail?: unknown; error?: string; ms: number }>> {
  const out: Array<{ step: UiStep; ok: boolean; detail?: unknown; error?: string; ms: number }> = [];
  for (const s of steps) {
    const t0 = Date.now();
    try {
      let detail: unknown;
      if (s.do === "wait_text") detail = await uiWaitText(t, s.text, (s.timeout_s ?? 60) * 1000);
      else if (s.do === "click_text") detail = await uiClickText(t, s.text);
      else if (s.do === "click") detail = await uiClick(t, s.x, s.y);
      else if (s.do === "key") detail = await uiKey(t, s.keys, { repeat: s.repeat, hold_ms: s.hold_ms });
      else if (s.do === "type") detail = await uiType(t, s.text);
      else if (s.do === "wait") await new Promise((r) => setTimeout(r, Math.min(s.ms, 120000)));
      out.push({ step: s, ok: true, detail, ms: Date.now() - t0 });
    } catch (e) {
      out.push({ step: s, ok: false, error: (e as Error).message, ms: Date.now() - t0 });
      break;
    }
  }
  return out;
}
