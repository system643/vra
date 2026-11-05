import { describe, it, expect, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vra-ap-home-"));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "vra-ap-work-"));
process.env.VRA_HOME = HOME;
process.env.VRA_NO_NOTIFY = "1";
process.env.VRA_METAVR_CMD = path.join(here, "fake-metavr.mjs");
process.env.FAKE_METAVR_LOG = path.join(WORK, "metavr.log");
process.env.FAKE_METAVR_STATE = WORK;

const { validateXrsimArgv, argvFor, xrsimAction, quitSimulator, diagnose, simulatorFps, recordStart, recordStop } = await import("../src/lab/xrsim.js");
const { grantAutonomy, checkAutonomy, requireConsent, revokeAutonomy } = await import("../src/autonomy.js");
const { registerProcess, closeOwned, listOwned } = await import("../src/lab/processes.js");
const { startAutopilot, nextAction, reportAction, readAp, writeFinalReport, strategiesFor } = await import("../src/lab/autopilot.js");
const { createBackup, restoreBackup } = await import("../src/backup.js");
const { notifyUser, notificationsLog } = await import("../src/notify.js");

const children: ChildProcess[] = [];
afterAll(() => {
  for (const c of children) c.kill();
});
const loggedArgv = () => (fs.existsSync(process.env.FAKE_METAVR_LOG!) ? fs.readFileSync(process.env.FAKE_METAVR_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]) : []);

describe("contrôle de Meta XR Simulator (metavr xrsim)", () => {
  beforeEach(() => {
    process.env.FAKE_METAVR_MODE = "ok";
    fs.rmSync(process.env.FAKE_METAVR_LOG!, { force: true });
  });

  it("refuse ce qui dépasse le simulateur de VRA", () => {
    expect(() => validateXrsimArgv(["device", "set", "--name", "Meta Quest 3"])).not.toThrow();
    expect(() => validateXrsimArgv(["app", "quit", "--all"])).toThrow(/--all/);
    expect(() => validateXrsimArgv(["runtime", "activate"])).toThrow(/registre/);
    expect(() => validateXrsimArgv(["tools", "install", "x"])).toThrow(/non autorisé/);
    expect(() => validateXrsimArgv(["app", "quit", "--force"])).toThrow(/--force/);
    expect(() => validateXrsimArgv(["app", "quit", "--force"], { allowForce: true })).not.toThrow();
    expect(() => validateXrsimArgv(["record", "start", "--output", "a;rm -rf"])).toThrow(/Argument refusé/);
  });

  it("actions nommées → commandes exactes de la CLI de Meta", () => {
    expect(argvFor("device_set", { name: "Meta Quest 3" })).toEqual([["device", "set", "--name", "Meta Quest 3", "--wait"]]);
    expect(argvFor("refresh_rate", { rate: 90 })).toEqual([["device", "refresh-rate", "--rate", "90", "--wait"]]);
    expect(argvFor("input_controllers", { active: true })).toEqual([
      ["input", "controller", "--hand", "left", "--active", "true", "--wait"],
      ["input", "controller", "--hand", "right", "--active", "true", "--wait"],
    ]);
    expect(argvFor("layer_toggle", { id: "3", state: "off" })).toEqual([["layer", "toggle", "3", "off"]]);
    expect(() => argvFor("env_set", {})).toThrow(/id requis/);
  });

  it("appelle metavr en JSON et lit la réponse", async () => {
    const r = await xrsimAction("device_set", { name: "Meta Quest 3" });
    expect(r.ok).toBe(true);
    expect(loggedArgv()[0]).toEqual(["--format", "json", "xrsim", "device", "set", "--name", "Meta Quest 3", "--wait"]);
    expect(await simulatorFps()).toBe(89.6);
  });

  it("arrêt : normal d'abord, forcé seulement après un échec", async () => {
    process.env.FAKE_METAVR_MODE = "quit_fail";
    const r = await quitSimulator();
    expect(r.ok).toBe(true);
    const calls = loggedArgv();
    expect(calls[0]).not.toContain("--force");
    expect(calls[1]).toContain("--force");
  });

  it("diagnostic par niveaux : nomme le maillon cassé", async () => {
    process.env.FAKE_METAVR_MODE = "sim_down";
    expect((await diagnose()).broken).toBe("simulator_absent");
    process.env.FAKE_METAVR_MODE = "no_app";
    const d = await diagnose();
    expect(d.broken).toBe("no_app_connected");
    expect(d.auto_fix.map((x) => x.tool)).toEqual(["lab_stop", "lab_launch"]);
    process.env.FAKE_METAVR_MODE = "app_dead";
    expect((await diagnose()).broken).toBe("app_dead");
    process.env.FAKE_METAVR_MODE = "ok";
    const ok = await diagnose();
    expect(ok.broken).toBeNull();
    expect(ok.tiers.map((t) => t.tier)).toEqual(["runtime logs", "runtime list", "runtime status"]);
  });

  it("vidéo MP4 rangée dans le profil du jeu", async () => {
    const gp = path.join(WORK, "VideoGame");
    fs.mkdirSync(gp, { recursive: true });
    const s = await recordStart(gp, "smoke");
    expect(s.ok).toBe(true);
    const e = await recordStop(undefined, s.file);
    expect(e.exists).toBe(true);
    expect(e.file).toMatch(/lab[\\/]videos[\\/].*smoke\.mp4$/);
  });
});

describe("mode autonome encadré", () => {
  const gp = path.join(WORK, "AutoGame");
  fs.mkdirSync(gp, { recursive: true });

  it("exige les mots de l'utilisateur, se limite au jeu, au périmètre et à la durée", () => {
    expect(() => grantAutonomy(gp, { quote: "ok" })).toThrow(/mots exacts/);
    const now = new Date("2026-11-05T10:00:00Z");
    grantAutonomy(gp, { quote: "Vas-y, débrouille-toi sans moi sur ce jeu", hours: 2, scope: ["install", "deploy"], now });
    expect(checkAutonomy(gp, "install", new Date("2026-11-05T11:00:00Z")).ok).toBe(true);
    expect(checkAutonomy(gp, "restore", new Date("2026-11-05T11:00:00Z")).ok).toBe(false);
    expect(checkAutonomy(gp, "install", new Date("2026-11-05T12:30:00Z")).reason).toMatch(/expirée/);
    expect(checkAutonomy(path.join(WORK, "AutreJeu"), "install").ok).toBe(false);
  });

  it("requireConsent : confirm=true, ou autorisation valide (utilisation notée), sinon refus", () => {
    grantAutonomy(gp, { quote: "Vas-y, débrouille-toi sans moi sur ce jeu" });
    expect(requireConsent(null, "install", true).via).toBe("confirm");
    const c = requireConsent(gp, "install", false);
    expect(c.via).toBe("autonomie");
    revokeAutonomy(gp);
    expect(requireConsent(gp, "install", false).ok).toBe(false);
  });
});

describe("processus : VRA ne ferme que ce qu'il a lancé", () => {
  it("refuse un processus inconnu ou un pid réutilisé, ferme le sien", async () => {
    const mine = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    const other = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    children.push(mine, other);
    const gp = path.join(WORK, "ProcGame");
    expect((await closeOwned(other.pid!)).result).toBe("refuse");
    registerProcess({ pid: other.pid!, exe: "PasLeMeme.exe", role: "jeu", gamePath: gp });
    expect((await closeOwned(other.pid!)).result).toBe("refuse");
    registerProcess({ pid: mine.pid!, exe: path.basename(process.execPath), role: "jeu", gamePath: gp });
    const r = await closeOwned(mine.pid!, { graceMs: 1500 });
    expect(["ferme_proprement", "ferme_de_force"]).toContain(r.result);
    expect(listOwned().some((p) => p.pid === mine.pid)).toBe(false);
    let otherAlive = true;
    try {
      process.kill(other.pid!, 0);
    } catch {
      otherAlive = false;
    }
    expect(otherAlive).toBe(true);
  }, 20000);
});

describe("pilote automatique : machine à états", () => {
  const S = (id: string, level: number, actions: string[], extra: Record<string, unknown> = {}) => ({
    id,
    level,
    title: id,
    why: "test",
    actions: actions.map((a) => ({ id: a, tools: [a.startsWith("test") ? "lab_run_scenario" : a.startsWith("launch") ? "lab_launch" : "deploy_files"], args: { game_path: "{{game_path}}" }, goal: a, test: a.startsWith("test") || a.startsWith("launch"), retries: a.startsWith("test") ? 1 : 0 })),
    ...extra,
  });

  async function drive(gp: string, decide: (strategy: string, action: string, kind: string) => { ok: boolean; crashed?: boolean; needs_human?: boolean }, onAction?: (a: { id: string; tools: string[]; args: Record<string, unknown>; strategy: string; kind: string }) => Promise<void> | void) {
    const seen: string[] = [];
    for (let k = 0; k < 300; k++) {
      const n = nextAction(gp);
      if (n.done || !n.action) return { seen, last: n };
      const a = n.action;
      await onAction?.(a);
      seen.push(`${a.strategy}:${a.id}`);
      const d = decide(a.strategy, a.id, a.kind);
      reportAction(gp, { action_id: a.id, ok: d.ok, crashed: d.crashed, needs_human: d.needs_human, summary: d.ok ? "ok" : d.crashed ? "plantage" : "échec", evidence: [`${a.strategy}/${a.id}`] });
    }
    throw new Error("boucle infinie");
  }

  it("plantage → nouvel essai avec relance ; échec d'échelle → changements annulés ; la 3e réussit ; meilleure config gardée", async () => {
    const gp = path.join(WORK, "ApGame");
    fs.mkdirSync(gp, { recursive: true });
    const strategies = [
      S("s1_plante", 2, ["deploy", "launch", "test_smoke"]),
      S("s2_echelle", 2, ["deploy", "launch", "test_smoke", "test_world_scale"]),
      S("s3_ok", 2, ["deploy", "launch", "test_smoke", "test_world_scale"], { settings: [{ op: "set_scale", args: { value: 1 } }] }),
      S("s4_mains", 3, ["deploy", "launch", "test_controllers"], { requires: ["best_level_2"] }),
    ];
    startAutopilot({ gamePath: gp, family: "test", target: 3, ceiling: 3, strategies });
    let n = 0;
    const res = await drive(
      gp,
      (strategy, action) => {
        if (strategy === "s1_plante" && action === "test_smoke") return { ok: false, crashed: true };
        if (strategy === "s2_echelle" && action === "test_world_scale") return { ok: false };
        if (strategy === "s4_mains" && action === "test_controllers") return { ok: false };
        return { ok: true };
      },
      async (a) => {
        // a "deploy" really writes into the game, with a backup, like deploy_files does
        if (a.id === "deploy") {
          n++;
          fs.writeFileSync(path.join(gp, `mod_${a.strategy}.txt`), "x");
          await createBackup(gp, gp, [`mod_${a.strategy}.txt`], `deploy-${a.strategy}`);
        }
        if (a.tools[0] === "restore_game") await restoreBackup(gp, String(a.args.backup), false);
      },
    );
    const s = readAp(gp)!;
    expect(s.strategies.map((x) => x.status)).toEqual(["failed", "failed", "succeeded", "failed"]);
    expect(s.best?.strategy).toBe("s3_ok");
    expect(s.best?.level).toBe(2);
    expect(s.outcome).toBe("impossible");
    expect(res.seen).toContain("s1_plante:crash_stop");
    expect(res.seen.filter((x) => x === "s1_plante:test_smoke")).toHaveLength(2);
    expect(res.seen.some((x) => x.startsWith("s2_echelle:restore_"))).toBe(true);
    expect(res.seen).toContain("_fin:apply_best");
    expect(n).toBe(4);
    expect(s.attemptsUsed).toBeGreaterThan(5);
  });

  it("budget épuisé : arrêt propre, rapport et notification", async () => {
    const gp = path.join(WORK, "BudgetGame");
    fs.mkdirSync(gp, { recursive: true });
    startAutopilot({ gamePath: gp, family: "test", target: 2, ceiling: 3, budget: { attempts: 3 }, strategies: [S("b1", 2, ["launch", "test_a", "test_b"]), S("b2", 2, ["launch", "test_a"])] });
    await drive(gp, (_s, action) => ({ ok: action === "launch" }));
    const s = readAp(gp)!;
    expect(s.outcome).toBe("budget_exhausted");
    expect(s.attemptsUsed).toBe(3);
    const rep = writeFinalReport(gp);
    expect(fs.readFileSync(rep.md, "utf8")).toMatch(/budget épuisé/);
    expect(fs.readFileSync(rep.html, "utf8")).toMatch(/<table>/);
    expect(s.attempts.length).toBeGreaterThan(0);
    const notif = notifyUser(rep.title, rep.body, { open: rep.html });
    expect(notif.shown).toBe(false);
    expect(fs.readFileSync(notificationsLog(), "utf8")).toContain("BudgetGame");
  });

  it("écran d'achat → besoin humain, jamais validé ; stratégie manuelle = besoin humain", async () => {
    const gp = path.join(WORK, "HumanGame");
    fs.mkdirSync(gp, { recursive: true });
    startAutopilot({ gamePath: gp, family: "test", target: 2, ceiling: 2, strategies: [S("h1", 2, ["launch", "test_a"]), { ...S("h2", 2, ["research"]), manual: "installeur tiers" }] });
    await drive(gp, (strategy, action) => (action === "launch" ? { ok: false, needs_human: true } : { ok: true }));
    const s = readAp(gp)!;
    expect(s.strategies.map((x) => x.status)).toEqual(["needs_human", "needs_human"]);
    expect(s.outcome).toBe("needs_human");
    expect(s.best).toBeNull();
  });

  it("bibliothèque par moteur : Unreal va de UEVR natif au Lua niveau 3 ; cible abaissée par contre-indication", () => {
    expect(strategiesFor("unreal").map((x) => x.id)).toEqual(["uevr_native", "uevr_synced", "uevr_nightly", "uevr_dx11", "uevr_nohmd", "uevr_openvr_null", "uevr_lua_controls"]);
    expect(strategiesFor("unity_il2cpp")[0].actions.some((a) => a.args.tool_id === "bepinex6-il2cpp")).toBe(true);
    expect(strategiesFor("godot")[0].manual).toBeTruthy();
    const gp = path.join(WORK, "Ue");
    fs.mkdirSync(gp, { recursive: true });
    const s = startAutopilot({ gamePath: gp, family: "unreal", target: 2, ceiling: 3 });
    expect(s.strategies.some((x) => x.id === "uevr_lua_controls")).toBe(false);
    expect(s.notes[0]).toMatch(/au-dessus de la cible/);
    const first = nextAction(gp);
    expect(first.action?.tools).toEqual(["lab_stop"]);
    expect(first.action?.args.game_path).toBe(path.resolve(gp));
  });
});
