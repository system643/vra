#!/usr/bin/env node
/**
 * VRA — installation complète en une commande, juste après le git clone.
 *
 *   node setup/setup.mjs [options]          (setup.cmd / setup.ps1 l'appellent pour toi)
 *
 * Options :
 *   --yes                 ne pose aucune question (accepte les étapes proposées)
 *   --dry-run             montre ce qui serait fait, sans rien modifier
 *   --json                événements en JSON (une ligne par événement) — utilisé par l'interface graphique
 *   --agents=auto|all|none|claude,codex,gemini,antigravity,cursor,vscode,claude-desktop
 *   --skip-build          ne relance pas npm install / build
 *   --full-tests          lance toute la suite de tests (sinon : test de bout en bout rapide)
 *   --skip-tests          aucun test
 *   --install-simulator   lance l'installeur .msi de Meta XR Simulator s'il est trouvé
 *   --dotnet              installe le SDK .NET 8 (winget) s'il manque, sans demander — nécessaire pour fabriquer les mods Unity
 *   --no-dotnet           ne propose pas l'installation du SDK .NET 8
 *   --autonomous          mode autonome : Claude Code n'interrompt plus le pilote automatique pour des permissions
 *                         (outils VRA, recherche web, lecture de fichiers ajoutés à ~/.claude/settings.json, sauvegardé)
 *   --uninstall           retire VRA de tous les clients IA (sauvegardes conservées)
 *
 * Règles (les mêmes que VRA) : chaque fichier de configuration est sauvegardé avant modification,
 * les ajouts sont idempotents et marqués, rien d'autre n'est installé sans option explicite.
 * Ce script n'a aucune dépendance : il tourne avant même « npm install ».
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";

/* ───────────────────────── options & events ───────────────────────── */

export function parseArgs(argv) {
  const o = { status: false, yes: false, dryRun: false, json: false, agents: "auto", skipBuild: false, fullTests: false, skipTests: false, installSimulator: false, dotnet: false, noDotnet: false, autonomous: false, uninstall: false };
  for (const a of argv) {
    if (a === "--yes" || a === "-y") o.yes = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else if (a.startsWith("--agents=")) o.agents = a.slice(9);
    else if (a === "--skip-build") o.skipBuild = true;
    else if (a === "--full-tests") o.fullTests = true;
    else if (a === "--skip-tests") o.skipTests = true;
    else if (a === "--install-simulator") o.installSimulator = true;
    else if (a === "--dotnet") o.dotnet = true;
    else if (a === "--no-dotnet") o.noDotnet = true;
    else if (a === "--autonomous") o.autonomous = true;
    else if (a === "--uninstall") o.uninstall = true;
    else if (a === "--status") o.status = true;
  }
  return o;
}

let OPTS = parseArgs([]);
const report = { startedAt: new Date().toISOString(), repo: REPO, steps: [] };

function emit(ev) {
  if (ev.type === "step" && ev.status !== "start") report.steps.push(ev);
  if (OPTS.json) {
    process.stdout.write(JSON.stringify(ev) + "\n");
    return;
  }
  const icon = { start: "…", ok: "✔", warn: "!", fail: "✖", skip: "–", info: "•" }[ev.status ?? "info"] ?? "•";
  if (ev.type === "step") process.stdout.write(`${icon} ${ev.title}${ev.detail ? ` — ${ev.detail}` : ""}\n`);
  else if (ev.type === "log") process.stdout.write(`    ${ev.text}\n`);
  else if (ev.type === "summary") process.stdout.write(`\n${ev.text}\n`);
}
const step = (id, title, status, detail) => emit({ type: "step", id, title, status, ...(detail ? { detail } : {}) });
const log = (text) => emit({ type: "log", text });

async function ask(question, def = true) {
  if (OPTS.yes || OPTS.json) return def;
  if (!process.stdin.isTTY) return def;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((res) => rl.question(`${question} ${def ? "[O/n]" : "[o/N]"} `, res));
  rl.close();
  const a = String(ans).trim().toLowerCase();
  return a ? a.startsWith("o") || a.startsWith("y") : def;
}

/* ───────────────────────── helpers ───────────────────────── */

export function vraHome(env = process.env) {
  if (env.VRA_HOME && env.VRA_HOME.trim()) return path.resolve(env.VRA_HOME.trim());
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const docs = path.join(home, "Documents");
  return path.join(fs.existsSync(docs) ? docs : home, "VRA");
}

function homeDir(env = process.env) {
  return env.USERPROFILE || env.HOME || os.homedir();
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: IS_WIN && !/\.exe$/i.test(cmd), windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 300000, input: "", ...opts });
  return { code: r.status ?? (r.error ? -1 : 0), out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(), error: r.error?.message };
}

export function which(cmd) {
  const r = IS_WIN ? spawnSync("where", [cmd], { encoding: "utf8", windowsHide: true }) : spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] ?? null;
}

/** Stream a long command (npm…) line by line into the event log. */
function runStreaming(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: IS_WIN, windowsHide: true });
    const onData = (d) => String(d).split(/\r?\n/).filter((l) => l.trim()).forEach((l) => log(l.slice(0, 300)));
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

let backupRoot = null;
/** Copy a file into <VRA_HOME>/backups/_setup/<timestamp>/ before touching it. */
export function backupFile(file, env = process.env) {
  if (!fs.existsSync(file)) return null;
  if (!backupRoot) backupRoot = path.join(vraHome(env), "backups", "_setup", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(backupRoot, { recursive: true });
  const dst = path.join(backupRoot, file.replace(/[:\\/]+/g, "_"));
  fs.copyFileSync(file, dst);
  return dst;
}

function readJsonLoose(file) {
  if (!fs.existsSync(file)) return { ok: true, data: {} };
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (!text.trim()) return { ok: true, data: {} };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, data: null };
  }
}

/**
 * Add or replace one MCP server entry in a JSON config (Cursor, Claude Desktop, VS Code, Gemini, Antigravity).
 * Never rewrites a file it cannot parse (JSON with comments…): reports instead.
 */
export function upsertJsonServer(file, key, name, entry, { remove = false, dryRun = false, env = process.env } = {}) {
  const r = readJsonLoose(file);
  if (!r.ok) return { changed: false, error: `fichier non JSON strict (commentaires ?) : ${file} — ajouter « ${name} » à la main` };
  const data = r.data ?? {};
  data[key] = data[key] && typeof data[key] === "object" ? data[key] : {};
  const before = JSON.stringify(data[key][name] ?? null);
  if (remove) delete data[key][name];
  else data[key][name] = entry;
  const after = JSON.stringify(data[key][name] ?? null);
  if (before === after) return { changed: false };
  if (dryRun) return { changed: true, dryRun: true };
  const backup = backupFile(file, env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return { changed: true, backup };
}

export const TOML_BEGIN = "# >>> VRA (bloc géré par setup VRA, ne pas modifier à la main) >>>";
export const TOML_END = "# <<< VRA <<<";

const tomlStr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Permission rules added by the "autonomous mode" option (Claude Code settings.json, permissions.allow). */
export const AUTONOMOUS_RULES = ["mcp__plugin_vra_vra", "WebSearch", "WebFetch", "Read"];

export function claudeSettingsFile(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim() ? env.CLAUDE_CONFIG_DIR.trim() : path.join(homeDir(env), ".claude");
  return path.join(dir, "settings.json");
}

/** Add (or remove) rules in permissions.allow, keeping everything else; backup before writing; never rewrites non-strict JSON. */
export function upsertClaudePermissions(file, rules, { remove = false, dryRun = false, env = process.env } = {}) {
  const r = readJsonLoose(file);
  if (!r.ok) return { changed: false, error: `fichier non JSON strict : ${file} — ajouter à la main dans permissions.allow : ${rules.join(", ")}` };
  const data = r.data ?? {};
  data.permissions = data.permissions && typeof data.permissions === "object" ? data.permissions : {};
  const allow = Array.isArray(data.permissions.allow) ? data.permissions.allow : [];
  const next = remove ? allow.filter((x) => !rules.includes(x)) : [...allow, ...rules.filter((x) => !allow.includes(x))];
  if (JSON.stringify(next) === JSON.stringify(allow)) return { changed: false };
  if (dryRun) return { changed: true, dryRun: true };
  data.permissions.allow = next;
  const backup = backupFile(file, env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return { changed: true, backup };
}

export function codexBlock(serverPath, env) {
  const lines = [TOML_BEGIN, "[mcp_servers.vra]", `command = "node"`, `args = [${tomlStr(serverPath)}]`, "startup_timeout_sec = 30", "", "[mcp_servers.vra.env]"];
  for (const [k, v] of Object.entries(env)) lines.push(`${k} = ${tomlStr(v)}`);
  lines.push(TOML_END);
  return lines.join("\n");
}

/** Insert/replace the managed block in Codex config.toml; refuses if a foreign [mcp_servers.vra] exists. */
export function upsertTomlBlock(text, block, { remove = false } = {}) {
  const re = new RegExp(`${TOML_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${TOML_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
  const stripped = text.replace(re, "");
  if (/^\s*\[mcp_servers\.vra\]/m.test(stripped)) return { text, conflict: true };
  if (remove) return { text: stripped, conflict: false };
  const base = stripped.replace(/\s*$/, "");
  return { text: `${base}${base ? "\n\n" : ""}${block}\n`, conflict: false };
}

function linkDir(target, linkPath, dryRun) {
  if (fs.existsSync(linkPath)) {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      try {
        if (path.resolve(fs.readlinkSync(linkPath)) === path.resolve(target)) return "déjà lié";
      } catch {
        /* fall through */
      }
      if (!dryRun) fs.rmSync(linkPath, { recursive: false, force: true });
    } else {
      return "existe déjà (dossier réel) : laissé tel quel";
    }
  }
  if (dryRun) return "serait lié";
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, IS_WIN ? "junction" : "dir");
  return "lié";
}

/* ───────────────────────── discovery ───────────────────────── */

export function findMetaPackages(searchDirs) {
  const found = { simulatorMsi: null, operatorZip: null, operatorDir: null };
  for (const d of searchDirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isFile() && /^meta[_-]xr[_-]simulator.*\.msi$/i.test(e.name) && !found.simulatorMsi) found.simulatorMsi = p;
      if (e.isFile() && /^meta-xr-operator-standalone.*\.zip$/i.test(e.name) && !found.operatorZip) found.operatorZip = p;
      if (e.isDirectory() && /^meta-xr-operator-standalone/i.test(e.name) && fs.existsSync(path.join(p, "windows", "XrApiLayer_METAX_operator.json")) && !found.operatorDir) found.operatorDir = p;
    }
  }
  return found;
}

function regQuery(key) {
  if (!IS_WIN) return [];
  const r = spawnSync("reg.exe", ["query", key], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return [];
  return String(r.stdout)
    .split(/\r?\n/)
    .map((l) => /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ name: m[1].trim(), data: m[3].trim() }));
}

export function simulatorInstalled() {
  const runtimes = regQuery("HKLM\\SOFTWARE\\Khronos\\OpenXR\\1\\AvailableRuntimes").map((r) => r.name);
  return runtimes.find((n) => /simulat|xrsim/i.test(n)) ?? null;
}

export function agentTargets(env = process.env) {
  const home = homeDir(env);
  const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
  const has = (p) => fs.existsSync(p);
  const antigravity = [path.join(home, ".gemini", "antigravity", "mcp_config.json"), path.join(home, ".gemini", "config", "mcp_config.json")].find(has) ?? null;
  return {
    claude: { label: "Claude Code (plugin complet : skill, agents, serveur MCP)", present: !!which("claude") },
    codex: { label: "OpenAI Codex (serveur MCP + skill)", present: !!which("codex") || has(path.join(env.CODEX_HOME || path.join(home, ".codex"))), config: path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"), skills: path.join(env.CODEX_HOME || path.join(home, ".codex"), "skills") },
    gemini: { label: "Gemini CLI (serveur MCP + contexte AGENTS.md)", present: !!which("gemini") || has(path.join(home, ".gemini", "settings.json")), config: path.join(home, ".gemini", "settings.json") },
    antigravity: { label: "Google Antigravity (serveur MCP)", present: !!antigravity, config: antigravity ?? path.join(home, ".gemini", "antigravity", "mcp_config.json") },
    cursor: { label: "Cursor (serveur MCP)", present: has(path.join(home, ".cursor")) || !!which("cursor"), config: path.join(home, ".cursor", "mcp.json") },
    vscode: { label: "VS Code / Copilot (serveur MCP)", present: has(path.join(appData, "Code", "User")), config: path.join(appData, "Code", "User", "mcp.json") },
    "claude-desktop": { label: "Claude Desktop (serveur MCP)", present: has(path.join(appData, "Claude")), config: path.join(appData, "Claude", "claude_desktop_config.json") },
  };
}

export function selectAgents(spec, targets) {
  const all = Object.keys(targets);
  if (spec === "none") return [];
  if (spec === "all") return all;
  if (spec === "auto") return all.filter((k) => targets[k].present);
  return spec.split(",").map((s) => s.trim()).filter((s) => all.includes(s));
}

/* ───────────────────────── steps ───────────────────────── */

const SERVER = path.join(REPO, "server");
const BUNDLE = path.join(SERVER, "dist", "vra.mjs");
/** Clients other than Claude Code may not refresh their tool list: expose all tool families there. */
const MCP_ENV = { VRA_TOOL_FAMILIES: "all", VRA_SCHEMA_PROFILE: "compact" };

function stepPrereqs() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    step("prereq", "Node.js 22+ requis", "fail", `version actuelle ${process.versions.node} — installer Node LTS (setup.cmd le fait via winget)`);
    return false;
  }
  step("prereq", "Node.js", "ok", process.versions.node);
  const git = which("git");
  step("git", "Git", git ? "ok" : "warn", git ?? "absent : nécessaire pour git pull (mises à jour)");
  const npm = which("npm");
  if (!npm) {
    step("npm", "npm", "fail", "absent");
    return false;
  }
  return true;
}

async function stepBuild() {
  if (OPTS.skipBuild) {
    step("build", "Serveur VRA", fs.existsSync(BUNDLE) ? "skip" : "warn", fs.existsSync(BUNDLE) ? "construction ignorée (--skip-build), bundle présent" : "bundle absent");
    return fs.existsSync(BUNDLE);
  }
  if (OPTS.dryRun) {
    step("build", "Serveur VRA", "skip", "npm install + npm run build (simulation)");
    return true;
  }
  step("deps", "Dépendances du serveur (npm install)", "start");
  const lock = fs.existsSync(path.join(SERVER, "package-lock.json"));
  let code = await runStreaming("npm", [lock ? "ci" : "install", "--no-audit", "--no-fund"], SERVER);
  if (code !== 0 && lock) code = await runStreaming("npm", ["install", "--no-audit", "--no-fund"], SERVER);
  step("deps", "Dépendances du serveur (npm install)", code === 0 ? "ok" : "fail");
  if (code !== 0) return false;
  step("build", "Construction du serveur (npm run build)", "start");
  code = await runStreaming("npm", ["run", "build"], SERVER);
  step("build", "Construction du serveur (npm run build)", code === 0 && fs.existsSync(BUNDLE) ? "ok" : "fail", BUNDLE);
  return code === 0;
}

async function stepTests() {
  if (OPTS.skipTests || OPTS.dryRun) {
    step("tests", "Tests", "skip", OPTS.dryRun ? "simulation" : "--skip-tests");
    return;
  }
  const script = OPTS.fullTests ? "test" : "smoke";
  step("tests", OPTS.fullTests ? "Suite de tests complète" : "Test de bout en bout du serveur", "start");
  const code = await runStreaming("npm", ["run", script], SERVER);
  step("tests", OPTS.fullTests ? "Suite de tests complète" : "Test de bout en bout du serveur", code === 0 ? "ok" : "warn", code === 0 ? undefined : "échec : voir le journal (l'installation continue)");
}

function stepVraHome() {
  const h = vraHome();
  if (!OPTS.dryRun) for (const d of ["profiles", "backups", "downloads", "tools", "projects", "lab"]) fs.mkdirSync(path.join(h, d), { recursive: true });
  step("home", "Dossier des données VRA", "ok", h);
}

function claudeCode(remove) {
  const title = remove ? "Claude Code : désinstallation du plugin" : "Claude Code : plugin VRA (skill, agents, serveur MCP)";
  if (OPTS.dryRun) {
    step("claude", title, "skip", remove ? "claude plugin uninstall vra@vra" : `claude plugin marketplace add "${REPO}" puis claude plugin install vra@vra`);
    return;
  }
  if (remove) {
    run("claude", ["plugin", "uninstall", "vra@vra"]);
    run("claude", ["plugin", "marketplace", "remove", "vra"]);
    step("claude", title, "ok");
    return;
  }
  const list = run("claude", ["plugin", "marketplace", "list"]);
  const known = /(^|\s)vra(\s|$)/m.test(list.out);
  const m = known ? run("claude", ["plugin", "marketplace", "update", "vra"]) : run("claude", ["plugin", "marketplace", "add", REPO]);
  if (m.code !== 0) {
    step("claude", title, "fail", `marketplace : ${m.out.split("\n").slice(-3).join(" ")}`);
    return;
  }
  const installed = run("claude", ["plugin", "list"]);
  const already = /vra@vra/.test(installed.out);
  const r = already ? run("claude", ["plugin", "update", "vra@vra"]) : run("claude", ["plugin", "install", "vra@vra", "--scope", "user"]);
  if (r.code !== 0 && !already) {
    step("claude", title, "fail", r.out.split("\n").slice(-3).join(" "));
    return;
  }
  step("claude", title, "ok", already ? "mis à jour" : "installé pour ton compte (toutes tes sessions Claude Code)");
}

function codex(target, remove) {
  const title = remove ? "Codex : retrait de VRA" : "Codex : serveur MCP + skill vr-ify";
  const cfg = target.config;
  const text = fs.existsSync(cfg) ? fs.readFileSync(cfg, "utf8") : "";
  const res = upsertTomlBlock(text, codexBlock(BUNDLE, MCP_ENV), { remove });
  if (res.conflict) {
    step("codex", title, "warn", `${cfg} contient déjà un [mcp_servers.vra] écrit à la main : laissé tel quel`);
    return;
  }
  const skillLink = path.join(target.skills, "vr-ify");
  if (OPTS.dryRun) {
    step("codex", title, "skip", `${cfg} (bloc VRA) + lien ${skillLink}`);
    return;
  }
  if (res.text !== text) {
    backupFile(cfg);
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, res.text, "utf8");
  }
  let skill;
  if (remove) {
    try {
      if (fs.lstatSync(skillLink).isSymbolicLink()) fs.rmSync(skillLink, { force: true });
      skill = "lien retiré";
    } catch {
      skill = "aucun lien";
    }
  } else skill = linkDir(path.join(REPO, "skills", "vr-ify"), skillLink, false);
  step("codex", title, "ok", `${cfg} ; skill ${skill}`);
}

function jsonClient(id, target, key, entry, remove) {
  const title = `${target.label.split(" (")[0]} : ${remove ? "retrait de VRA" : "serveur MCP vra"}`;
  const r = upsertJsonServer(target.config, key, "vra", entry, { remove, dryRun: OPTS.dryRun });
  if (r.error) step(id, title, "warn", r.error);
  else step(id, title, OPTS.dryRun ? "skip" : "ok", `${target.config}${r.changed ? "" : " (déjà à jour)"}${r.backup ? " — sauvegarde faite" : ""}`);
}

function stepAgents(remove) {
  const targets = agentTargets();
  const chosen = selectAgents(OPTS.agents, targets);
  const absent = Object.keys(targets).filter((k) => !chosen.includes(k));
  if (absent.length && !remove) log(`Clients non configurés (absents ou non choisis) : ${absent.join(", ")}`);
  const stdio = { command: "node", args: [BUNDLE], env: MCP_ENV };
  for (const id of chosen) {
    const t = targets[id];
    try {
      if (id === "claude") {
        if (!which("claude")) step("claude", "Claude Code", "warn", "commande « claude » introuvable : installer Claude Code puis relancer setup");
        else claudeCode(remove);
      } else if (id === "codex") codex(t, remove);
      else if (id === "gemini") {
        // Preferred: link the repo as a Gemini extension (MCP server + AGENTS.md context); fallback: settings.json entry.
        let linked = false;
        if (which("gemini") && !OPTS.dryRun) {
          const r = remove ? run("gemini", ["extensions", "uninstall", "vra"], { timeout: 60000 }) : run("gemini", ["extensions", "link", REPO], { timeout: 60000 });
          linked = r.code === 0;
          if (linked) step(id, `Gemini CLI : ${remove ? "extension retirée" : "extension VRA liée (serveur MCP + AGENTS.md)"}`, "ok");
        }
        if (!linked) jsonClient(id, t, "mcpServers", stdio, remove);
      } else if (id === "antigravity") jsonClient(id, t, "mcpServers", stdio, remove);
      else if (id === "cursor") jsonClient(id, t, "mcpServers", stdio, remove);
      else if (id === "vscode") jsonClient(id, t, "servers", { type: "stdio", ...stdio }, remove);
      else if (id === "claude-desktop") jsonClient(id, t, "mcpServers", stdio, remove);
    } catch (e) {
      step(id, t.label, "fail", e.message);
    }
  }
  return chosen;
}

async function stepMeta() {
  const home = homeDir();
  const dirs = [REPO, path.join(home, "Downloads"), path.join(home, "Téléchargements"), path.join(home, "Desktop"), path.join(home, "OneDrive", "Desktop")];
  const pk = findMetaPackages(dirs);
  // Operator: extract the standalone zip into <VRA_HOME>/tools (the Lab finds it there).
  const toolsDir = path.join(vraHome(), "tools", "meta-xr-operator");
  const existing = fs.existsSync(toolsDir) ? fs.readdirSync(toolsDir).find((v) => fs.existsSync(path.join(toolsDir, v, "windows", "XrApiLayer_METAX_operator.json"))) : null;
  if (existing) step("operator", "Meta XR Operator", "ok", `déjà installé : ${path.join(toolsDir, existing)}`);
  else if (pk.operatorZip) {
    const ver = (/v(\d[\w.]*)\.zip$/i.exec(pk.operatorZip) ?? [])[1] ?? "local";
    const dest = path.join(toolsDir, ver);
    if (OPTS.dryRun) step("operator", "Meta XR Operator", "skip", `serait extrait de ${pk.operatorZip} vers ${dest}`);
    else {
      fs.mkdirSync(dest, { recursive: true });
      const tar = IS_WIN && fs.existsSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")) ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
      const r = run(tar, ["-xf", pk.operatorZip, "-C", dest]);
      // flatten "<dest>/meta-xr-operator-standalone-…/windows" → "<dest>/windows"
      const inner = fs.readdirSync(dest).find((n) => /^meta-xr-operator-standalone/i.test(n));
      if (inner) for (const n of fs.readdirSync(path.join(dest, inner))) fs.renameSync(path.join(dest, inner, n), path.join(dest, n));
      if (inner) fs.rmSync(path.join(dest, inner), { recursive: true, force: true });
      const ok = r.code === 0 && fs.existsSync(path.join(dest, "windows", "XrApiLayer_METAX_operator.json"));
      step("operator", "Meta XR Operator", ok ? "ok" : "fail", ok ? `extrait dans ${dest}` : r.out.slice(0, 200));
    }
  } else if (pk.operatorDir) step("operator", "Meta XR Operator", "ok", `dossier trouvé : ${pk.operatorDir}`);
  else step("operator", "Meta XR Operator", "warn", "zip non trouvé (dossier VR, Téléchargements, Bureau) — télécharger « Meta XR Operator Standalone » puis relancer setup");

  const sim = simulatorInstalled();
  if (sim) step("simulator", "Meta XR Simulator", "ok", `runtime OpenXR enregistré : ${sim}`);
  else if (pk.simulatorMsi) {
    // Never launch an installer silently: explicit option, --yes, or an interactive "oui".
    const go = OPTS.installSimulator || OPTS.yes || (process.stdin.isTTY && !OPTS.json && !OPTS.dryRun ? await ask(`Installer Meta XR Simulator maintenant (${path.basename(pk.simulatorMsi)}) ?`, true) : OPTS.dryRun);
    if (!go) step("simulator", "Meta XR Simulator", "warn", `installeur trouvé mais non lancé : ${pk.simulatorMsi}`);
    else if (OPTS.dryRun) step("simulator", "Meta XR Simulator", "skip", `msiexec /i "${pk.simulatorMsi}" /passive`);
    else {
      step("simulator", "Meta XR Simulator : installation (fenêtre Windows de confirmation possible)", "start");
      const r = run("msiexec.exe", ["/i", pk.simulatorMsi, "/passive", "/norestart"], { shell: false });
      const after = simulatorInstalled();
      step("simulator", "Meta XR Simulator", after ? "ok" : r.code === 0 ? "warn" : "fail", after ? `installé : ${after}` : r.code === 0 ? "installé, mais runtime non trouvé dans le registre : ouvrir Meta XR Simulator une fois puis relancer setup" : `msiexec code ${r.code}`);
    }
  } else step("simulator", "Meta XR Simulator", "warn", "non installé et .msi non trouvé — télécharger « Meta XR Simulator » (Windows) puis relancer setup");
  return pk;
}

function stepAutonomous(remove) {
  const file = claudeSettingsFile();
  if (remove) {
    const r = upsertClaudePermissions(file, AUTONOMOUS_RULES, { remove: true, dryRun: OPTS.dryRun });
    if (r.changed) step("autonomous", "Mode autonome retiré des permissions de Claude Code", OPTS.dryRun ? "skip" : "ok", file);
    return;
  }
  if (!OPTS.autonomous) {
    step("autonomous", "Mode autonome (pilote automatique sans interruption)", "skip", "non coché : Claude Code demandera les permissions (autopilot.cmd n'en a pas besoin)");
    return;
  }
  const r = upsertClaudePermissions(file, AUTONOMOUS_RULES, { dryRun: OPTS.dryRun });
  if (r.error) step("autonomous", "Mode autonome", "warn", r.error);
  else step("autonomous", "Mode autonome : outils VRA, recherche web et lecture autorisés sans question", OPTS.dryRun ? "skip" : "ok", `${file}${r.changed ? "" : " (déjà à jour)"}${r.backup ? " — sauvegarde faite" : ""}`);
}

/** Meta's official CLI (npm package "metavr", repo meta-quest/agentic-tools): controls Meta XR Simulator. */
function stepMetavr() {
  const title = "metavr (CLI officielle de Meta : pilotage du simulateur)";
  const bin = which("metavr");
  if (bin) {
    step("metavr", title, "ok", bin);
    return;
  }
  if (OPTS.dryRun) {
    step("metavr", title, "skip", "npx -y metavr --version");
    return;
  }
  const r = run("npx", ["-y", "metavr", "--version"], { timeout: 600000 });
  step("metavr", title, r.code === 0 ? "ok" : "warn", r.code === 0 ? `prêt via npx (${r.out.split("\n").at(-1)})` : `indisponible pour l'instant (${r.out.split("\n").slice(-2).join(" ")}) : VRA réessaiera via npx`);
}

async function stepOptional() {
  if (IS_WIN) {
    const dn = which("dotnet");
    const sdks = dn ? run("dotnet", ["--list-sdks"]).out : "";
    if (/^\d+\./m.test(sdks)) step("dotnet", "SDK .NET (fabrication des mods Unity)", "ok", sdks.split("\n").at(-1));
    else {
      log("Pour fabriquer les mods VR des jeux Unity, il faut le SDK .NET 8 de Microsoft : sans lui, on ne peut pas transformer le code du mod en fichier utilisable par le jeu. Il vient de Microsoft, gratuitement, via winget.");
      const go = !OPTS.noDotnet && (OPTS.dotnet || OPTS.yes || (process.stdin.isTTY && !OPTS.json && !OPTS.dryRun ? await ask("Installer le SDK .NET 8 maintenant (winget install --id Microsoft.DotNet.SDK.8 --source winget) ?", true) : false));
      if (OPTS.dryRun) step("dotnet", "SDK .NET 8", "skip", "winget install --id Microsoft.DotNet.SDK.8 --source winget");
      else if (!go) step("dotnet", "SDK .NET 8", "warn", "non installé — nécessaire pour les mods Unity (relancer avec --dotnet)");
      else if (!which("winget")) step("dotnet", "SDK .NET 8", "warn", "winget absent : https://dotnet.microsoft.com/download/dotnet/8.0");
      else {
        step("dotnet", "SDK .NET 8 (winget)", "start");
        const r = run("winget", ["install", "--id", "Microsoft.DotNet.SDK.8", "--source", "winget", "-e", "--accept-package-agreements", "--accept-source-agreements"], { timeout: 900000 });
        const ok = r.code === 0 || /already installed|déjà installé/i.test(r.out);
        step("dotnet", "SDK .NET 8", ok ? "ok" : "warn", ok ? "installé (rouvrir le terminal pour qu'il soit visible)" : r.out.split("\n").slice(-3).join(" "));
      }
    }
    const steam = regQuery("HKCU\\Software\\Valve\\Steam").find((x) => x.name === "SteamPath")?.data;
    step("steam", "Steam", steam ? "ok" : "warn", steam ?? "non trouvé");
    if (steam) step("steamvr", "SteamVR", fs.existsSync(path.join(steam, "steamapps", "common", "SteamVR")) ? "ok" : "warn", fs.existsSync(path.join(steam, "steamapps", "common", "SteamVR")) ? undefined : "non installé (utile pour les outils OpenVR)");
    const vd = ["C:\\Program Files\\Virtual Desktop Streamer", "C:\\Program Files (x86)\\Virtual Desktop Streamer"].find((p) => fs.existsSync(p));
    step("vd", "Virtual Desktop Streamer (casque Quest)", vd ? "ok" : "warn", vd ?? "non trouvé — https://www.vrdesktop.net (pour jouer en casque)");
  }
}

async function stepVerify() {
  if (OPTS.dryRun || !fs.existsSync(BUNDLE)) {
    step("verify", "Vérification finale", "skip");
    return;
  }
  try {
    const sdk = path.join(SERVER, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client");
    const { Client } = await import(pathToFileURL(path.join(sdk, "index.js")).href);
    const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, "stdio.js")).href);
    const client = new Client({ name: "vra-setup", version: "1" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BUNDLE], env: { ...process.env, VRA_TOOL_FAMILIES: "all" } }));
    const call = async (name) => JSON.parse((await client.callTool({ name, arguments: {} })).content[0].text);
    const tools = (await client.listTools()).tools.length;
    const machine = await call("lab_machine_check");
    const sim = await call("xr_sim_status");
    await client.close();
    step("verify", "Serveur VRA opérationnel", "ok", `${tools} outils`);
    const gpu = machine.gpus?.map((g) => `${g.name}${g.vramGb ? ` ${g.vramGb} Go` : ""}`).join(", ") || "?";
    step("machine", `Profil du Lab : ${machine.profile}`, machine.profile === "complet" ? "ok" : "warn", gpu);
    step("lab", "Banc d'essai sans casque", sim.pret && sim.pilotage_agent ? "ok" : "warn", sim.pret ? (sim.pilotage_agent ? "simulateur + Operator prêts" : "simulateur prêt, Operator absent (pas de pilotage tête/manettes)") : "simulateur absent");
    report.machine = machine;
    report.lab = { simulator: sim.simulateur, operator: sim.operator };
  } catch (e) {
    step("verify", "Vérification finale", "warn", e.message);
  }
}

/* ───────────────────────── main ───────────────────────── */

export function status() {
  const targets = agentTargets();
  const home = homeDir();
  const pk = findMetaPackages([REPO, path.join(home, "Downloads"), path.join(home, "Téléchargements"), path.join(home, "Desktop"), path.join(home, "OneDrive", "Desktop")]);
  const opDir = path.join(vraHome(), "tools", "meta-xr-operator");
  const operatorInstalled = fs.existsSync(opDir) && fs.readdirSync(opDir).some((v) => fs.existsSync(path.join(opDir, v, "windows", "XrApiLayer_METAX_operator.json")));
  return {
    repo: REPO,
    node: process.versions.node,
    bundle: fs.existsSync(BUNDLE),
    vraHome: vraHome(),
    agents: Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, { label: v.label, present: v.present }])),
    meta: { simulatorInstalled: simulatorInstalled(), simulatorMsi: pk.simulatorMsi, operatorInstalled, operatorZip: pk.operatorZip ?? pk.operatorDir },
    links: {
      simulator: "https://developers.meta.com/horizon/downloads/package/meta-xr-simulator-windows/",
      operator: "https://developers.meta.com/horizon/documentation/unity/meta-xr-operator/connecting-ai-agents/",
      virtualDesktop: "https://www.vrdesktop.net/",
      claudeCode: "https://code.claude.com/docs/en/setup",
      node: "https://nodejs.org/",
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  OPTS = parseArgs(argv);
  if (OPTS.status) {
    process.stdout.write(JSON.stringify(status()) + "\n");
    return 0;
  }
  emit({ type: "start", repo: REPO, dryRun: OPTS.dryRun, uninstall: OPTS.uninstall });
  if (OPTS.uninstall) {
    const chosen = stepAgents(true);
    stepAutonomous(true);
    emit({ type: "summary", text: `VRA retiré de : ${chosen.join(", ") || "aucun client"}. Les sauvegardes sont dans ${path.join(vraHome(), "backups", "_setup")}.` });
    return 0;
  }
  if (!stepPrereqs()) return 1;
  if (!(await stepBuild())) {
    emit({ type: "summary", text: "Échec de la construction du serveur : voir le journal ci-dessus." });
    return 1;
  }
  await stepTests();
  stepVraHome();
  const chosen = stepAgents(false);
  await stepMeta();
  stepMetavr();
  stepAutonomous(false);
  await stepOptional();
  await stepVerify();
  const failed = report.steps.filter((s) => s.status === "fail");
  const warns = report.steps.filter((s) => s.status === "warn");
  report.finishedAt = new Date().toISOString();
  report.agents = chosen;
  if (!OPTS.dryRun) {
    fs.mkdirSync(vraHome(), { recursive: true });
    fs.writeFileSync(path.join(vraHome(), "setup-report.json"), JSON.stringify(report, null, 2), "utf8");
  }
  const lines = OPTS.dryRun ? ["Simulation terminée : rien n'a été modifié. Relance sans --dry-run pour installer.", `Clients IA qui seraient configurés : ${chosen.join(", ") || "aucun"}.`] : [
    failed.length ? `Installation terminée avec ${failed.length} erreur(s) et ${warns.length} point(s) à voir.` : warns.length ? `Installation terminée (${warns.length} point(s) facultatif(s) à voir).` : "Installation terminée : tout est prêt.",
    `Clients IA configurés : ${chosen.join(", ") || "aucun"}.`,
    "Ensuite : ouvre Claude Code (commande « claude ») n'importe où et dis : « Je veux jouer à <jeu> en VR ».",
    "Sans surveillance : autopilot.cmd \"<dossier du jeu>\" (ou le bouton « Pilote automatique » de cette fenêtre).",
  ];
  emit({ type: "summary", text: lines.join("\n"), failed: failed.length, warnings: warns.length });
  return failed.length ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then((code) => process.exit(code), (e) => {
    emit({ type: "step", id: "fatal", title: "Erreur inattendue", status: "fail", detail: e.stack ?? String(e) });
    process.exit(1);
  });
}
