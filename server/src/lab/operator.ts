import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ensureDir, vraHome } from "../paths.js";
import { readJson, writeJson } from "../util/fsx.js";
import { OPERATOR_PORT } from "./sim.js";

/**
 * VRA as an MCP CLIENT of Meta XR Operator (an OpenXR API layer that serves MCP
 * over SSE from inside the running game). Tool names are read at run time —
 * nothing is hard-coded — and mapped to VRA's abstract actions (head pose,
 * controller pose, button, capture) by an editable "operator map".
 */

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Abstract action → operator tool + argument template with {{placeholders}}. */
export interface OperatorMap {
  head_pose?: { tool: string; args: unknown };
  controller_pose?: { tool: string; args: unknown };
  button?: { tool: string; args: unknown };
  capture?: { tool: string; args: unknown };
  notes?: string;
  verified?: boolean;
}

/** Minimal interface so tests can inject a fake operator. */
export interface OperatorClient {
  listTools(): Promise<ToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }>;
  close(): Promise<void>;
}

let shared: OperatorClient | null = null;
let override: OperatorClient | null = null;

/** For tests: replace the real SSE client. */
export function setOperatorClientForTests(c: OperatorClient | null) {
  override = c;
}

export async function operator(url = `http://localhost:${OPERATOR_PORT}/sse`): Promise<OperatorClient> {
  if (override) return override;
  if (shared) return shared;
  const client = new Client({ name: "vra-lab", version: "0.1.0" });
  try {
    await client.connect(new SSEClientTransport(new URL(url)));
  } catch (e) {
    throw new Error(`Meta XR Operator injoignable sur ${url} (${(e as Error).message}). Le jeu doit avoir été lancé par lab_launch avec la couche Operator, et l'application OpenXR doit être démarrée.`);
  }
  shared = {
    listTools: async () => (await client.listTools()).tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    callTool: async (name, args) => (await client.callTool({ name, arguments: args })) as never,
    close: async () => {
      await client.close();
      shared = null;
    },
  };
  return shared;
}

export async function resetOperator() {
  if (shared) await shared.close().catch(() => undefined);
  shared = null;
}

function mapFile(): string {
  return path.join(ensureDir(path.join(vraHome(), "lab")), "operator-map.json");
}

export function readOperatorMap(): OperatorMap {
  return readJson<OperatorMap>(mapFile(), {});
}

export function writeOperatorMap(m: OperatorMap): OperatorMap {
  writeJson(mapFile(), m);
  return m;
}

/** Heuristic first guess of the map from tool names (to be checked by Claude against the real schemas). */
export function guessOperatorMap(tools: ToolInfo[]): OperatorMap {
  const find = (re: RegExp) => tools.find((t) => re.test(t.name))?.name;
  const m: OperatorMap = { verified: false, notes: "Proposition automatique : vérifier les arguments avec lab_operator_tools (schémas) puis enregistrer avec lab_operator_map." };
  const head = find(/head.*pose|hmd.*pose|set_?head|set_?hmd/i);
  const ctrl = find(/controller.*pose|set_?controller|hand.*pose/i);
  const btn = find(/button|press|trigger|controller_?input|send_?input/i);
  const cap = find(/screenshot|capture|image|frame/i);
  if (head) m.head_pose = { tool: head, args: { position: { x: "{{px}}", y: "{{py}}", z: "{{pz}}" }, orientation: { x: "{{qx}}", y: "{{qy}}", z: "{{qz}}", w: "{{qw}}" } } };
  if (ctrl) m.controller_pose = { tool: ctrl, args: { hand: "{{hand}}", position: { x: "{{px}}", y: "{{py}}", z: "{{pz}}" }, orientation: { x: "{{qx}}", y: "{{qy}}", z: "{{qz}}", w: "{{qw}}" } } };
  if (btn) m.button = { tool: btn, args: { hand: "{{hand}}", button: "{{button}}", value: "{{value}}" } };
  if (cap) m.capture = { tool: cap, args: {} };
  return m;
}

/** Replace "{{name}}" strings (whole value → typed value, inside a string → text). */
export function fillTemplate(tpl: unknown, vars: Record<string, unknown>): unknown {
  if (typeof tpl === "string") {
    const whole = /^\{\{(\w+)\}\}$/.exec(tpl);
    if (whole) return whole[1] in vars ? vars[whole[1]] : tpl;
    return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
  }
  if (Array.isArray(tpl)) return tpl.map((x) => fillTemplate(x, vars));
  if (tpl && typeof tpl === "object") return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, fillTemplate(v, vars)]));
  return tpl;
}

/** Yaw/pitch/roll in degrees → quaternion (OpenXR convention: Y up, -Z forward; yaw around Y). */
export function eulerToQuat(yawDeg = 0, pitchDeg = 0, rollDeg = 0): { qx: number; qy: number; qz: number; qw: number } {
  const r = Math.PI / 180;
  const cy = Math.cos((yawDeg * r) / 2), sy = Math.sin((yawDeg * r) / 2);
  const cp = Math.cos((pitchDeg * r) / 2), sp = Math.sin((pitchDeg * r) / 2);
  const cr = Math.cos((rollDeg * r) / 2), sr = Math.sin((rollDeg * r) / 2);
  // Y (yaw) * X (pitch) * Z (roll)
  const qw = cy * cp * cr + sy * sp * sr;
  const qx = cy * sp * cr + sy * cp * sr;
  const qy = sy * cp * cr - cy * sp * sr;
  const qz = cy * cp * sr - sy * sp * cr;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { qx: round(qx), qy: round(qy), qz: round(qz), qw: round(qw) };
}

/** Save an image returned by an operator tool; returns the file path (PNG or JPEG). */
export function saveImageContent(content: Array<{ type: string; data?: string; mimeType?: string }>, outBase: string): string | null {
  const img = content.find((c) => c.type === "image" && c.data);
  if (!img?.data) return null;
  const ext = /jpe?g/i.test(img.mimeType ?? "") ? ".jpg" : ".png";
  const file = outBase + ext;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(img.data, "base64"));
  return file;
}
