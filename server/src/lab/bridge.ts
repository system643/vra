import fs from "node:fs";
import path from "node:path";
import { appData, profileDir } from "../paths.js";
import type { EngineFamily } from "../types.js";
import { abs, pickMainExe, scanGame } from "../detect/scan.js";

/**
 * Hot command channel between VRA and the running mod: VRA writes commands to
 * vra_cmd.json, the mod applies them within a few frames, acknowledges in
 * vra_ack.json and publishes telemetry in vra_state.json. Settings change in
 * seconds, without restarting the game.
 */

export interface LabCommand {
  id: number;
  op: string;
  args?: Record<string, unknown>;
}

export interface LabAck {
  last_id: number;
  results: Array<{ id: number; ok: boolean; result?: unknown; error?: string }>;
}

export const FILES = { cmd: "vra_cmd.json", ack: "vra_ack.json", state: "vra_state.json" };

/** Where the bridge of each engine reads and writes (must match the generated mod code). */
export function bridgeDir(gamePath: string, family: EngineFamily | null): string {
  const scan = scanGame(gamePath);
  const exe = pickMainExe(scan).exe;
  const exeStem = exe ? path.basename(exe, ".exe") : "jeu";
  const exeDir = exe ? path.dirname(abs(scan, exe)) : scan.root;
  switch (family) {
    case "unreal":
      return path.join(appData(), "UnrealVRMod", exeStem, "data");
    case "re_engine":
      return path.join(exeDir, "reframework", "data");
    default:
      // Unity and Godot read VRA_LAB_DIR (set by lab_launch); this is its value.
      return path.join(profileDir(gamePath), "lab");
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as T;
  } catch {
    return null;
  }
}

function writeAtomic(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
  fs.renameSync(tmp, file);
}

export function readState(dir: string): Record<string, unknown> | null {
  return readJson<Record<string, unknown>>(path.join(dir, FILES.state));
}

export function readAck(dir: string): LabAck | null {
  return readJson<LabAck>(path.join(dir, FILES.ack));
}

/** Append commands (ids continue after the last one written), keeping the file short. */
export function writeCommands(dir: string, cmds: Array<Omit<LabCommand, "id">>): LabCommand[] {
  const file = path.join(dir, FILES.cmd);
  const cur = readJson<{ commands: LabCommand[] }>(file) ?? { commands: [] };
  const ack = readAck(dir);
  let next = Math.max(0, ...cur.commands.map((c) => c.id), ack?.last_id ?? 0) + 1;
  const added = cmds.map((c) => ({ id: next++, op: c.op, ...(c.args ? { args: c.args } : {}) }));
  const keep = cur.commands.filter((c) => c.id > (ack?.last_id ?? 0)).concat(added).slice(-50);
  writeAtomic(file, { commands: keep });
  return added;
}

export async function sendCommands(dir: string, cmds: Array<Omit<LabCommand, "id">>, timeoutMs = 5000): Promise<{ sent: LabCommand[]; results: LabAck["results"]; timedOut: boolean; ms: number }> {
  const t0 = Date.now();
  const sent = writeCommands(dir, cmds);
  const want = sent.at(-1)?.id ?? 0;
  while (Date.now() - t0 < timeoutMs) {
    const ack = readAck(dir);
    if (ack && ack.last_id >= want) {
      const ids = new Set(sent.map((s) => s.id));
      return { sent, results: (ack.results ?? []).filter((r) => ids.has(r.id)), timedOut: false, ms: Date.now() - t0 };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return { sent, results: [], timedOut: true, ms: Date.now() - t0 };
}

/** Operations understood by each generated bridge (shown to Claude by lab_command). */
export const BRIDGE_OPS: Record<string, Array<{ op: string; args?: string; effect: string }>> = {
  unreal: [
    { op: "ping", effect: "vérifie que le pont répond" },
    { op: "get_mod_value", args: "{ key }", effect: "lit un réglage UEVR (noms exacts : voir config.txt du profil)" },
    { op: "set_mod_value", args: "{ key, value }", effect: "change un réglage UEVR à chaud (vr.set_mod_value)" },
    { op: "exec", args: "{ command }", effect: "commande console Unreal (cvars, ex. r.ScreenPercentage 70)" },
    { op: "snap_turn", args: "{ enabled }", effect: "rotation par crans" },
    { op: "decoupled_pitch", args: "{ enabled }", effect: "tangage découplé (3e personne, confort)" },
    { op: "aim_method", args: "{ value }", effect: "méthode de visée UEVR (vr.set_aim_method)" },
    { op: "recenter", effect: "recentre la vue" },
    { op: "save_config", effect: "enregistre les réglages UEVR actuels dans le profil" },
  ],
  unity: [
    { op: "ping", effect: "vérifie que le pont répond" },
    { op: "hud_world", args: "{ value: true|false }", effect: "HUD projeté en World Space ou non" },
    { op: "hud_distance", args: "{ value: mètres }", effect: "distance du HUD" },
    { op: "camera_parent_scale", args: "{ value }", effect: "échelle du parent de la caméra (échelle du monde)" },
    { op: "time_scale", args: "{ value }", effect: "Time.timeScale (0 = pause pour les captures)" },
  ],
  re_engine: [
    { op: "ping", effect: "vérifie que le pont répond" },
    { op: "get_state", effect: "force la mise à jour de la télémétrie" },
  ],
  godot: [
    { op: "ping", effect: "vérifie que le pont répond" },
    { op: "world_scale", args: "{ value }", effect: "XRServer.world_scale" },
    { op: "recenter", effect: "XRServer.center_on_hmd" },
  ],
};

export function bridgeFamilyKey(f: EngineFamily | null): string | null {
  if (f === "unreal") return "unreal";
  if (f === "unity_mono" || f === "unity_il2cpp") return "unity";
  if (f === "re_engine") return "re_engine";
  if (f === "godot") return "godot";
  return null;
}
