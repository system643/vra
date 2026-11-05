import path from "node:path";
import { profileDir } from "./paths.js";
import { readJson, writeJson } from "./util/fsx.js";

/**
 * Supervised autonomous mode. The user gives ONE authorization for ONE game,
 * with their own words, a scope and an expiry. While it is valid, the tools that
 * normally require confirm=true accept it instead, so the autopilot can run
 * without anyone watching. Every plan is still written to the game journal.
 *
 * Never covered, whatever the grant says: anti-cheat / competitive online games,
 * DRM circumvention, purchases or terms accepted in a game, third-party
 * installers (.exe/.msi) other than Meta XR Simulator when "simulator" is in scope.
 */

export const AUTONOMY_SCOPES = ["install", "deploy", "restore", "build_tools", "null_driver", "operator", "simulator", "processes"] as const;
export type AutonomyScope = (typeof AUTONOMY_SCOPES)[number];

export const DEFAULT_SCOPE: AutonomyScope[] = ["install", "deploy", "restore", "build_tools", "null_driver", "operator", "processes"];

export interface AutonomyGrant {
  gamePath: string;
  quote: string;
  scope: AutonomyScope[];
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
  uses: Array<{ at: string; action: string }>;
}

function file(gamePath: string) {
  return path.join(profileDir(gamePath), "autonomy.json");
}

export function readGrant(gamePath: string): AutonomyGrant | null {
  return readJson<AutonomyGrant | null>(file(gamePath), null);
}

export function grantAutonomy(gamePath: string, opts: { quote: string; scope?: AutonomyScope[]; hours?: number; now?: Date }): AutonomyGrant {
  const quote = opts.quote.trim();
  if (quote.length < 8) throw new Error("L'autorisation doit citer les mots exacts de l'utilisateur (quote).");
  const now = opts.now ?? new Date();
  const hours = Math.min(Math.max(opts.hours ?? 24, 1), 72);
  const g: AutonomyGrant = {
    gamePath: path.resolve(gamePath),
    quote,
    scope: [...new Set(opts.scope?.length ? opts.scope : DEFAULT_SCOPE)],
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + hours * 3600_000).toISOString(),
    uses: [],
  };
  writeJson(file(gamePath), g);
  return g;
}

export function revokeAutonomy(gamePath: string): AutonomyGrant | null {
  const g = readGrant(gamePath);
  if (!g) return null;
  g.revokedAt = new Date().toISOString();
  writeJson(file(gamePath), g);
  return g;
}

export interface AutonomyCheck {
  ok: boolean;
  reason: string;
  grant: AutonomyGrant | null;
}

export function checkAutonomy(gamePath: string | undefined | null, action: AutonomyScope, now = new Date()): AutonomyCheck {
  if (!gamePath) return { ok: false, reason: "aucun jeu précisé", grant: null };
  const g = readGrant(gamePath);
  if (!g) return { ok: false, reason: "aucune autorisation autonome pour ce jeu", grant: null };
  if (path.resolve(g.gamePath).toLowerCase() !== path.resolve(gamePath).toLowerCase()) return { ok: false, reason: "autorisation donnée pour un autre dossier", grant: g };
  if (g.revokedAt) return { ok: false, reason: "autorisation révoquée", grant: g };
  if (new Date(g.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: `autorisation expirée le ${g.expiresAt}`, grant: g };
  if (!g.scope.includes(action)) return { ok: false, reason: `« ${action} » hors du périmètre autorisé (${g.scope.join(", ")})`, grant: g };
  return { ok: true, reason: `autorisation autonome du ${g.grantedAt} : « ${g.quote} »`, grant: g };
}

/**
 * Single consent helper for every tool that writes: explicit confirm=true from
 * the user, or a valid autonomous grant covering this action for this game.
 */
export function requireConsent(gamePath: string | undefined | null, action: AutonomyScope, confirm: boolean | undefined): { ok: boolean; via: "confirm" | "autonomie" | null; reason: string } {
  if (confirm) return { ok: true, via: "confirm", reason: "accord explicite (confirm=true)" };
  const c = checkAutonomy(gamePath, action);
  if (c.ok && c.grant && gamePath) {
    c.grant.uses.push({ at: new Date().toISOString(), action });
    c.grant.uses = c.grant.uses.slice(-500);
    writeJson(file(gamePath), c.grant);
    return { ok: true, via: "autonomie", reason: c.reason };
  }
  return { ok: false, via: null, reason: c.reason };
}

export function autonomyStatus(gamePath: string) {
  const g = readGrant(gamePath);
  const c = checkAutonomy(gamePath, "install");
  return {
    active: !!g && !g.revokedAt && new Date(g.expiresAt).getTime() > Date.now(),
    autorisation: g ? { citation: g.quote, perimetre: g.scope, donnee_le: g.grantedAt, expire_le: g.expiresAt, revoquee_le: g.revokedAt ?? null, utilisations: g.uses.length } : null,
    detail: c.reason,
    toujours_interdit: [
      "jeu avec anti-cheat ou multijoueur compétitif",
      "contournement de DRM",
      "achat, abonnement ou acceptation de conditions dans un jeu",
      "installeur .exe/.msi tiers (sauf Meta XR Simulator si « simulator » est dans le périmètre)",
      "fermer un processus que VRA n'a pas lancé",
    ],
  };
}
