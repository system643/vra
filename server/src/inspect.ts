import fs from "node:fs";
import path from "node:path";
import { sha256File, nowIso } from "./util/fsx.js";

/**
 * Live inspection with Frida — last resort, under REA's rules:
 * spawn paused, load the script, resume; before resuming a paused process the
 * instrumentation must be released (if cleanup fails the game stays paused and
 * the error is kept); VRA never kills the game; captures are bounded.
 * Frida is an optional dependency loaded only when this runs.
 */

export interface InspectReport {
  startedAt: string;
  exe: string;
  pid: number | null;
  script: string;
  scriptSha256: string;
  durationSeconds: number;
  messages: unknown[];
  truncated: boolean;
  resumed: boolean;
  cleanup: "ok" | "failed";
  errors: string[];
  limits: string[];
}

const MAX_MESSAGES = 2000;
const MAX_BYTES = 4 * 1024 * 1024;

export async function liveInspect(args: { exe: string; scriptPath: string; durationSeconds: number; spawnArgs?: string[] }): Promise<InspectReport> {
  let frida: any;
  try {
    const modName = "frida";
    frida = await import(modName);
  } catch {
    throw new Error("Frida n'est pas installé. Dans le dossier server du plugin : `npm install frida` (dépendance optionnelle, volumineuse).");
  }
  const source = fs.readFileSync(args.scriptPath, "utf8");
  const report: InspectReport = {
    startedAt: nowIso(),
    exe: args.exe,
    pid: null,
    script: path.resolve(args.scriptPath),
    scriptSha256: await sha256File(args.scriptPath),
    durationSeconds: args.durationSeconds,
    messages: [],
    truncated: false,
    resumed: false,
    cleanup: "ok",
    errors: [],
    limits: ["Observation limitée à la durée et aux scènes traversées pendant la capture.", "Le code du script n'est pas stocké dans le rapport, seulement son chemin et son empreinte."],
  };
  let bytes = 0;
  const device = await frida.getLocalDevice();
  const pid: number = await device.spawn([args.exe, ...(args.spawnArgs ?? [])], { cwd: path.dirname(args.exe) });
  report.pid = pid;
  let session: any = null;
  let script: any = null;
  try {
    session = await device.attach(pid);
    script = await session.createScript(source);
    script.message.connect((message: unknown) => {
      const size = JSON.stringify(message).length;
      if (report.messages.length >= MAX_MESSAGES || bytes + size > MAX_BYTES) {
        report.truncated = true;
        return;
      }
      bytes += size;
      report.messages.push(message);
    });
    await script.load();
  } catch (e) {
    report.errors.push(`chargement : ${(e as Error).message}`);
    try {
      if (script) await script.unload();
      if (session) await session.detach();
    } catch (e2) {
      report.cleanup = "failed";
      report.errors.push(`nettoyage : ${(e2 as Error).message} — le jeu reste en pause (pid ${pid}), il n'est pas tué.`);
      return report;
    }
    await device.resume(pid);
    report.resumed = true;
    return report;
  }
  await device.resume(pid);
  report.resumed = true;
  await new Promise((r) => setTimeout(r, Math.min(args.durationSeconds, 120) * 1000));
  try {
    await script.unload();
    await session.detach();
  } catch (e) {
    report.cleanup = "failed";
    report.errors.push(`nettoyage après capture : ${(e as Error).message}`);
  }
  return report;
}
