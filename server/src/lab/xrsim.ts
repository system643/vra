import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { ensureDir, profileDir } from "../paths.js";
import { timestamp } from "../util/fsx.js";

/**
 * Full control of Meta XR Simulator through Meta's official CLI `metavr`
 * (npm package `metavr` → @meta-quest/metavr, repo meta-quest/agentic-tools).
 *
 * Only the `xrsim` group is reachable (plus `tools install meta-xr-operator`).
 * Refused on purpose:
 *   - `runtime activate|deactivate`: they change the system OpenXR runtime
 *     (registry) — VRA activates the simulator per process only;
 *   - `--all` everywhere, `--force` except on `app quit` after a graceful quit failed.
 * Output: `metavr --format json …` is the only stable format.
 */

export interface MetavrResult {
  ok: boolean;
  code: number;
  argv: string[];
  json: unknown;
  stdout: string;
  stderr: string;
  ms: number;
}

export interface MetavrCmd {
  cmd: string;
  pre: string[];
  source: string;
}

function onPath(name: string): string | null {
  try {
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // On Windows prefer a real executable over a .cmd shim (spawning .cmd needs a shell).
    return lines.find((l) => /\.exe$/i.test(l)) ?? (process.platform === "win32" ? null : lines[0] ?? null);
  } catch {
    return null;
  }
}

let cached: MetavrCmd | null | undefined;

/** How to run metavr: VRA_METAVR_CMD (tests / custom), the standalone binary, or `npx -y metavr` through node. */
export function metavrCommand(): MetavrCmd | null {
  const env = process.env.VRA_METAVR_CMD?.trim();
  if (env) {
    if (/\.(m?js|cjs)$/i.test(env)) return { cmd: process.execPath, pre: [env], source: "VRA_METAVR_CMD (script node)" };
    return { cmd: env, pre: [], source: "VRA_METAVR_CMD" };
  }
  if (cached !== undefined) return cached;
  const bin = onPath("metavr");
  if (bin) return (cached = { cmd: bin, pre: [], source: `binaire ${bin}` });
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (fs.existsSync(npxCli)) return (cached = { cmd: process.execPath, pre: [npxCli, "-y", "metavr"], source: "npx -y metavr" });
  return (cached = null);
}

export function resetMetavrCacheForTests() {
  cached = undefined;
}

const SAFE_TOKEN = /^[\w .:@\-+/\\=,()]{0,260}$/;
const ALLOWED_GROUPS = new Set(["app", "runtime", "device", "env", "input", "layer", "record"]);
const FORBIDDEN_RUNTIME = new Set(["activate", "deactivate"]);

/** Validates an argv placed after `metavr --format json xrsim`. Throws with a clear reason. */
export function validateXrsimArgv(argv: string[], opts: { allowForce?: boolean } = {}): void {
  let i = 0;
  // xrsim global options first
  while (argv[i]?.startsWith("--")) {
    if (argv[i] === "--port" || argv[i] === "--timeout") {
      if (!/^\d{1,5}$/.test(argv[i + 1] ?? "")) throw new Error(`${argv[i]} attend un nombre`);
      i += 2;
    } else throw new Error(`Option globale refusée : ${argv[i]}`);
  }
  const group = argv[i];
  if (!group || !ALLOWED_GROUPS.has(group)) throw new Error(`Groupe xrsim non autorisé : ${group ?? "(vide)"}. Autorisés : ${[...ALLOWED_GROUPS].join(", ")}.`);
  if (group === "runtime" && FORBIDDEN_RUNTIME.has(argv[i + 1] ?? "")) throw new Error("runtime activate/deactivate refusé : cela change le runtime OpenXR du système (registre). VRA active le simulateur par processus seulement.");
  for (const a of argv) {
    if (a === "--all") throw new Error("--all refusé : VRA n'agit que sur son propre simulateur.");
    if (a === "--force" && !(opts.allowForce && group === "app" && argv[i + 1] === "quit")) throw new Error("--force refusé (autorisé seulement pour app quit après un arrêt normal raté).");
    if (a === "--elevate") throw new Error("--elevate refusé.");
    if (!SAFE_TOKEN.test(a)) throw new Error(`Argument refusé : ${JSON.stringify(a)}`);
  }
}

function parseJsonLoose(s: string): unknown {
  const t = s.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    /* several JSON lines, or text before the JSON */
  }
  const lines = t.split(/\r?\n/).filter((l) => /^[[{]/.test(l.trim()));
  for (let k = lines.length - 1; k >= 0; k--) {
    try {
      return JSON.parse(lines[k]);
    } catch {
      /* next */
    }
  }
  const first = t.search(/[[{]/);
  if (first >= 0) {
    try {
      return JSON.parse(t.slice(first));
    } catch {
      /* not JSON */
    }
  }
  return null;
}

function run(cmd: MetavrCmd, fullArgv: string[], timeoutMs: number): Promise<MetavrResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    execFile(cmd.cmd, [...cmd.pre, ...fullArgv], { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ ok: !err, code, argv: fullArgv, json: parseJsonLoose(String(stdout)), stdout: String(stdout).slice(0, 20000), stderr: String(stderr).slice(0, 4000), ms: Date.now() - t0 });
    });
  });
}

/** Runs `metavr --format json xrsim <argv…>` after validation. */
export async function xrsim(argv: string[], opts: { timeoutMs?: number; allowForce?: boolean; port?: number } = {}): Promise<MetavrResult> {
  const full = [...(opts.port ? ["--port", String(opts.port)] : []), ...argv];
  validateXrsimArgv(full, { allowForce: opts.allowForce });
  const cmd = metavrCommand();
  if (!cmd) return { ok: false, code: -1, argv: full, json: null, stdout: "", stderr: "metavr introuvable (ni binaire, ni npx).", ms: 0 };
  return run(cmd, ["--format", "json", "xrsim", ...full], opts.timeoutMs ?? 60000);
}

/** `metavr tools install meta-xr-operator` (no --elevate, no --force). */
export async function installOperatorWithMetavr(): Promise<MetavrResult> {
  const cmd = metavrCommand();
  if (!cmd) return { ok: false, code: -1, argv: [], json: null, stdout: "", stderr: "metavr introuvable.", ms: 0 };
  return run(cmd, ["--format", "json", "tools", "install", "meta-xr-operator"], 900000);
}

export async function metavrHelp(): Promise<string> {
  const cmd = metavrCommand();
  if (!cmd) return "metavr introuvable.";
  const r = await run(cmd, ["xrsim", "--help"], 60000);
  return `${r.stdout}${r.stderr}`.slice(0, 8000);
}

/* ───────────────────────── Named actions ───────────────────────── */

export const XRSIM_ACTIONS = [
  "ensure_running", "launch", "quit", "ping", "status", "info", "list", "fps", "logs",
  "device_list", "device_set", "refresh_rates", "refresh_rate", "ipd",
  "input_controllers", "input_headset", "input_follow", "input_speed",
  "env_list", "env_set", "layers", "layer_toggle",
  "record_start", "record_stop", "record_status", "help",
] as const;
export type XrsimAction = (typeof XRSIM_ACTIONS)[number];

export interface XrsimActionArgs {
  port?: number;
  name?: string;
  rate?: number;
  value?: number | string;
  active?: boolean;
  hand?: "left" | "right" | "both";
  mode?: "head" | "body";
  id?: string;
  state?: "on" | "off";
  output?: string;
  duration?: number;
  tail?: number;
  wait_timeout?: number;
}

/** argv (after `xrsim`) for a named action. Pure: tested without metavr. */
export function argvFor(action: XrsimAction, a: XrsimActionArgs = {}): string[][] {
  const req = <T>(v: T | undefined, what: string): T => {
    if (v === undefined || v === null || v === "") throw new Error(`${action} : ${what} requis`);
    return v;
  };
  switch (action) {
    case "ensure_running":
      return [["app", "ensure-running", "--wait-timeout", String(a.wait_timeout ?? 60)]];
    case "launch":
      return [["app", "launch", "--wait-timeout", String(a.wait_timeout ?? 60)]];
    case "quit":
      return [["app", "quit"]];
    case "ping":
    case "status":
    case "info":
    case "list":
    case "fps":
      return [["runtime", action]];
    case "logs":
      return [["runtime", "logs", "--tail", String(a.tail ?? 80)]];
    case "device_list":
      return [["device", "list"]];
    case "device_set":
      return [["device", "set", "--name", req(a.name, "name"), "--wait"]];
    case "refresh_rates":
      return [["device", "refresh-rates"]];
    case "refresh_rate":
      return [["device", "refresh-rate", "--rate", String(req(a.rate, "rate")), "--wait"]];
    case "ipd":
      return [["device", "ipd", "--value", String(req(a.value, "value")), "--wait"]];
    case "input_controllers": {
      const hands = a.hand === "left" ? ["left"] : a.hand === "right" ? ["right"] : ["left", "right"];
      return hands.map((h) => ["input", "controller", "--hand", h, "--active", String(a.active ?? true), "--wait"]);
    }
    case "input_headset":
      return [["input", "headset", "--active", String(a.active ?? true), "--wait"]];
    case "input_follow":
      return [["input", "follow", req(a.mode, "mode (head|body)"), "--wait"]];
    case "input_speed":
      return [["input", "speed", "--value", String(req(a.value, "value")), "--wait"]];
    case "env_list":
      return [["env", "list"]];
    case "env_set":
      return [["env", "set", "--id", req(a.id, "id")]];
    case "layers":
      return [["layer", "list"]];
    case "layer_toggle":
      return [["layer", "toggle", req(a.id, "id"), req(a.state, "state (on|off)")]];
    case "record_start":
      return [["record", "start", "--output", req(a.output, "output"), "--overwrite", ...(a.duration ? ["--duration", String(a.duration)] : [])]];
    case "record_stop":
      return [["record", "stop"]];
    case "record_status":
      return [["record", "status"]];
    case "help":
      return [];
  }
}

export async function xrsimAction(action: XrsimAction, a: XrsimActionArgs = {}): Promise<{ action: XrsimAction; ok: boolean; results: MetavrResult[]; note?: string }> {
  if (action === "help") return { action, ok: true, results: [{ ok: true, code: 0, argv: ["xrsim", "--help"], json: null, stdout: await metavrHelp(), stderr: "", ms: 0 }] };
  if (action === "quit") return quitSimulator(a.port);
  const results: MetavrResult[] = [];
  for (const argv of argvFor(action, a)) {
    const r = await xrsim(argv, { port: a.port, timeoutMs: action === "ensure_running" || action === "launch" ? ((a.wait_timeout ?? 60) + 30) * 1000 : 60000 });
    results.push(r);
    if (!r.ok) break;
  }
  return { action, ok: results.every((r) => r.ok), results };
}

/** Graceful quit of the simulator frontend on one port; --force only after the graceful quit failed. */
export async function quitSimulator(port?: number) {
  const results: MetavrResult[] = [];
  const graceful = await xrsim(["app", "quit"], { port });
  results.push(graceful);
  if (graceful.ok) return { action: "quit" as const, ok: true, results };
  const forced = await xrsim(["app", "quit", "--force"], { port, allowForce: true });
  results.push(forced);
  return { action: "quit" as const, ok: forced.ok, results, note: "Arrêt normal raté : arrêt forcé du simulateur (port VRA seulement)." };
}

/* ───────────────────────── Helpers on JSON output ───────────────────────── */

/** First finite number under a key matching re (deep). */
export function findNumber(obj: unknown, re: RegExp): number | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (re.test(k) && typeof v === "number" && Number.isFinite(v)) return v;
    if (re.test(k) && typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const n = findNumber(v, re);
    if (n !== null) return n;
  }
  return null;
}

/** First array found (deep), for `runtime list`. */
export function findArray(obj: unknown): unknown[] | null {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== "object") return null;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const a = findArray(v);
    if (a) return a;
  }
  return null;
}

export function findStringEnding(obj: unknown, ext: RegExp): string | null {
  if (typeof obj === "string") return ext.test(obj) ? obj : null;
  if (!obj || typeof obj !== "object") return null;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const s = findStringEnding(v, ext);
    if (s) return s;
  }
  return null;
}

/** Simulator FPS, or null if unavailable. Never throws. */
export async function simulatorFps(port?: number): Promise<number | null> {
  try {
    if (!metavrCommand()) return null;
    const r = await xrsim(["runtime", "fps"], { port, timeoutMs: 20000 });
    if (!r.ok) return null;
    const n = findNumber(r.json, /fps|frame_?rate|framerate/i) ?? (typeof r.json === "number" ? r.json : null);
    return n !== null && n > 0 && n < 1000 ? Math.round(n * 10) / 10 : null;
  } catch {
    return null;
  }
}

/* ───────────────────────── Tiered diagnosis ───────────────────────── */

export interface XrsimDiagnosis {
  metavr: string | null;
  tiers: Array<{ tier: string; ok: boolean; detail: string }>;
  broken: "metavr_absent" | "simulator_absent" | "no_app_connected" | "app_dead" | null;
  fix: string | null;
  auto_fix: Array<{ tool: string; args: Record<string, unknown> }>;
}

function short(r: MetavrResult): string {
  return (r.ok ? JSON.stringify(r.json ?? r.stdout.trim()) : `${r.stderr || r.stdout}`.trim() || `code ${r.code}`).slice(0, 400);
}

/** Meta's order: runtime logs → runtime list → runtime status. Names the broken link and the fix. */
export async function diagnose(port?: number): Promise<XrsimDiagnosis> {
  const cmd = metavrCommand();
  const out: XrsimDiagnosis = { metavr: cmd?.source ?? null, tiers: [], broken: null, fix: null, auto_fix: [] };
  if (!cmd) {
    out.broken = "metavr_absent";
    out.fix = "Installer Node.js puis relancer (npx -y metavr), ou le binaire autonome metavr de Meta. Le setup VRA (mode autonome) le préinstalle.";
    return out;
  }
  const logs = await xrsim(["runtime", "logs", "--tail", "60"], { port, timeoutMs: 30000 });
  out.tiers.push({ tier: "runtime logs", ok: logs.ok, detail: short(logs) });
  const list = await xrsim(["runtime", "list"], { port, timeoutMs: 30000 });
  out.tiers.push({ tier: "runtime list", ok: list.ok, detail: short(list) });
  if (!logs.ok && !list.ok) {
    out.broken = "simulator_absent";
    out.fix = "Le simulateur (frontend) ne répond pas : xrsim_control action=ensure_running, puis relancer le jeu (lab_launch).";
    out.auto_fix = [{ tool: "xrsim_control", args: { action: "ensure_running" } }, { tool: "lab_launch", args: {} }];
    return out;
  }
  const apps = list.ok ? findArray(list.json) : null;
  if (apps && apps.length === 0) {
    out.broken = "no_app_connected";
    out.fix = "Simulateur en marche mais aucune application connectée : le jeu n'a pas chargé le runtime (XR_RUNTIME_JSON), a planté, ou l'injecteur n'a pas démarré la VR. lab_stop puis lab_launch ; si ça se répète : collect_evidence (log UEVR / BepInEx).";
    out.auto_fix = [{ tool: "lab_stop", args: {} }, { tool: "lab_launch", args: {} }];
    return out;
  }
  const status = await xrsim(["runtime", "status"], { port, timeoutMs: 30000 });
  out.tiers.push({ tier: "runtime status", ok: status.ok, detail: short(status) });
  if (!status.ok) {
    out.broken = "app_dead";
    out.fix = "Une application est listée mais ne répond plus (figée ou morte) : lab_stop puis lab_launch.";
    out.auto_fix = [{ tool: "lab_stop", args: {} }, { tool: "lab_launch", args: {} }];
  }
  return out;
}

/* ───────────────────────── Video ───────────────────────── */

export function videoFile(gamePath: string, label: string): string {
  return path.join(ensureDir(path.join(profileDir(gamePath), "lab", "videos")), `${timestamp()}_${label.replace(/[^\w-]+/g, "_")}.mp4`);
}

export async function recordStart(gamePath: string, label: string, port?: number): Promise<{ ok: boolean; file: string; error?: string }> {
  const file = videoFile(gamePath, label);
  const r = await xrsim(["record", "start", "--output", file, "--overwrite"], { port, timeoutMs: 30000 });
  return { ok: r.ok, file, ...(r.ok ? {} : { error: short(r) }) };
}

export async function recordStop(port?: number, expected?: string): Promise<{ ok: boolean; file: string | null; exists: boolean; error?: string }> {
  const r = await xrsim(["record", "stop"], { port, timeoutMs: 60000 });
  const file = findStringEnding(r.json, /\.mp4$/i) ?? expected ?? null;
  return { ok: r.ok, file, exists: !!file && fs.existsSync(file), ...(r.ok ? {} : { error: short(r) }) };
}
