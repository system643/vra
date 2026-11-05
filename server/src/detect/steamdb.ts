import fs from "node:fs";
import path from "node:path";
import { bundledDataDir, cacheDir } from "../paths.js";

/**
 * SteamDB FileDetectionRuleSets (MIT) — regexes over file paths that guess
 * engines, anti-cheats and SDKs. SteamDB itself calls these "guesses", so a
 * match is reported as a deduced clue, never as a fact.
 * https://github.com/SteamDatabase/FileDetectionRuleSets
 */

export interface SteamDbRule {
  section: string;
  name: string;
  regex: RegExp;
  source: string;
}

export interface SteamDbMatch {
  section: string;
  name: string;
  file: string;
}

let cached: { file: string; mtime: number; rules: SteamDbRule[] } | null = null;

export function rulesFile(): string {
  const updated = path.join(cacheDir(), "steamdb-rules.ini");
  if (fs.existsSync(updated)) return updated;
  return path.join(bundledDataDir(), "steamdb-rules.ini");
}

/** Convert PCRE-only syntax used by the rule set into JavaScript regex syntax. */
export function pcreToJs(src: string): string {
  return src
    .replace(/\(\?>/g, "(?:") // atomic group → non-capturing group
    .replace(/(?<!\\)([*+?}])\+/g, "$1"); // possessive quantifiers → greedy
}

export function parseRules(text: string): SteamDbRule[] {
  const rules: SteamDbRule[] = [];
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1];
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0 || !section) continue;
    const name = line.slice(0, eq).trim().replace(/\[\]$/, "");
    let value = line.slice(eq + 1).trim();
    const comment = value.search(/\s;\s/);
    if (comment >= 0) value = value.slice(0, comment).trim();
    try {
      rules.push({ section, name, regex: new RegExp(pcreToJs(value), "i"), source: value });
    } catch {
      /* a rule JS cannot compile is skipped, not fatal */
    }
  }
  return rules;
}

export function loadRules(): SteamDbRule[] {
  const file = rulesFile();
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return [];
  }
  if (cached && cached.file === file && cached.mtime === mtime) return cached.rules;
  const rules = parseRules(fs.readFileSync(file, "utf8"));
  cached = { file, mtime, rules };
  return rules;
}

/** Match every relative POSIX path against the rule set (first matching file per rule). */
export function matchRules(files: string[], sections?: string[]): SteamDbMatch[] {
  const rules = loadRules().filter((r) => !sections || sections.includes(r.section));
  const seen = new Set<string>();
  const out: SteamDbMatch[] = [];
  for (const rule of rules) {
    const key = `${rule.section}.${rule.name}`;
    if (seen.has(key)) continue;
    for (const f of files) {
      if (rule.regex.test(f)) {
        seen.add(key);
        out.push({ section: rule.section, name: rule.name, file: f });
        break;
      }
    }
  }
  return out;
}

export async function updateRules(): Promise<{ file: string; rules: number; source: string }> {
  const urls = [
    "https://raw.githubusercontent.com/SteamDatabase/FileDetectionRuleSets/master/rules.ini",
    "https://raw.githubusercontent.com/SteamDatabase/FileDetectionRuleSets/main/rules.ini",
  ];
  let lastErr = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "vra-mcp-server" } });
      if (!res.ok) {
        lastErr = `${url}: HTTP ${res.status}`;
        continue;
      }
      const text = await res.text();
      const rules = parseRules(text);
      if (rules.length < 50) {
        lastErr = `${url}: contenu inattendu (${rules.length} règles)`;
        continue;
      }
      const file = path.join(cacheDir(), "steamdb-rules.ini");
      fs.writeFileSync(file, text, "utf8");
      cached = null;
      return { file, rules: rules.length, source: url };
    } catch (e) {
      lastErr = `${url}: ${(e as Error).message}`;
    }
  }
  throw new Error(`Mise à jour des règles SteamDB impossible : ${lastErr}`);
}
