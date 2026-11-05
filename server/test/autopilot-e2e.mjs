// End-to-end test of the autopilot through the real MCP server (dist/vra.mjs), without a headset:
// fake Unity game (a copy of node.exe running fake-game.mjs with the hot bridge), fake Meta XR Operator
// (MCP over SSE on port 8720), fake metavr CLI. The test plays the agent: autopilot_next → tool(s) → autopilot_report.
// Scenario: strategy 1 crashes, strategy 2 has a wrong world scale, strategy 3 works (level 2), strategy 4
// (level 3) fails. Expected: best = strategy 3, changes of 1, 2 and 4 undone, report written, notification logged.
// Usage: node test/autopilot-e2e.mjs   (after npm run build)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { FIXTURES, writeFixture } from "../../evals/fixtures/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.now();
const home = fs.mkdtempSync(path.join(os.tmpdir(), "vra-e2e-home-"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "vra-e2e-work-"));
const game = path.join(work, "FakeUnityGame");
await writeFixture(FIXTURES.find((f) => f.id === "unity-mono"), game);
fs.copyFileSync(process.execPath, path.join(game, "FakeGame.exe"));

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error("ÉCHEC :", msg);
    failures++;
  } else console.log("ok :", msg);
};

/* ───────── fake simulator runtime + Operator layer on disk ───────── */
const simJson = path.join(work, "meta_openxr_simulator.json");
fs.writeFileSync(simJson, JSON.stringify({ file_format_version: "1.0.0", runtime: { library_path: "SIMULATOR.dll" } }));
const opDir = path.join(work, "operator", "windows");
fs.mkdirSync(opDir, { recursive: true });
fs.writeFileSync(path.join(opDir, "XrApiLayer_METAX_operator.json"), JSON.stringify({ file_format_version: "1.0.0", api_layer: { name: "XR_APILAYER_METAX_operator", library_path: "./op.dll" } }));
fs.writeFileSync(path.join(opDir, "op.dll"), "");

/* ───────── fake Meta XR Operator (MCP over SSE, port 8720) ───────── */
const poseFile = path.join(work, "pose.json");
const world = { headY: 1.6, headX: 0, yaw: 0, handY: 1.3 };
const savePose = () => fs.writeFileSync(poseFile, JSON.stringify(world));
savePose();

function noise(x, y) {
  const h = (ix, iy) => {
    let n = ix * 374761393 + iy * 668265263;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const x0 = Math.floor(x / 8), y0 = Math.floor(y / 8), fx = x / 8 - x0, fy = y / 8 - y0;
  const s = (t) => t * t * (3 - 2 * t);
  const a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * s(fx);
  const b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * s(fx);
  return 30 + 200 * (a + (b - a) * s(fy));
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(W, H, px) {
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw[y * (W + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(px(x, y))));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function frame() {
  const W = 320, H = 120, half = W / 2;
  const k = -world.yaw + world.headX * 40;
  const ky = (world.headY - 1.6) * 40;
  return png(W, H, (x, y) => {
    const right = x >= half;
    const ex = right ? x - half : x;
    const hy = Math.round(100 - (world.handY - 1) * 80);
    if (ex > 100 && ex < 130 && y > hy - 10 && y < hy + 10) return 250;
    return noise(ex + k + (right ? 4 : 0) + 200, y + ky + 200);
  });
}

function operatorServer() {
  const s = new McpServer({ name: "fake-meta-xr-operator", version: "0" });
  s.registerTool("openxr_set_head_pose", { inputSchema: { position: z.object({ x: z.number(), y: z.number(), z: z.number() }), yaw: z.number() } }, async ({ position, yaw }) => {
    world.headY = position.y;
    world.headX = position.x;
    world.yaw = yaw;
    savePose();
    return { content: [{ type: "text", text: "ok" }] };
  });
  s.registerTool("set_controller_pose", { inputSchema: { hand: z.string(), position: z.object({ x: z.number(), y: z.number(), z: z.number() }) } }, async ({ position }) => {
    world.handY = position.y;
    savePose();
    return { content: [{ type: "text", text: "ok" }] };
  });
  s.registerTool("press_button", { inputSchema: { hand: z.string(), button: z.string(), value: z.any() } }, async () => ({ content: [{ type: "text", text: "ok" }] }));
  s.registerTool("capture_screenshot", { inputSchema: {} }, async () => ({ content: [{ type: "image", mimeType: "image/png", data: frame().toString("base64") }] }));
  return s;
}
const transports = new Map();
const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/sse") {
    const t = new SSEServerTransport("/messages", res);
    transports.set(t.sessionId, t);
    res.on("close", () => transports.delete(t.sessionId));
    await operatorServer().connect(t);
  } else if (req.method === "POST" && url.pathname === "/messages") {
    const t = transports.get(url.searchParams.get("sessionId"));
    if (!t) {
      res.writeHead(404).end();
      return;
    }
    await t.handlePostMessage(req, res);
  } else res.writeHead(404).end();
});
await new Promise((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen(8720, "127.0.0.1", resolve);
}).catch((e) => {
  console.error(`Port 8720 occupé (vrai Meta XR Operator lancé ?) : ${e.message}`);
  process.exit(2);
});

/* ───────── strategies: 1 crashes, 2 wrong scale, 3 works, 4 (level 3) fails ───────── */
const mods = path.join(work, "mods");
fs.mkdirSync(mods, { recursive: true });
const fakeGame = path.join(here, "fake-game.mjs");
const G = "{{game_path}}";
const strat = (id, level, launchFlags, tests, extra = {}) => {
  fs.writeFileSync(path.join(mods, `mod_${id}.txt`), id);
  return {
    id,
    level,
    title: id,
    why: "test de bout en bout",
    actions: [
      { id: "stop", tools: ["lab_stop"], args: { game_path: G }, goal: "départ propre" },
      { id: "deploy", tools: ["deploy_files"], args: { game_path: G, source_dir: mods, files: [`mod_${id}.txt`], target_root: game }, goal: "déployer le mod" },
      { id: "launch", tools: ["lab_launch"], args: { game_path: G, exe: "FakeGame.exe", args: [fakeGame, ...launchFlags], wait_bridge_seconds: 20 }, goal: "lancer", test: true, retries: 1 },
      ...tests,
    ],
    ...extra,
  };
};
const sc = (builtin, level, opts = {}) => ({ id: `test_${builtin}`, tools: ["lab_run_scenario"], args: { builtin, ...opts }, goal: builtin, test: true, level, retries: 1 });
const library = {
  unity_mono: [
    strat("s1_plante", 2, ["--crash-after=300"], [sc("smoke", 2)]),
    strat("s2_echelle", 2, ["--scale=1.5"], [sc("smoke", 2), sc("world_scale", 2)]),
    strat("s3_ok", 2, [], [sc("smoke", 2), sc("head_6dof", 2), sc("world_scale", 2, { record: true })], { settings: [{ op: "set_scale", args: { value: 1 } }] }),
    strat("s4_mains", 3, [], [{ id: "test_weapon", tools: ["lab_run_scenario"], args: { name: "arme_en_main", steps: [{ op: "state", label: "s" }, { op: "assert_state", label: "s", path: "weapon_attached", cmp: "==", value: true }] }, goal: "arme attachée à la main", test: true, level: 3, retries: 1 }], { requires: ["best_level_2"] }),
  ],
};
const libFile = path.join(work, "strategies.json");
fs.writeFileSync(libFile, JSON.stringify(library));

/* ───────── MCP server ───────── */
const env = {
  ...process.env,
  VRA_HOME: home,
  VRA_TOOL_FAMILIES: "all",
  VRA_NO_NOTIFY: "1",
  VRA_METAVR_CMD: path.join(here, "fake-metavr.mjs"),
  FAKE_METAVR_LOG: path.join(work, "metavr.log"),
  FAKE_METAVR_STATE: work,
  VRA_XRSIM_JSON: simJson,
  VRA_XR_OPERATOR_DIR: opDir,
  VRA_AUTOPILOT_STRATEGIES: libFile,
  FAKE_POSE_FILE: poseFile,
};
const client = new Client({ name: "autopilot-e2e", version: "1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, "..", "dist", "vra.mjs")], env }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 600000 });
  let data;
  try {
    data = JSON.parse(r.content[0].text);
  } catch {
    throw new Error(`${name}: ${r.content[0].text}`);
  }
  if (r.isError) throw new Error(`${name}: ${data.erreur}`);
  return data;
};

await call("session_open", { game_path: game });
await call("triage_game", { game_path: game });
const pf0 = await call("autopilot_preflight", { game_path: game });
ok(!pf0.pret && pf0.bloquants.includes("autorisation autonome"), "pré-vol : refuse sans autorisation autonome");
await call("autonomy_grant", { game_path: game, quote: "Lance le pilote automatique sur ce jeu, débrouille-toi sans moi" });
const pf = await call("autopilot_preflight", { game_path: game });
ok(pf.pret, `pré-vol prêt (${pf.verifications.map((v) => `${v.point}:${v.ok ? "ok" : "non"}`).join(", ")})`);
const st = await call("autopilot_start", { game_path: game });
ok(st.cible === 3 && st.strategies.length === 4, `démarrage : cible ${st.cible}, ${st.strategies.length} stratégies`);

/* ───────── the "agent" ───────── */
let operatorMapped = false;
const log = [];
for (let k = 0; k < 400; k++) {
  const n = await call("autopilot_next", { game_path: game });
  if (n.done || !n.action) break;
  const a = n.action;
  const t0 = Date.now();
  let okA = true, crashed = false, summary = "ok", evidence = [], videos = [];
  try {
    if (a.tools[0] === "lab_launch") {
      const r = await call("lab_launch", a.args);
      okA = r.pont_a_chaud?.pret === true;
      crashed = typeof r.pont_a_chaud === "string" && /fermé/.test(r.pont_a_chaud);
      summary = okA ? `lancé, pont prêt en ${r.pont_a_chaud.apres_ms} ms` : String(r.pont_a_chaud);
      if (okA && !operatorMapped && /À FAIRE/.test(r.correspondance_operator)) {
        const tools = await call("lab_operator_tools", {});
        ok(tools.proposition.head_pose?.tool === "openxr_set_head_pose", "correspondance Operator proposée (openxr_set_head_pose)");
        await call("lab_operator_map", {
          map: {
            head_pose: { tool: "openxr_set_head_pose", args: { position: { x: "{{px}}", y: "{{py}}", z: "{{pz}}" }, yaw: "{{yaw}}" } },
            controller_pose: { tool: "set_controller_pose", args: { hand: "{{hand}}", position: { x: "{{px}}", y: "{{py}}", z: "{{pz}}" } } },
            button: { tool: "press_button", args: { hand: "{{hand}}", button: "{{button}}", value: "{{value}}" } },
            capture: { tool: "capture_screenshot", args: {} },
          },
        });
        operatorMapped = true;
      }
    } else if (a.tools[0] === "lab_run_scenario") {
      const r = await call("lab_run_scenario", a.args);
      okA = r.ok === true;
      crashed = /ne tourne plus|PLANTÉ/.test(JSON.stringify(r.steps));
      summary = okA ? `${r.name} réussi (${r.passed} étapes)` : `${r.name} : ${r.steps.filter((s) => !s.ok).map((s) => s.error).join(" ; ").slice(0, 200)}`;
      evidence = Object.values(r.captures ?? {}).slice(0, 2);
      if (typeof r.video === "string" && r.video.endsWith(".mp4")) videos = [r.video];
    } else if (a.tools[0] === "deploy_files") {
      const r = await call("deploy_files", a.args);
      okA = r.deployed === true;
      summary = okA ? `déployé (sauvegarde ${r.backupId})` : "non déployé";
    } else if (a.tools[0] === "lab_command") {
      const r = await call("lab_command", { commands: a.args.commands ?? [] });
      okA = !r.timedOut;
    } else {
      await call(a.tools[0], a.args);
    }
  } catch (e) {
    okA = false;
    summary = e.message.slice(0, 300);
  }
  log.push(`${a.strategy}:${a.id}=${okA ? "ok" : crashed ? "plantage" : "échec"}`);
  await call("autopilot_report", { game_path: game, action_id: a.id, ok: okA, summary, evidence, crashed, videos, ms: Date.now() - t0 });
}
console.log(log.join("  "));
const status = await call("autopilot_status", { game_path: game });
console.log("Journal du pilote :", status.journal.join(" | "));

const fin = await call("autopilot_finish", { game_path: game });
ok(fin.issue === "impossible" && fin.meilleur?.strategy === "s3_ok" && fin.meilleur.level === 2, `issue : ${fin.issue}, meilleure stratégie ${fin.meilleur?.strategy} niveau ${fin.meilleur?.level}`);
ok(log.includes("s1_plante:crash_stop=ok") || log.some((l) => l.startsWith("s1_plante:watchdog")), "plantage détecté : relance automatique (chien de garde ou nouvel essai)");
ok(!fs.existsSync(path.join(game, "mod_s1_plante.txt")) && !fs.existsSync(path.join(game, "mod_s2_echelle.txt")) && !fs.existsSync(path.join(game, "mod_s4_mains.txt")), "changements des stratégies ratées annulés");
ok(fs.existsSync(path.join(game, "mod_s3_ok.txt")), "configuration gagnante conservée");
ok(fs.existsSync(fin.rapport) && /Meilleur niveau prouvé en simulateur : \*\*2\*\*/.test(fs.readFileSync(fin.rapport, "utf8")), "rapport-autopilot.md écrit");
ok(fs.existsSync(fin.rapport_html), "rapport HTML écrit");
ok(fin.meilleur.videos.length >= 1 && fs.existsSync(fin.meilleur.videos[0]), "vidéo MP4 du meilleur essai rangée dans le profil");
ok(fs.readFileSync(path.join(home, "lab", "notifications.jsonl"), "utf8").includes("niveau 2"), "notification Windows émise (journal)");
const metavrCalls = fs.readFileSync(path.join(work, "metavr.log"), "utf8");
ok(/"device","set","--name","Meta Quest 3"/.test(metavrCalls) && /"runtime","fps"/.test(metavrCalls), "simulateur piloté par metavr (casque Quest 3, FPS mesurés)");
const left = execFileSync("tasklist", ["/FI", "IMAGENAME eq FakeGame.exe", "/FO", "CSV", "/NH"], { encoding: "utf8" });
ok(!/FakeGame\.exe/i.test(left), "aucun processus du faux jeu laissé ouvert");

await client.close();
httpServer.close();
for (const t of transports.values()) await t.close().catch(() => undefined);
console.log(`Durée : ${Math.round((Date.now() - T0) / 1000)} s`);
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(work, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
