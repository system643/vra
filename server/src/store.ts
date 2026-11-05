import fs from "node:fs";
import path from "node:path";
import { appendJsonl, nowIso, readJson, readJsonl, writeJson } from "./util/fsx.js";
import { gameSlug, profileDir, userProfileDir, vraHome } from "./paths.js";
import type { Claim } from "./types.js";

/* ───────────────────────── Game card (fiche du jeu) ───────────────────────── */

export interface GameCard {
  slug: string;
  gamePath: string;
  updatedAt: string;
  fields: Record<string, Claim<unknown>>;
  decisions: Array<{ at: string; decision: string; dependsOn: string[] }>;
}

export function cardFile(gamePath: string): string {
  return path.join(profileDir(gamePath), "fiche.json");
}

export function readCard(gamePath: string): GameCard {
  return readJson<GameCard>(cardFile(gamePath), {
    slug: gameSlug(gamePath),
    gamePath: path.resolve(gamePath),
    updatedAt: nowIso(),
    fields: {},
    decisions: [],
  });
}

export function writeCardFields(gamePath: string, fields: Record<string, Claim<unknown>>, decision?: { decision: string; dependsOn: string[] }): GameCard {
  const card = readCard(gamePath);
  card.gamePath = path.resolve(gamePath);
  for (const [k, v] of Object.entries(fields)) card.fields[k] = v;
  if (decision) card.decisions.push({ at: nowIso(), ...decision });
  card.updatedAt = nowIso();
  writeJson(cardFile(gamePath), card);
  fs.writeFileSync(path.join(profileDir(gamePath), "fiche.md"), renderCardMarkdown(card), "utf8");
  return card;
}

const STATUS_FR: Record<string, string> = { observed: "observé", deduced: "déduit", unknown: "inconnu" };

export function renderCardMarkdown(card: GameCard): string {
  const lines = [`# Fiche VRA — ${card.slug}`, "", `Dossier : \`${card.gamePath}\`  `, `Mise à jour : ${card.updatedAt}`, "", "| Champ | Valeur | Statut | Preuve |", "| --- | --- | --- | --- |"];
  for (const [k, c] of Object.entries(card.fields)) {
    const val = c.value === null || c.value === undefined ? "—" : typeof c.value === "object" ? JSON.stringify(c.value) : String(c.value);
    const proof = c.evidence.map((e) => `${e.detail}${e.path ? ` (\`${e.path}\`)` : ""}${e.url ? ` [lien](${e.url})` : ""}`).join("<br>") || (c.note ?? "");
    lines.push(`| ${k} | ${val.replace(/\|/g, "\\|")} | ${STATUS_FR[c.status] ?? c.status} | ${proof.replace(/\|/g, "\\|")} |`);
  }
  if (card.decisions.length) {
    lines.push("", "## Décisions", "");
    for (const d of card.decisions) lines.push(`- ${d.at} — ${d.decision} (dépend de : ${d.dependsOn.join(", ") || "—"})`);
  }
  return lines.join("\n") + "\n";
}

/* ───────────────────────── Sessions ───────────────────────── */

export type SessionEntryKind = "open" | "action" | "setting" | "result" | "test" | "backup" | "install" | "restore" | "marker" | "note" | "close" | "update_detected";

export interface SessionEntry {
  at: string;
  kind: SessionEntryKind;
  summary: string;
  details?: Record<string, unknown>;
  evidence?: string[];
}

export interface SessionState {
  slug: string;
  gamePath: string;
  fingerprints: Array<{ at: string; exe: string | null; sha256: string | null; size: number | null; engine?: string | null; version?: string | null; anticheat?: string[] }>;
  activeSettings: Record<string, unknown>;
  installs: Array<{ at: string; tool: string; version: string; dest: string; backupId: string | null; added: string[]; replaced: string[] }>;
  backups: Array<{ id: string; at: string; label: string; files: number }>;
  openUnknowns: string[];
  target?: { level: number; ceiling: number; reason?: string } | null;
}

export function sessionFiles(gamePath: string): { journal: string; state: string } {
  const dir = profileDir(gamePath);
  return { journal: path.join(dir, "session.jsonl"), state: path.join(dir, "session-state.json") };
}

export function readState(gamePath: string): SessionState {
  return readJson<SessionState>(sessionFiles(gamePath).state, {
    slug: gameSlug(gamePath),
    gamePath: path.resolve(gamePath),
    fingerprints: [],
    activeSettings: {},
    installs: [],
    backups: [],
    openUnknowns: [],
    target: null,
  });
}

export function writeState(gamePath: string, st: SessionState): void {
  writeJson(sessionFiles(gamePath).state, st);
}

export function logEntry(gamePath: string, e: Omit<SessionEntry, "at">): SessionEntry {
  const entry: SessionEntry = { at: nowIso(), ...e };
  appendJsonl(sessionFiles(gamePath).journal, entry);
  return entry;
}

export function readJournal(gamePath: string): SessionEntry[] {
  return readJsonl<SessionEntry>(sessionFiles(gamePath).journal);
}

/* ───────────────────────── Comfort profile ───────────────────────── */

export interface ComfortProfile {
  position?: "assis" | "debout" | "roomscale";
  input?: "manette" | "controleurs" | "les_deux";
  rotation?: "crans_30" | "crans_45" | "continue";
  motion_sickness?: "faible" | "moyenne" | "forte";
  third_person?: "derriere_personnage" | "diorama_fixe";
  dominant_hand?: "droite" | "gauche";
  height_cm?: number;
  hud_distance?: "proche" | "moyen" | "loin";
  hud_size?: "petit" | "moyen" | "grand";
  cutscenes?: "ecran_virtuel" | "immersif";
  session_minutes?: number;
  notes?: string;
  updatedAt?: string;
}

export function comfortFile(): string {
  return path.join(userProfileDir(), "confort.json");
}

export function readComfort(gamePath?: string): { global: ComfortProfile; perGame: ComfortProfile; effective: ComfortProfile } {
  const global = readJson<ComfortProfile>(comfortFile(), {});
  const perGame = gamePath ? readJson<ComfortProfile>(path.join(profileDir(gamePath), "confort.json"), {}) : {};
  return { global, perGame, effective: { ...global, ...perGame } };
}

export function writeComfort(values: ComfortProfile, gamePath?: string): ComfortProfile {
  const file = gamePath ? path.join(profileDir(gamePath), "confort.json") : comfortFile();
  const cur = readJson<ComfortProfile>(file, {});
  const next = { ...cur, ...values, updatedAt: nowIso() };
  writeJson(file, next);
  return next;
}

/* ───────────────────────── Web facts and freshness ───────────────────────── */

export const FRESHNESS_DAYS: Record<string, number> = {
  anticheat_status: 0, // every session
  nightly_build: 7,
  mod_compatibility: 30,
  stable_release: 30,
  install_paths: 0, // at install time
  community_profile: 30,
  virtual_desktop: 60,
  engine_detected: 36500,
  other: 30,
};

export interface WebFact {
  id: string;
  at: string;
  kind: keyof typeof FRESHNESS_DAYS | string;
  game: string | null;
  statement: string;
  url: string;
  version?: string;
}

function factsFile(): string {
  return path.join(vraHome(), "web-facts.jsonl");
}

export function recordFact(f: Omit<WebFact, "id" | "at">): WebFact {
  const fact: WebFact = { id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, at: nowIso(), ...f };
  appendJsonl(factsFile(), fact);
  return fact;
}

export function checkFacts(filter: { game?: string; kind?: string }, sessionStartedAt?: string): Array<WebFact & { fresh: boolean; ageDays: number; validityDays: number }> {
  const all = readJsonl<WebFact>(factsFile()).filter((f) => (!filter.game || f.game === filter.game) && (!filter.kind || f.kind === filter.kind));
  const now = Date.now();
  return all.map((f) => {
    const validityDays = FRESHNESS_DAYS[f.kind] ?? FRESHNESS_DAYS.other;
    const ageDays = (now - Date.parse(f.at)) / 86_400_000;
    let fresh = ageDays <= validityDays;
    if (validityDays === 0) fresh = sessionStartedAt ? Date.parse(f.at) >= Date.parse(sessionStartedAt) : false;
    return { ...f, fresh, ageDays: Math.round(ageDays * 10) / 10, validityDays };
  });
}
