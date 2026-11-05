import fs from "node:fs";
import path from "node:path";
import { ensureDir, profileDir, vraHome } from "../paths.js";
import { readJson, timestamp, writeJson } from "../util/fsx.js";
import { analyzeFrame, compareFrames } from "../frames.js";
import { captureScreen } from "../runtime.js";
import { readState as readBridgeState, sendCommands } from "./bridge.js";
import { eulerToQuat, fillTemplate, operator, readOperatorMap, saveImageContent } from "./operator.js";

/**
 * Scenario runner: dozens of actions in ONE tool call (head/controller poses,
 * buttons, hot commands, waits, captures, automatic analysis, assertions on
 * telemetry). Built-in scenarios cover the checklist points; lab_matrix runs a
 * scenario over many setting variants and ranks them.
 */

export interface LabSession {
  gamePath: string;
  family: string | null;
  bridgeDir: string;
  pid?: number;
  exe?: string;
  launch?: Record<string, unknown>;
  startedAt: string;
  windowTitle?: string;
}

export function sessionFile(): string {
  return path.join(ensureDir(path.join(vraHome(), "lab")), "current.json");
}

export function readLabSession(): LabSession | null {
  return readJson<LabSession | null>(sessionFile(), null);
}

export function writeLabSession(s: LabSession) {
  writeJson(sessionFile(), s);
}

export type Pose = { px?: number; py?: number; pz?: number; yaw?: number; pitch?: number; roll?: number };

export type Step =
  | { op: "head"; pose: Pose; label?: string }
  | { op: "controller"; hand: "left" | "right"; pose: Pose; label?: string }
  | { op: "button"; hand: "left" | "right"; button: string; value?: number | boolean; label?: string }
  | { op: "operator"; tool: string; args?: Record<string, unknown>; label?: string }
  | { op: "command"; command: string; args?: Record<string, unknown>; label?: string }
  | { op: "wait"; ms: number }
  | { op: "capture"; label: string }
  | { op: "analyze"; label: string; expect_ok?: boolean }
  | { op: "compare"; a: string; b: string; expect?: "left" | "right" | "up" | "down" | "change" | "same" }
  | { op: "state"; label: string }
  | { op: "assert_state"; label: string; path: string; cmp: ">" | "<" | "==" | "~"; value: number | string | boolean; tol?: number }
  | { op: "assert_delta"; a: string; b: string; path: string; min?: number; max?: number; expect_ratio?: { per: number; unitsPath?: string; tol: number } }
  | { op: "alive" };

export interface StepResult {
  i: number;
  op: string;
  label?: string;
  ok: boolean;
  ms: number;
  detail?: unknown;
  error?: string;
}

export interface ScenarioReport {
  name: string;
  ok: boolean;
  passed: number;
  failed: number;
  durationMs: number;
  steps: StepResult[];
  captures: Record<string, string>;
  states: Record<string, unknown>;
  checks: Array<{ check: string; ok: boolean; detail: string }>;
}

function get(obj: unknown, p: string): unknown {
  return p.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function processAlive(pid?: number): boolean | null {
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function poseVars(p: Pose, extra: Record<string, unknown> = {}) {
  return { px: p.px ?? 0, py: p.py ?? 1.6, pz: p.pz ?? 0, yaw: p.yaw ?? 0, pitch: p.pitch ?? 0, roll: p.roll ?? 0, ...eulerToQuat(p.yaw, p.pitch, p.roll), ...extra };
}

async function callMapped(kind: "head_pose" | "controller_pose" | "button" | "capture", vars: Record<string, unknown>) {
  const map = readOperatorMap();
  const entry = map[kind];
  if (!entry) throw new Error(`Action « ${kind} » non configurée : lancer lab_operator_tools puis lab_operator_map.`);
  const op = await operator();
  const res = await op.callTool(entry.tool, fillTemplate(entry.args, vars) as Record<string, unknown>);
  if (res.isError) throw new Error(`${entry.tool} : ${res.content.map((c) => c.text ?? "").join(" ")}`);
  return res;
}

export async function runScenario(name: string, steps: Step[], session: LabSession, opts: { stopOnFail?: boolean } = {}): Promise<ScenarioReport> {
  const t0 = Date.now();
  const report: ScenarioReport = { name, ok: true, passed: 0, failed: 0, durationMs: 0, steps: [], captures: {}, states: {}, checks: [] };
  const capDir = ensureDir(path.join(profileDir(session.gamePath), "lab", "captures", `${timestamp()}_${name.replace(/[^\w-]+/g, "_")}`));
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const s0 = Date.now();
    const r: StepResult = { i, op: st.op, label: "label" in st ? st.label : undefined, ok: true, ms: 0 };
    try {
      switch (st.op) {
        case "head":
          await callMapped("head_pose", await poseVars(st.pose));
          break;
        case "controller":
          await callMapped("controller_pose", await poseVars(st.pose, { hand: st.hand }));
          break;
        case "button":
          await callMapped("button", { hand: st.hand, button: st.button, value: st.value ?? true });
          break;
        case "operator": {
          const op = await operator();
          const res = await op.callTool(st.tool, st.args ?? {});
          if (res.isError) throw new Error(res.content.map((c) => c.text ?? "").join(" "));
          r.detail = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").slice(0, 500);
          break;
        }
        case "command": {
          const res = await sendCommands(session.bridgeDir, [{ op: st.command, args: st.args }], 5000);
          if (res.timedOut) throw new Error("le pont à chaud n'a pas répondu (5 s) : script/plugin VRA Lab chargé ?");
          const ack = res.results[0];
          if (!ack?.ok) throw new Error(ack?.error ?? "commande refusée");
          r.detail = ack.result;
          break;
        }
        case "wait":
          await new Promise((res) => setTimeout(res, Math.min(st.ms, 120000)));
          break;
        case "capture": {
          let file: string | null = null;
          const map = readOperatorMap();
          if (map.capture) {
            try {
              const res = await callMapped("capture", {});
              file = saveImageContent(res.content, path.join(capDir, st.label));
            } catch {
              file = null;
            }
          }
          if (!file) {
            const tmp = await captureScreen(session.gamePath, session.windowTitle);
            file = path.join(capDir, `${st.label}.png`);
            fs.renameSync(tmp, file);
          }
          report.captures[st.label] = file;
          r.detail = file;
          break;
        }
        case "analyze": {
          const f = report.captures[st.label];
          if (!f) throw new Error(`capture « ${st.label} » absente`);
          if (!f.endsWith(".png")) {
            r.detail = "image JPEG : analyse automatique impossible, la regarder avec Read";
            break;
          }
          const a = analyzeFrame(f);
          const problems = a.findings.filter((x) => x.result === "problème");
          for (const x of a.findings) report.checks.push({ check: `${st.label}:${x.check}`, ok: x.result !== "problème", detail: x.detail });
          r.detail = a.findings;
          if ((st.expect_ok ?? true) && problems.length) throw new Error(problems.map((p) => p.detail).join(" ; "));
          break;
        }
        case "compare": {
          const c = compareFrames(report.captures[st.a], report.captures[st.b], st.expect);
          report.checks.push({ check: `compare ${st.a}→${st.b}`, ok: c.expectationMet ?? c.changed, detail: c.interpretation });
          r.detail = c;
          if (st.expect && !c.expectationMet) throw new Error(c.interpretation);
          break;
        }
        case "state": {
          const s = readBridgeState(session.bridgeDir);
          if (!s) throw new Error("télémétrie absente (vra_state.json) : pont à chaud non chargé ?");
          report.states[st.label] = s;
          r.detail = { frame: s.frame, fps: s.fps };
          break;
        }
        case "assert_state": {
          const v = get(report.states[st.label], st.path);
          const tol = st.tol ?? 0;
          const ok =
            st.cmp === ">" ? Number(v) > Number(st.value) : st.cmp === "<" ? Number(v) < Number(st.value) : st.cmp === "~" ? Math.abs(Number(v) - Number(st.value)) <= tol : v === st.value;
          report.checks.push({ check: `${st.label}.${st.path} ${st.cmp} ${st.value}`, ok, detail: `valeur : ${JSON.stringify(v)}` });
          r.detail = v;
          if (!ok) throw new Error(`${st.path} = ${JSON.stringify(v)}, attendu ${st.cmp} ${st.value}`);
          break;
        }
        case "assert_delta": {
          const va = get(report.states[st.a], st.path) as Record<string, number> | number | undefined;
          const vb = get(report.states[st.b], st.path) as Record<string, number> | number | undefined;
          if (va === undefined || vb === undefined) throw new Error(`${st.path} absent de la télémétrie`);
          const d =
            typeof va === "number" && typeof vb === "number"
              ? Math.abs(vb - va)
              : Math.hypot(Number((vb as any).x) - Number((va as any).x), Number((vb as any).y) - Number((va as any).y), Number((vb as any).z) - Number((va as any).z));
          let ok = (st.min === undefined || d >= st.min) && (st.max === undefined || d <= st.max);
          let detail = `déplacement mesuré : ${Math.round(d * 1000) / 1000}`;
          if (st.expect_ratio) {
            const units = st.expect_ratio.unitsPath ? Number(get(report.states[st.b], st.expect_ratio.unitsPath)) || 1 : 1;
            const ratio = d / (st.expect_ratio.per * units);
            ok = ok && Math.abs(ratio - 1) <= st.expect_ratio.tol;
            detail += ` ; rapport à l'attendu : ${Math.round(ratio * 100) / 100} (1,00 = échelle correcte)`;
          }
          report.checks.push({ check: `delta ${st.path} ${st.a}→${st.b}`, ok, detail });
          r.detail = detail;
          if (!ok) throw new Error(detail);
          break;
        }
        case "alive": {
          const alive = processAlive(session.pid);
          report.checks.push({ check: "processus du jeu", ok: alive !== false, detail: alive === null ? "pid inconnu" : alive ? "en vie" : "PLANTÉ / fermé" });
          if (alive === false) throw new Error("le jeu ne tourne plus (plantage ?)");
          break;
        }
      }
    } catch (e) {
      r.ok = false;
      r.error = (e as Error).message;
    }
    r.ms = Date.now() - s0;
    report.steps.push(r);
    if (r.ok) report.passed++;
    else {
      report.failed++;
      report.ok = false;
      if (opts.stopOnFail) break;
    }
  }
  report.durationMs = Date.now() - t0;
  return report;
}

/* ───────────────────────── Built-in scenarios ───────────────────────── */

const H = 1.6; // standing eye height used as neutral pose (m)

export function builtinScenario(name: string, opts: { family?: string | null; minutes?: number } = {}): { steps: Step[]; closes: string[] } {
  switch (name) {
    case "smoke":
      return {
        steps: [{ op: "alive" }, { op: "head", pose: { py: H } }, { op: "wait", ms: 800 }, { op: "capture", label: "neutre" }, { op: "analyze", label: "neutre" }, { op: "state", label: "s0" }, { op: "assert_state", label: "s0", path: "frame", cmp: ">", value: 0 }],
        closes: ["stable_start", "stereo_ok"],
      };
    case "head_6dof":
      return {
        steps: [
          { op: "head", pose: { py: H } }, { op: "wait", ms: 600 }, { op: "capture", label: "face" }, { op: "state", label: "s_face" },
          { op: "head", pose: { py: H, yaw: -30 } }, { op: "wait", ms: 600 }, { op: "capture", label: "droite30" }, // OpenXR : yaw négatif = tourner à droite
          { op: "compare", a: "face", b: "droite30", expect: "right" },
          { op: "head", pose: { py: H, yaw: 30 } }, { op: "wait", ms: 600 }, { op: "capture", label: "gauche30" },
          { op: "compare", a: "face", b: "gauche30", expect: "left" },
          { op: "head", pose: { px: 0.3, py: H } }, { op: "wait", ms: 600 }, { op: "capture", label: "penche_droite" }, { op: "state", label: "s_penche" },
          { op: "compare", a: "face", b: "penche_droite", expect: "change" },
          { op: "head", pose: { py: H } }, { op: "alive" },
        ],
        closes: ["head_6dof"],
      };
    case "world_scale": {
      const unitsPath = opts.family === "unreal" ? "world_to_meters" : undefined;
      const p = opts.family === "unreal" ? "view" : "camera";
      return {
        steps: [
          { op: "head", pose: { py: H } }, { op: "wait", ms: 700 }, { op: "state", label: "bas" },
          { op: "head", pose: { py: H + 0.5 } }, { op: "wait", ms: 700 }, { op: "state", label: "haut" },
          { op: "assert_delta", a: "bas", b: "haut", path: p, expect_ratio: { per: 0.5, unitsPath, tol: 0.2 } },
          { op: "head", pose: { py: H } },
        ],
        closes: ["world_scale"],
      };
    }
    case "controllers":
      return {
        steps: [
          { op: "head", pose: { py: H } },
          { op: "controller", hand: "right", pose: { px: 0.2, py: H - 0.3, pz: -0.4 } }, { op: "wait", ms: 500 }, { op: "capture", label: "main_basse" },
          { op: "controller", hand: "right", pose: { px: 0.2, py: H, pz: -0.4, pitch: 20 } }, { op: "wait", ms: 500 }, { op: "capture", label: "main_haute" },
          { op: "compare", a: "main_basse", b: "main_haute", expect: "change" },
          { op: "state", label: "avant_gachette" },
          { op: "button", hand: "right", button: "trigger", value: 1 }, { op: "wait", ms: 300 }, { op: "state", label: "gachette" },
          { op: "button", hand: "right", button: "trigger", value: 0 }, { op: "capture", label: "apres_tir" },
          { op: "alive" },
        ],
        closes: ["hand_aim"],
      };
    case "hud":
      return {
        steps: [{ op: "head", pose: { py: H } }, { op: "wait", ms: 500 }, { op: "capture", label: "hud" }, { op: "analyze", label: "hud" }, { op: "head", pose: { py: H, pitch: -25 } }, { op: "wait", ms: 500 }, { op: "capture", label: "hud_bas" }],
        closes: [],
      };
    case "stability": {
      const minutes = Math.max(1, Math.min(opts.minutes ?? 3, 30));
      const steps: Step[] = [];
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      for (let k = 0; k < minutes * 12; k++) {
        steps.push({ op: "head", pose: { px: rnd() * 0.3, py: H + rnd() * 0.2, pz: rnd() * 0.3, yaw: rnd() * 90, pitch: rnd() * 30 } }, { op: "wait", ms: 5000 });
        if (k % 12 === 11) steps.push({ op: "alive" });
      }
      steps.push({ op: "capture", label: "fin" }, { op: "analyze", label: "fin" }, { op: "alive" });
      return { steps, closes: ["stable_start"] };
    }
    default:
      throw new Error(`Scénario inconnu : ${name}. Disponibles : smoke, head_6dof, world_scale, controllers, hud, stability`);
  }
}

/* ───────────────────────── Matrix ───────────────────────── */

export interface Variant {
  name: string;
  commands: Array<{ command: string; args?: Record<string, unknown> }>;
}

export function expandAxes(axes: Record<string, Array<{ label: string; commands: Variant["commands"] }>>): Variant[] {
  let out: Variant[] = [{ name: "", commands: [] }];
  for (const [axis, values] of Object.entries(axes)) {
    const next: Variant[] = [];
    for (const v of out) for (const val of values) next.push({ name: v.name ? `${v.name} | ${axis}=${val.label}` : `${axis}=${val.label}`, commands: [...v.commands, ...val.commands] });
    out = next;
  }
  return out;
}

export interface MatrixRow {
  variant: string;
  score: number;
  fps: number | null;
  crashed: boolean;
  failures: string[];
  ms: number;
  report?: string;
}

export async function runMatrix(
  session: LabSession,
  variants: Variant[],
  scenario: Step[],
  opts: { settleMs?: number; relaunch?: () => Promise<LabSession | null>; maxVariants?: number },
): Promise<{ rows: MatrixRow[]; best: MatrixRow | null; reportFile: string }> {
  const rows: MatrixRow[] = [];
  let lastGood: Variant | null = null;
  let current = session;
  for (const v of variants.slice(0, opts.maxVariants ?? 64)) {
    const t0 = Date.now();
    const row: MatrixRow = { variant: v.name, score: 0, fps: null, crashed: false, failures: [], ms: 0 };
    try {
      for (const c of v.commands) {
        const r = await sendCommands(current.bridgeDir, [{ op: c.command, args: c.args }], 5000);
        if (r.timedOut || !r.results[0]?.ok) throw new Error(`réglage ${c.command} refusé ou sans réponse : ${r.results[0]?.error ?? "délai dépassé"}`);
      }
      await new Promise((res) => setTimeout(res, opts.settleMs ?? 1500));
      const rep = await runScenario(`matrice_${v.name}`, scenario, current);
      const total = rep.checks.length || rep.steps.length;
      const good = rep.checks.length ? rep.checks.filter((c) => c.ok).length : rep.passed;
      row.score = Math.round((good / Math.max(1, total)) * 100) / 100;
      row.failures = [...rep.steps.filter((s) => !s.ok).map((s) => `${s.op}${s.label ? `(${s.label})` : ""} : ${s.error}`)].slice(0, 5);
      const fpsValues = Object.values(rep.states).map((s) => Number((s as any)?.fps)).filter((n) => Number.isFinite(n) && n > 0);
      row.fps = fpsValues.length ? Math.round(fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length) : null;
      if (row.score >= 0.8) lastGood = v;
    } catch (e) {
      row.failures.push((e as Error).message);
    }
    if (processAlive(current.pid) === false) {
      row.crashed = true;
      row.score = 0;
      row.failures.unshift("PLANTAGE du jeu avec ce réglage");
      if (opts.relaunch) {
        const again = await opts.relaunch();
        if (!again) {
          row.ms = Date.now() - t0;
          rows.push(row);
          break;
        }
        current = again;
        if (lastGood) for (const c of lastGood.commands) await sendCommands(current.bridgeDir, [{ op: c.command, args: c.args }], 5000).catch(() => undefined);
      } else {
        row.ms = Date.now() - t0;
        rows.push(row);
        break;
      }
    }
    row.ms = Date.now() - t0;
    rows.push(row);
  }
  const ranked = [...rows].sort((a, b) => b.score - a.score || (b.fps ?? 0) - (a.fps ?? 0));
  const reportFile = path.join(ensureDir(path.join(profileDir(session.gamePath), "lab")), `matrice_${timestamp()}.json`);
  writeJson(reportFile, { rows: ranked });
  return { rows: ranked, best: ranked[0] && !ranked[0].crashed ? ranked[0] : null, reportFile };
}
