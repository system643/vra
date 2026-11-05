import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-ignore — plain ESM setup script (no dependencies)
import * as setup from "../../setup/setup.mjs";

const T = fs.mkdtempSync(path.join(os.tmpdir(), "vra-setup-"));

describe("installation en une commande (setup.mjs)", () => {
  it("options", () => {
    const o = setup.parseArgs(["--yes", "--dry-run", "--agents=claude,codex", "--install-simulator"]);
    expect(o).toMatchObject({ yes: true, dryRun: true, agents: "claude,codex", installSimulator: true });
  });

  it("choix des clients IA : auto = détectés, liste explicite filtrée", () => {
    const targets = { claude: { present: true }, codex: { present: false }, cursor: { present: true } };
    expect(setup.selectAgents("auto", targets)).toEqual(["claude", "cursor"]);
    expect(setup.selectAgents("all", targets)).toEqual(["claude", "codex", "cursor"]);
    expect(setup.selectAgents("codex,inconnu", targets)).toEqual(["codex"]);
    expect(setup.selectAgents("none", targets)).toEqual([]);
  });

  it("Codex : bloc TOML géré, idempotent, retirable, sans écraser une entrée manuelle", () => {
    const block = setup.codexBlock("C:\\VR\\server\\dist\\vra.mjs", { VRA_TOOL_FAMILIES: "all" });
    expect(block).toContain('args = ["C:\\\\VR\\\\server\\\\dist\\\\vra.mjs"]');
    const original = 'model = "gpt-5"\n\n[mcp_servers.autre]\ncommand = "x"\n';
    const once = setup.upsertTomlBlock(original, block).text;
    const twice = setup.upsertTomlBlock(once, block).text;
    expect(twice).toBe(once);
    expect(once.startsWith(original.trimEnd())).toBe(true);
    expect(once.match(/\[mcp_servers\.vra\]/g)).toHaveLength(1);
    expect(setup.upsertTomlBlock(once, block, { remove: true }).text.trim()).toBe(original.trim());
    const manual = original + '\n[mcp_servers.vra]\ncommand = "perso"\n';
    expect(setup.upsertTomlBlock(manual, block).conflict).toBe(true);
  });

  it("JSON MCP : ajout avec sauvegarde, idempotent, préserve le reste, refuse le JSON à commentaires", () => {
    const env = { ...process.env, VRA_HOME: path.join(T, "home") };
    const f = path.join(T, "mcp.json");
    fs.writeFileSync(f, JSON.stringify({ servers: { autre: { command: "npx", env: { SECRET: "ne-pas-toucher" } } }, inputs: [] }));
    const entry = { type: "stdio", command: "node", args: ["vra.mjs"] };
    const r1 = setup.upsertJsonServer(f, "servers", "vra", entry, { env });
    expect(r1.changed).toBe(true);
    expect(fs.existsSync(r1.backup)).toBe(true);
    const data = JSON.parse(fs.readFileSync(f, "utf8"));
    expect(data.servers.autre.env.SECRET).toBe("ne-pas-toucher");
    expect(data.servers.vra).toEqual(entry);
    expect(data.inputs).toEqual([]);
    expect(setup.upsertJsonServer(f, "servers", "vra", entry, { env }).changed).toBe(false);
    expect(setup.upsertJsonServer(f, "servers", "vra", entry, { env, remove: true }).changed).toBe(true);
    expect(JSON.parse(fs.readFileSync(f, "utf8")).servers.vra).toBeUndefined();
    const commented = path.join(T, "commented.json");
    fs.writeFileSync(commented, '{\n  // commentaire\n  "servers": {}\n}');
    expect(setup.upsertJsonServer(commented, "servers", "vra", entry, { env }).error).toMatch(/non JSON strict/);
    expect(fs.readFileSync(commented, "utf8")).toContain("// commentaire");
    const empty = path.join(T, "empty.json");
    fs.writeFileSync(empty, "");
    expect(setup.upsertJsonServer(empty, "mcpServers", "vra", entry, { env }).changed).toBe(true);
  });

  it("logiciels Meta trouvés dans les dossiers habituels", () => {
    const d = path.join(T, "dl");
    fs.mkdirSync(path.join(d, "meta-xr-operator-standalone-public-v207.0.1", "windows"), { recursive: true });
    fs.writeFileSync(path.join(d, "meta_xr_simulator_v207.1.msi"), "");
    fs.writeFileSync(path.join(d, "meta-xr-operator-standalone-public-v207.0.1.zip"), "");
    fs.writeFileSync(path.join(d, "meta-xr-operator-standalone-public-v207.0.1", "windows", "XrApiLayer_METAX_operator.json"), "{}");
    const f = setup.findMetaPackages([path.join(T, "absent"), d]);
    expect(path.basename(f.simulatorMsi)).toBe("meta_xr_simulator_v207.1.msi");
    expect(path.basename(f.operatorZip)).toBe("meta-xr-operator-standalone-public-v207.0.1.zip");
    expect(f.operatorDir).toBeTruthy();
  });

  it("dossier des données : VRA_HOME prioritaire", () => {
    expect(setup.vraHome({ VRA_HOME: path.join(T, "x") })).toBe(path.join(T, "x"));
  });

  it("mode autonome : règles ajoutées à permissions.allow sans rien perdre, idempotent, retirables", () => {
    const env = { ...process.env, VRA_HOME: path.join(T, "home2"), CLAUDE_CONFIG_DIR: path.join(T, "claude") };
    const f = setup.claudeSettingsFile(env);
    expect(f).toBe(path.join(T, "claude", "settings.json"));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ model: "opus", permissions: { allow: ["Bash(git status)"], deny: ["Bash(rm:*)"] } }));
    const r = setup.upsertClaudePermissions(f, setup.AUTONOMOUS_RULES, { env });
    expect(r.changed && fs.existsSync(r.backup)).toBe(true);
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    expect(d.model).toBe("opus");
    expect(d.permissions.deny).toEqual(["Bash(rm:*)"]);
    expect(d.permissions.allow).toEqual(["Bash(git status)", ...setup.AUTONOMOUS_RULES]);
    expect(setup.upsertClaudePermissions(f, setup.AUTONOMOUS_RULES, { env }).changed).toBe(false);
    setup.upsertClaudePermissions(f, setup.AUTONOMOUS_RULES, { env, remove: true });
    expect(JSON.parse(fs.readFileSync(f, "utf8")).permissions.allow).toEqual(["Bash(git status)"]);
  });
});

describe("lanceur du pilote automatique (autopilot.mjs)", async () => {
  // @ts-ignore — plain ESM script
  const ap = await import("../../setup/autopilot.mjs");
  const { gameSlug } = await import("../src/paths.js");

  it("même identifiant de jeu que le serveur, options, prompt sans question", () => {
    for (const p of ["C:\\Jeux\\Été Héroïque", "D:/SteamLibrary/steamapps/common/Escape the Backrooms"]) expect(ap.gameSlug(p)).toBe(gameSlug(p));
    expect(ap.parseArgs(["D:\\Jeu", "--attempts=20", "--hours=2", "--contra=juste à la manette"])).toMatchObject({ game: "D:\\Jeu", attempts: 20, hours: 2, contra: "juste à la manette" });
    const prompt = ap.buildPrompt({ game: "D:\\Jeu", attempts: 60, hours: 6, contra: "" }, ap.grantQuote("D:\\Jeu", new Date("2026-11-05T10:00:00Z")));
    expect(prompt).toContain("vr_autopilot");
    expect(prompt).toContain("autonomy_grant");
    expect(prompt).toContain("attempts=60");
    expect(prompt).toMatch(/ne pose aucune question/);
    expect(ap.claudeArgs(["--resume", "x"])).toEqual(expect.arrayContaining(["-p", "--allowedTools", "--max-turns", "--resume", "x"]));
    expect(ap.ALLOWED_TOOLS).not.toContain("Bash");
  });
});
