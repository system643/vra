// Read-only check of the detection on real installed games (nothing is written in the game folders;
// the game cards go to a temporary VRA_HOME). Usage: node test/real-games.mjs "<game dir>" ["<game dir>" …]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "vra-real-"));
const client = new Client({ name: "real", version: "1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, "..", "dist", "vra.mjs")], env: { ...process.env, VRA_HOME: home } }));
const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

for (const dir of process.argv.slice(2)) {
  const t0 = Date.now();
  const t = await call("triage_game", { game_path: dir });
  if (t.erreur) {
    console.log(`${path.basename(dir)} : ERREUR ${t.erreur}`);
    continue;
  }
  const p = await call("plan_target", { game_path: dir });
  const v = (c) => (c?.value === null || c?.value === undefined ? "?" : Array.isArray(c.value) ? c.value.join("+") : c.value) + `(${c?.status?.[0] ?? "-"})`;
  console.log(
    [
      path.basename(dir).padEnd(26),
      `${v(t.famille)} ${v(t.version)} ${v(t.variante)}`.padEnd(46),
      `api=${v(t.api_graphique)}`.padEnd(22),
      `ac=${t.anti_cheat.systemes.join("+") || "-"}`.padEnd(18),
      `vr=${t.vr_native.runtimes.join("+") || "-"}`.padEnd(22),
      `plafond=${p.ceiling} confirmé=${p.confirmedCeiling} cible=${p.target}`,
      `${Date.now() - t0}ms`,
    ].join(" "),
  );
}
await client.close();
fs.rmSync(home, { recursive: true, force: true });
