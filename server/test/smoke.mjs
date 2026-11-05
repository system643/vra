// End-to-end smoke test: starts the bundled server over stdio, triages a fake Unreal game,
// checks adaptive tool families, plans the target and generates a UEVR script (no deploy).
// Usage: node test/smoke.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FIXTURES, writeFixture } from "../../evals/fixtures/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "vra-smoke-home-"));
const game = fs.mkdtempSync(path.join(os.tmpdir(), "vra-smoke-game-"));
await writeFixture(FIXTURES.find((f) => f.id === "ue53-solo"), game);

const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(here, "..", "dist", "vra.mjs")], env: { ...process.env, VRA_HOME: home } });
const client = new Client({ name: "smoke", version: "1" });
let listChanged = 0;
client.fallbackNotificationHandler = async (n) => {
  if (n.method === "notifications/tools/list_changed") listChanged++;
};
await client.connect(transport);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const data = JSON.parse(r.content[0].text);
  if (r.isError) throw new Error(`${name}: ${data.erreur}`);
  return data;
};
const ok = (cond, msg) => {
  if (!cond) {
    console.error("ÉCHEC :", msg);
    process.exitCode = 1;
  } else console.log("ok :", msg);
};

const before = (await client.listTools()).tools.map((t) => t.name);
ok(!before.includes("scaffold_uevr_profile"), "outils Unreal masqués avant la détection");
const s = await call("session_open", { game_path: game });
ok(s.premiere_session === true, "session ouverte");
const t = await call("triage_game", { game_path: game });
ok(t.famille.value === "unreal" && t.version.value === "5.3", `triage : ${t.moteur.value} ${t.version.value}`);
const after = (await client.listTools()).tools.map((x) => x.name);
ok(after.includes("scaffold_uevr_profile"), `famille unreal activée (${listChanged} notification(s) list_changed)`);
const p = await call("plan_target", { game_path: game, contraindications: { gamepad_only: true, quote: "juste à la manette" } });
ok(p.ceiling === 3 && p.target === 2 && /Maximum possible/.test(p.reminder), "contre-indication explicite : cible 2, maximum rappelé");
const p2 = await call("plan_target", { game_path: game });
ok(p2.target === 3 && p2.loweredBy.length === 0, "sans contre-indication : cible = plafond 3");
const sc = await call("scaffold_uevr_profile", { game_path: game, deploy: true, confirm: false });
ok(sc.deployed === false && fs.existsSync(sc.files[0]), "script UEVR généré, non déployé sans confirm");
const chk = await call("quality_checklist", { game_path: game, action: "init" });
ok(chk.rows.length === 13, `checklist niveau 3 : ${chk.rows.length} points`);
const wf = await client.getPrompt({ name: "vr_ify_game", arguments: { game_path: game } });
ok(/maximum/.test(wf.messages[0].content.text), "prompt vr_ify_game rendu");
const res = await call("session_resume", { game_path: game });
ok(res.cible.level === 3, "reprise de session : cible mémorisée");
await client.close();
fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(game, { recursive: true, force: true });
