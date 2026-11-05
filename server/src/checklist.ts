import path from "node:path";
import { profileDir } from "./paths.js";
import { nowIso, readJson, writeJson } from "./util/fsx.js";

/**
 * VR quality checklist — the adaptation of REA's obligation ledger.
 * A point closes only with evidence, and only for the current game build and
 * tool version: proof gathered before an update stays in history but no
 * longer closes the point.
 */

export interface ChecklistPoint {
  id: string;
  label: string;
  minLevel: number;
  proof: string;
  engineHints: string;
}

export const POINTS: ChecklistPoint[] = [
  { id: "stable_start", label: "Démarrage stable", minLevel: 1, proof: "Log sans erreur + 10 min de jeu sans plantage", engineHints: "UEVR : mode de rendu ; BepInEx : LogOutput.log ; REFramework : version du jeu supportée" },
  { id: "stereo_ok", label: "Image stéréo correcte", minLevel: 1, proof: "Capture miroir + confirmation en casque (pas d'image doublée, bons yeux)", engineHints: "geo-11 : convergence ; UEVR : jamais AFR en réglage final" },
  { id: "head_6dof", label: "Suivi de tête 6DOF", minLevel: 2, proof: "Confirmation : se pencher, s'accroupir, regarder derrière soi", engineHints: "Unity : caméra réellement remplacée, pas seulement tournée" },
  { id: "world_scale", label: "Échelle du monde", minLevel: 2, proof: "Confirmation : une porte paraît faire environ 2 m, hauteur des yeux cohérente", engineHints: "UEVR : world scale ; Unity : échelle du parent de caméra ; Godot : XROrigin3D" },
  { id: "screen_effects", label: "Effets d'écran compatibles", minLevel: 2, proof: "Captures sans fantômes, flou ni effets 2D plaqués", engineHints: "Unreal : cvars (TAA, flou de mouvement) ; Unity : post-traitements" },
  { id: "hud_readable", label: "HUD lisible", minLevel: 2, proof: "Capture + confirmation : lisible sans mouvement de tête gênant", engineHints: "Unreal : widgets UMG ; Unity : canvas World Space ; Source : cvars de HUD" },
  { id: "menus_usable", label: "Menus utilisables", minLevel: 2, proof: "Parcours complet d'un menu jusqu'à la sauvegarde", engineHints: "Curseur ou pointeur laser selon l'outil" },
  { id: "cutscenes_ok", label: "Cinématiques supportables", minLevel: 2, proof: "Une cinématique testée en entier", engineHints: "Vidéos → écran virtuel ; temps réel → caméra fixe ou écran" },
  { id: "framerate", label: "Fréquence tenue", minLevel: 2, proof: "Overlay Virtual Desktop : fréquence visée tenue 5 min dans une zone chargée", engineHints: "Unreal : résolution d'écran ; Unity : réglages graphiques du jeu" },
  { id: "comfort", label: "Confort", minLevel: 2, proof: "20 min sans gêne, profil de confort appliqué", engineHints: "Rotation par crans et vignette selon l'outil" },
  { id: "hand_aim", label: "Visée à la main", minLevel: 3, proof: "Confirmation + capture : l'arme suit la main", engineHints: "UEVR : UObjectHook ; Unity : plugin ; RE Engine : jeux avec contrôleurs" },
  { id: "all_actions", label: "Toutes les actions accessibles", minLevel: 3, proof: "Liste des actions du jeu, chacune avec son geste ou bouton", engineHints: "Tous : partir du système d'entrées cartographié" },
  { id: "physical_interactions", label: "Interactions physiques", minLevel: 4, proof: "Vidéo ou confirmation par interaction", engineHints: "Source ports et projets Godot" },
  { id: "restore_tested", label: "Restauration testée", minLevel: 0, proof: "Restauration puis réinstallation réussies", engineHints: "Empreinte de l'outil (installation contrôlée)" },
];

export type PointState = "open" | "closed" | "blocked" | "out_of_scope";
export type EvidenceSource = "casque" | "simulateur" | "autre";

/** Points whose final judgement needs a real headset (a simulator result stays provisional). */
export const HEADSET_ONLY = new Set(["comfort", "framerate", "world_scale"]);

export interface PointRecord {
  id: string;
  state: PointState;
  evidence?: string;
  note?: string;
  at?: string;
  /** Applicability: proof is valid only for this build/tool. */
  exeSha256?: string | null;
  toolVersion?: string | null;
  source?: EvidenceSource;
  history: Array<{ at: string; state: PointState; evidence?: string; exeSha256?: string | null; toolVersion?: string | null; source?: EvidenceSource }>;
}

export interface ChecklistFile {
  targetLevel: number;
  points: Record<string, PointRecord>;
}

function file(gamePath: string): string {
  return path.join(profileDir(gamePath), "checklist.json");
}

export function readChecklist(gamePath: string): ChecklistFile {
  return readJson<ChecklistFile>(file(gamePath), { targetLevel: 0, points: {} });
}

export function initChecklist(gamePath: string, targetLevel: number): ChecklistFile {
  const cur = readChecklist(gamePath);
  cur.targetLevel = targetLevel;
  for (const p of POINTS) {
    if (p.minLevel <= targetLevel && !cur.points[p.id]) cur.points[p.id] = { id: p.id, state: "open", history: [] };
  }
  writeJson(file(gamePath), cur);
  return cur;
}

export function setPoint(gamePath: string, id: string, state: PointState, opts: { evidence?: string; note?: string; exeSha256?: string | null; toolVersion?: string | null; source?: EvidenceSource }): PointRecord {
  if (!POINTS.some((p) => p.id === id)) throw new Error(`Point inconnu : ${id}. Points valides : ${POINTS.map((p) => p.id).join(", ")}`);
  if (state === "closed" && !opts.evidence) throw new Error("Un point ne se ferme qu'avec une preuve (evidence).");
  const cur = readChecklist(gamePath);
  const rec: PointRecord = cur.points[id] ?? { id, state: "open", history: [] };
  rec.state = state;
  rec.evidence = opts.evidence;
  rec.note = opts.note;
  rec.at = nowIso();
  rec.exeSha256 = opts.exeSha256 ?? null;
  rec.toolVersion = opts.toolVersion ?? null;
  rec.source = opts.source ?? "autre";
  rec.history.push({ at: rec.at, state, evidence: opts.evidence, exeSha256: rec.exeSha256, toolVersion: rec.toolVersion, source: rec.source });
  cur.points[id] = rec;
  writeJson(file(gamePath), cur);
  return rec;
}

export interface ChecklistStatus {
  targetLevel: number;
  done: boolean;
  rows: Array<{ id: string; label: string; minLevel: number; state: PointState | "stale" | "provisional"; proofRequired: string; evidence?: string; source?: EvidenceSource; engineHints: string }>;
  summary: { open: number; closed: number; stale: number; provisional: number; blocked: number; out_of_scope: number };
}

export function checklistStatus(gamePath: string, currentExeSha256: string | null, currentToolVersion?: string | null): ChecklistStatus {
  const cur = readChecklist(gamePath);
  const rows: ChecklistStatus["rows"] = [];
  const summary = { open: 0, closed: 0, stale: 0, provisional: 0, blocked: 0, out_of_scope: 0 };
  for (const p of POINTS) {
    if (p.minLevel > cur.targetLevel) continue;
    const r = cur.points[p.id];
    let state: PointState | "stale" | "provisional" = r?.state ?? "open";
    if (state === "closed" && r) {
      const exeChanged = currentExeSha256 && r.exeSha256 && r.exeSha256 !== currentExeSha256;
      const toolChanged = currentToolVersion && r.toolVersion && r.toolVersion !== currentToolVersion;
      if (exeChanged || toolChanged) state = "stale";
      else if (r.source === "simulateur" && HEADSET_ONLY.has(p.id)) state = "provisional";
    }
    summary[state] += 1;
    rows.push({ id: p.id, label: p.label, minLevel: p.minLevel, state, proofRequired: p.proof, evidence: r?.evidence, source: r?.source, engineHints: p.engineHints });
  }
  return { targetLevel: cur.targetLevel, done: summary.open === 0 && summary.stale === 0 && summary.provisional === 0 && rows.length > 0, rows, summary };
}
