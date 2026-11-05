import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vra-lab-home-"));
process.env.VRA_HOME = HOME;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "vra-lab-work-"));

const { encodePngGray } = await import("../src/util/png.js");
const { analyzeFrame, compareFrames } = await import("../src/frames.js");
const { mergeSteamVrSettings, enableNullDriverDefaults, buildLabEnv, isRuntimeManifest, isOperatorManifest, findOperator, findSimulatorRuntime } = await import("../src/lab/sim.js");
const { sendCommands, writeCommands, readAck } = await import("../src/lab/bridge.js");
const { setOperatorClientForTests, writeOperatorMap, guessOperatorMap, fillTemplate, eulerToQuat } = await import("../src/lab/operator.js");
const { runScenario, builtinScenario, runMatrix, expandAxes } = await import("../src/lab/scenario.js");
const { classifyGpu, decideProfile } = await import("../src/lab/machine.js");
const { initChecklist, setPoint, checklistStatus } = await import("../src/checklist.js");
const { scaffoldUevr, scaffoldUnity, scaffoldReframework } = await import("../src/scaffold/index.js");

/* ───────── synthetic renderer: smooth noise "world", stereo by a small shift ───────── */
function noise(x: number, y: number): number {
  const h = (ix: number, iy: number) => {
    let n = ix * 374761393 + iy * 668265263;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const x0 = Math.floor(x / 8), y0 = Math.floor(y / 8), fx = x / 8 - x0, fy = y / 8 - y0;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * s(fx);
  const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * s(fx);
  return 30 + 200 * (a + (b - a) * s(fy));
}

function frame(opts: { yaw?: number; py?: number; px?: number; handY?: number; stereo?: number; blackLeft?: boolean; mono?: boolean; vshift?: number } = {}): Buffer {
  const W = 320, Hh = 120, half = W / 2;
  const k = -(opts.yaw ?? 0) * 1 + (opts.px ?? 0) * 40; // turning right (yaw < 0) makes the scene slide left; leaning shifts by parallax
  const ky = ((opts.py ?? 1.6) - 1.6) * 40;
  return encodePngGray(W, Hh, (x, y) => {
    const right = x >= half;
    const ex = right ? x - half : x;
    if (!right && opts.blackLeft) return 0;
    const disp = right && !opts.mono ? (opts.stereo ?? 4) : 0;
    const vy = right ? opts.vshift ?? 0 : 0;
    if (opts.handY !== undefined) {
      const hy = Math.round(100 - (opts.handY - 1) * 80);
      if (ex > 100 && ex < 130 && y > hy - 10 && y < hy + 10) return 250; // the weapon held in the right hand
    }
    return noise(ex + k + disp + 200, y + ky + vy + 200);
  });
}

const file = (name: string, buf: Buffer) => {
  const p = path.join(WORK, name);
  fs.writeFileSync(p, buf);
  return p;
};

describe("analyse d'images VR", () => {
  it("stéréo normale : aucun problème, décalage détecté", () => {
    const a = analyzeFrame(file("ok.png", frame()));
    expect(a.layout).toBe("side_by_side");
    expect(a.findings.some((f) => f.result === "problème")).toBe(false);
    expect(a.findings.find((f) => f.check === "stéréo")!.result).toBe("ok");
  });
  it("œil noir, rendu mono et désalignement vertical repérés", () => {
    expect(analyzeFrame(file("black.png", frame({ blackLeft: true }))).findings.some((f) => f.check === "œil gauche" && f.result === "problème")).toBe(true);
    expect(analyzeFrame(file("mono.png", frame({ mono: true }))).findings.find((f) => f.check === "stéréo")!.result).toBe("problème");
    expect(analyzeFrame(file("vshift.png", frame({ vshift: 6 }))).findings.some((f) => f.check === "alignement vertical")).toBe(true);
  });
  it("tête tournée à droite : la vue glisse à gauche ; image figée détectée", () => {
    const a = file("face.png", frame());
    const r = compareFrames(a, file("right.png", frame({ yaw: -20 })), "right");
    expect(r.expectationMet).toBe(true);
    expect(compareFrames(a, file("left.png", frame({ yaw: 20 })), "right").expectationMet).toBe(false);
    expect(compareFrames(a, file("same.png", frame()), "same").expectationMet).toBe(true);
  });
});

describe("casque simulé et SteamVR", () => {
  it("variables d'environnement par processus (registre intact)", () => {
    const env = buildLabEnv({ runtimeJson: "C:/sim/runtime.json", operatorLayerDir: "C:/op/windows", labDir: "C:/lab", base: { PATH: "x", XR_ENABLE_API_LAYERS: "XR_APILAYER_other" } });
    expect(env.XR_RUNTIME_JSON).toBe("C:/sim/runtime.json");
    expect(env.XR_API_LAYER_PATH).toBe("C:/op/windows");
    expect(env.XR_ENABLE_API_LAYERS).toBe(`XR_APILAYER_other${path.delimiter}XR_APILAYER_METAX_operator`);
    expect(env.VRA_LAB_DIR).toBe("C:/lab");
  });
  it("manifestes runtime et Operator reconnus, recherche par dossier", async () => {
    const dir = path.join(WORK, "op", "windows");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "operator.json"), JSON.stringify({ file_format_version: "1.0.0", api_layer: { name: "XR_APILAYER_METAX_operator", library_path: "op.dll" } }));
    fs.writeFileSync(path.join(dir, "meta-xr-operator-mcp-proxy.exe"), "");
    const sim = path.join(WORK, "xrsim_runtime.json");
    fs.writeFileSync(sim, JSON.stringify({ runtime: { library_path: "sim.dll" } }));
    expect(isRuntimeManifest(sim)).toBe(true);
    expect(isOperatorManifest(path.join(dir, "operator.json"))).toBe(true);
    const op = await findOperator(path.join(WORK, "op"));
    expect(op.layerDir).toBe(dir);
    expect(op.proxy).toMatch(/meta-xr-operator-mcp-proxy\.exe$/);
    expect((await findSimulatorRuntime(sim)).json).toBe(path.resolve(sim));
  });
  it("pilote null SteamVR : fusion des réglages sans perdre l'existant", () => {
    const merged = JSON.parse(mergeSteamVrSettings(JSON.stringify({ steamvr: { supersampleScale: 1.2 }, audio: { x: 1 } }), true));
    expect(merged.steamvr).toEqual({ supersampleScale: 1.2, requireHmd: false, forcedDriver: "null", activateMultipleDrivers: true });
    expect(merged.audio.x).toBe(1);
    expect(JSON.parse(enableNullDriverDefaults(JSON.stringify({ driver_null: { enable: false, serialNumber: "Null 4711" } }))).driver_null).toEqual({ enable: true, serialNumber: "Null 4711" });
  });
  it("profil machine : Intel Arc intégré = léger, RTX A4500 20 Go = complet", () => {
    const arc = { name: "Intel(R) Arc(TM) Graphics", vramGb: 0.1, driver: "x", ...classifyGpu("Intel(R) Arc(TM) Graphics", 0.1) };
    expect(arc.dedicated).toBe(false);
    expect(decideProfile([arc], 31.4).profile).toBe("léger");
    const a4500 = { name: "NVIDIA RTX A4500", vramGb: 20, driver: "x", ...classifyGpu("NVIDIA RTX A4500", 20) };
    expect(a4500.dedicated && a4500.hardwareEncoder === "NVENC").toBe(true);
    expect(decideProfile([arc, a4500], 64).profile).toBe("complet");
  });
});

/* ───────── fake game: a child process + a bridge responder + a fake Meta XR Operator ───────── */
const children: ChildProcess[] = [];
function fakeGameProcess(): ChildProcess {
  const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  children.push(c);
  return c;
}
afterAll(() => {
  for (const c of children) c.kill();
  stopResponder = true;
});

const world = { headY: 1.6, headX: 0, handY: 1.3, yaw: 0, scale: 1, crashOn: "" as string, game: null as ChildProcess | null };
let stopResponder = false;
function startResponder(dir: string) {
  let last = 0;
  const results: unknown[] = [];
  let frame = 0;
  const tick = () => {
    if (stopResponder) return;
    frame++;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, "vra_cmd.json"), "utf8"));
      let changed = false;
      for (const c of doc.commands) {
        if (c.id <= last) continue;
        let ok = true;
        let result: unknown = null;
        if (c.op === "ping") result = "pong";
        else if (c.op === "camera_parent_scale") world.scale = Number(c.args.value);
        else if (c.op === "crash") world.game?.kill();
        else ok = false;
        results.push({ id: c.id, ok, result, ...(ok ? {} : { error: "op inconnue" }) });
        last = c.id;
        changed = true;
      }
      if (changed) fs.writeFileSync(path.join(dir, "vra_ack.json"), JSON.stringify({ last_id: last, results }));
    } catch {
      /* no command file yet */
    }
    fs.writeFileSync(path.join(dir, "vra_state.json"), JSON.stringify({ engine: "unity", frame, fps: 72, camera: { x: 0, y: world.headY * world.scale, z: 0 } }));
    setTimeout(tick, 25);
  };
  tick();
}

const fakeOperator = {
  async listTools() {
    return [{ name: "set_head_pose" }, { name: "set_controller_pose" }, { name: "press_button" }, { name: "capture_screenshot" }];
  },
  async callTool(name: string, args: Record<string, any>) {
    if (name === "set_head_pose") {
      world.headY = Number(args.position.y);
      world.headX = Number(args.position.x);
      world.yaw = Number(args.yaw);
      return { content: [{ type: "text", text: "ok" }] };
    }
    if (name === "set_controller_pose") {
      world.handY = Number(args.position?.y ?? world.handY);
      return { content: [{ type: "text", text: "ok" }] };
    }
    if (name === "press_button") return { content: [{ type: "text", text: "ok" }] };
    if (name === "capture_screenshot") return { content: [{ type: "image", mimeType: "image/png", data: frame({ yaw: world.yaw, py: world.headY, px: world.headX, handY: world.handY }).toString("base64") }] };
    return { content: [{ type: "text", text: "inconnu" }], isError: true };
  },
  async close() {},
};

describe("exécuteur de scénarios et matrice (faux jeu, faux Operator, faux pont)", () => {
  const gamePath = path.join(WORK, "FakeGame");
  fs.mkdirSync(gamePath, { recursive: true });
  const bridge = path.join(WORK, "bridge");
  fs.mkdirSync(bridge, { recursive: true });
  world.game = fakeGameProcess();
  startResponder(bridge);
  setOperatorClientForTests(fakeOperator);
  const session = () => ({ gamePath, family: "unity_mono", bridgeDir: bridge, pid: world.game!.pid, startedAt: new Date().toISOString() });

  it("correspondance Operator : proposition, gabarits, quaternions", async () => {
    const m = guessOperatorMap(await fakeOperator.listTools());
    expect(m.head_pose?.tool).toBe("set_head_pose");
    expect(m.capture?.tool).toBe("capture_screenshot");
    expect(fillTemplate({ p: { y: "{{py}}" }, s: "main {{hand}}" }, { py: 1.7, hand: "right" })).toEqual({ p: { y: 1.7 }, s: "main right" });
    const q = eulerToQuat(90, 0, 0);
    expect(q.qy).toBeCloseTo(Math.SQRT1_2, 5);
    expect(q.qw).toBeCloseTo(Math.SQRT1_2, 5);
    writeOperatorMap({
      head_pose: { tool: "set_head_pose", args: { position: { x: "{{px}}", y: "{{py}}", z: "{{pz}}" }, yaw: "{{yaw}}" } },
      controller_pose: { tool: "set_controller_pose", args: { hand: "{{hand}}", position: { x: "{{px}}", y: "{{py}}", z: "{{pz}}" } } },
      button: { tool: "press_button", args: { hand: "{{hand}}", button: "{{button}}", value: "{{value}}" } },
      capture: { tool: "capture_screenshot", args: {} },
      verified: true,
    });
  });

  it("pont à chaud : commande appliquée et acquittée en moins d'une seconde", async () => {
    const r = await sendCommands(bridge, [{ op: "ping" }], 3000);
    expect(r.timedOut).toBe(false);
    expect(r.results[0]).toMatchObject({ ok: true, result: "pong" });
    expect(r.ms).toBeLessThan(1000);
    const bad = await sendCommands(bridge, [{ op: "nope" }], 3000);
    expect(bad.results[0].ok).toBe(false);
    expect(readAck(bridge)!.last_id).toBe(bad.sent[0].id);
    writeCommands(bridge, [{ op: "ping" }]);
  });

  it("scénarios smoke, head_6dof, world_scale et controllers réussis", async () => {
    for (const name of ["smoke", "head_6dof", "world_scale", "controllers"]) {
      const { steps } = builtinScenario(name, { family: "unity_mono" });
      const rep = await runScenario(name, steps, session());
      expect({ name, failed: rep.steps.filter((s) => !s.ok) }).toEqual({ name, failed: [] });
    }
  }, 30000);

  it("échelle du monde fausse détectée (rapport 1,5)", async () => {
    world.scale = 1.5;
    const rep = await runScenario("ws", builtinScenario("world_scale", { family: "unity_mono" }).steps, session());
    expect(rep.ok).toBe(false);
    expect(rep.checks.find((c) => c.check.startsWith("delta"))!.detail).toMatch(/1[.,]5/);
    world.scale = 1;
  }, 15000);

  it("matrice : classe les variantes, détecte un plantage, relance et continue", async () => {
    const variants = expandAxes({
      echelle: [
        { label: "0.8", commands: [{ command: "camera_parent_scale", args: { value: 0.8 } }] },
        { label: "1.0", commands: [{ command: "camera_parent_scale", args: { value: 1.0 } }] },
        { label: "plantage", commands: [{ command: "crash" }] },
        { label: "1.3", commands: [{ command: "camera_parent_scale", args: { value: 1.3 } }] },
      ],
    });
    let relaunches = 0;
    const res = await runMatrix(session(), variants, builtinScenario("world_scale", { family: "unity_mono" }).steps.concat([{ op: "alive" }]), {
      settleMs: 50,
      relaunch: async () => {
        relaunches++;
        world.game = fakeGameProcess();
        await new Promise((r) => setTimeout(r, 100));
        return { ...session(), pid: world.game.pid };
      },
    });
    expect(res.rows).toHaveLength(4);
    expect(res.best?.variant).toBe("echelle=1.0");
    expect(res.rows.find((r) => r.variant === "echelle=plantage")!.crashed).toBe(true);
    expect(relaunches).toBe(1);
    expect(res.rows.find((r) => r.variant === "echelle=1.3")!.crashed).toBe(false);
    expect(fs.existsSync(res.reportFile)).toBe(true);
  }, 60000);
});

describe("checklist et générateurs du Lab", () => {
  it("preuve simulateur : confort/fréquence/échelle restent provisoires jusqu'au casque", () => {
    const gp = path.join(WORK, "ChkGame");
    fs.mkdirSync(gp, { recursive: true });
    initChecklist(gp, 2);
    setPoint(gp, "head_6dof", "closed", { evidence: "lab head_6dof", source: "simulateur", exeSha256: "a" });
    setPoint(gp, "world_scale", "closed", { evidence: "lab world_scale", source: "simulateur", exeSha256: "a" });
    let st = checklistStatus(gp, "a");
    expect(st.rows.find((r) => r.id === "head_6dof")!.state).toBe("closed");
    expect(st.rows.find((r) => r.id === "world_scale")!.state).toBe("provisional");
    setPoint(gp, "world_scale", "closed", { evidence: "confirmé en casque", source: "casque", exeSha256: "a" });
    st = checklistStatus(gp, "a");
    expect(st.rows.find((r) => r.id === "world_scale")!.state).toBe("closed");
  });

  it("les quatre générateurs livrent leur pont à chaud", async () => {
    const gp = path.join(WORK, "GenGame");
    fs.mkdirSync(gp, { recursive: true });
    const u = await scaffoldUevr({ gamePath: gp, exeStem: "Gen-Win64-Shipping", classes: [], comfort: {}, deploy: false, confirm: false });
    const lab = u.files.find((f) => f.endsWith("vra_lab.lua"))!;
    const lua = fs.readFileSync(lab, "utf8");
    expect(lua).toContain('json.load_file("vra_cmd.json")');
    expect(lua).toContain("on_post_calculate_stereo_view_offset");
    const unity = await scaffoldUnity({ gamePath: gp, exeDir: gp, runtime: "mono", classes: [], comfort: {} });
    const cs = fs.readFileSync(unity.files[0], "utf8");
    expect(cs).toContain("VraLab.Tick();");
    expect(cs).toContain("JsonUtility.FromJson<CmdFile>");
    const il = await scaffoldUnity({ gamePath: gp, exeDir: gp, runtime: "il2cpp", classes: [], comfort: {} });
    expect(fs.readFileSync(il.files[0], "utf8")).toContain("JsonSerializer.Deserialize<CmdFile>");
    const rf = await scaffoldReframework({ gamePath: gp, exeDir: gp, types: [], deploy: false, confirm: false });
    expect(rf.files.some((f) => f.endsWith("vra_lab.lua"))).toBe(true);
  });
});
