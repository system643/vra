import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { ensureDir, vraHome } from "../paths.js";
import { readJson, writeJson } from "../util/fsx.js";

/**
 * Registry of the processes VRA launched itself (game, injector). VRA may close
 * ONLY these, never a process it did not start: the pid AND the executable name
 * must still match (a recycled pid is never closed).
 */

export interface OwnedProcess {
  pid: number;
  exe: string;
  role: "jeu" | "injecteur" | "simulateur" | "autre";
  gamePath: string;
  startedAt: string;
}

export function registryFile(): string {
  return path.join(ensureDir(path.join(vraHome(), "lab")), "processes.json");
}

export function listOwned(): OwnedProcess[] {
  return readJson<OwnedProcess[]>(registryFile(), []);
}

export function registerProcess(p: Omit<OwnedProcess, "startedAt"> & { startedAt?: string }) {
  if (!p.pid) return;
  const all = listOwned().filter((x) => x.pid !== p.pid);
  all.push({ ...p, startedAt: p.startedAt ?? new Date().toISOString() });
  writeJson(registryFile(), all.slice(-50));
}

function forget(pid: number) {
  writeJson(registryFile(), listOwned().filter((x) => x.pid !== pid));
}

/** Image name of a running pid (Windows: tasklist), or null if not running. */
export function imageOfPid(pid: number): string | null {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
      const m = /^"([^"]+)","(\d+)"/m.exec(out);
      return m && Number(m[2]) === pid ? m[1] : null;
    } catch {
      return null;
    }
  }
  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }
  try {
    return path.basename(execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).trim());
  } catch {
    return null;
  }
}

function sameImage(a: string, b: string) {
  const n = (s: string) => path.basename(s).toLowerCase().replace(/\.exe$/, "");
  return n(a) === n(b);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function taskkill(args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile("taskkill", args, { windowsHide: true, timeout: 15000 }, (err) => resolve(!err)));
}

export interface CloseResult {
  pid: number;
  exe: string;
  role: string;
  result: "deja_ferme" | "ferme_proprement" | "ferme_de_force" | "refuse" | "echec";
  detail?: string;
}

/** Close a process VRA launched: graceful first (WM_CLOSE / SIGTERM), forced after graceMs. */
export async function closeOwned(pid: number, opts: { graceMs?: number } = {}): Promise<CloseResult> {
  const rec = listOwned().find((x) => x.pid === pid);
  if (!rec) return { pid, exe: "?", role: "?", result: "refuse", detail: "Ce processus n'a pas été lancé par VRA : jamais fermé." };
  const img = imageOfPid(pid);
  if (!img) {
    forget(pid);
    return { pid, exe: rec.exe, role: rec.role, result: "deja_ferme" };
  }
  if (!sameImage(img, rec.exe)) {
    forget(pid);
    return { pid, exe: rec.exe, role: rec.role, result: "refuse", detail: `Le pid ${pid} appartient maintenant à ${img} (pid réutilisé) : pas touché.` };
  }
  const grace = opts.graceMs ?? 8000;
  if (process.platform === "win32") await taskkill(["/PID", String(pid), "/T"]);
  else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < grace) {
    if (!imageOfPid(pid)) {
      forget(pid);
      return { pid, exe: rec.exe, role: rec.role, result: "ferme_proprement" };
    }
    await sleep(400);
  }
  let ok: boolean;
  if (process.platform === "win32") ok = await taskkill(["/PID", String(pid), "/T", "/F"]);
  else {
    try {
      process.kill(pid, "SIGKILL");
      ok = true;
    } catch {
      ok = false;
    }
  }
  await sleep(500);
  const gone = !imageOfPid(pid);
  if (gone) forget(pid);
  return { pid, exe: rec.exe, role: rec.role, result: gone ? "ferme_de_force" : "echec", detail: ok ? undefined : "taskkill a échoué" };
}

/** Close every VRA-launched process of a game (game first, then injector). */
export async function closeOwnedForGame(gamePath: string, opts: { graceMs?: number; roles?: OwnedProcess["role"][] } = {}): Promise<CloseResult[]> {
  const key = path.resolve(gamePath).toLowerCase();
  const order: Record<string, number> = { jeu: 0, injecteur: 1, autre: 2, simulateur: 3 };
  const mine = listOwned()
    .filter((p) => path.resolve(p.gamePath).toLowerCase() === key && (!opts.roles || opts.roles.includes(p.role)))
    .sort((a, b) => order[a.role] - order[b.role]);
  const out: CloseResult[] = [];
  for (const p of mine) out.push(await closeOwned(p.pid, opts));
  return out;
}
