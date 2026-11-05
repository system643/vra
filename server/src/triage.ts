import fs from "node:fs";
import path from "node:path";
import { detectEngine, type EngineDetection } from "./detect/engine.js";
import { detectGraphics, type GraphicsDetection } from "./detect/graphics.js";
import { detectAntiCheat, type AntiCheatDetection } from "./detect/anticheat.js";
import { detectNativeVr, type NativeVrDetection } from "./detect/nativevr.js";
import { computeCeiling, type LadderInput, type LadderSignals } from "./ladder.js";
import { type Claim, type EngineFamily } from "./types.js";
import { abs, scanGame } from "./detect/scan.js";
import { sha256File, nowIso } from "./util/fsx.js";
import { readState, writeCardFields, writeState } from "./store.js";

export interface Triage {
  engine: EngineDetection;
  graphics: GraphicsDetection;
  anticheat: AntiCheatDetection;
  nativeVr: NativeVrDetection;
  fingerprint: Fingerprint;
}

export interface Fingerprint {
  at: string;
  exe: string | null;
  sha256: string | null;
  size: number | null;
  engine: string | null;
  version: string | null;
  anticheat: string[];
  imports?: string[];
}

export async function fingerprint(gamePath: string, eng?: EngineDetection, ac?: AntiCheatDetection, gfx?: GraphicsDetection): Promise<Fingerprint> {
  const e = eng ?? (await detectEngine(gamePath));
  const scan = scanGame(gamePath);
  const exe = e.mainExe.value;
  let sha: string | null = null;
  let size: number | null = null;
  if (exe) {
    const p = abs(scan, exe);
    try {
      size = fs.statSync(p).size;
      sha = await sha256File(p);
    } catch {
      /* unreadable */
    }
  }
  return {
    at: nowIso(),
    exe,
    sha256: sha,
    size,
    engine: e.engine.value,
    version: e.version.value,
    anticheat: ac?.systems ?? [],
    imports: gfx ? Object.values(gfx.imports).flat() : undefined,
  };
}

export async function runTriage(gamePath: string, writeCard = true): Promise<Triage> {
  scanGame(gamePath, { fresh: true });
  const engine = await detectEngine(gamePath);
  const graphics = detectGraphics(gamePath);
  const anticheat = await detectAntiCheat(gamePath);
  const nativeVr = detectNativeVr(gamePath);
  const fp = await fingerprint(gamePath, engine, anticheat, graphics);
  if (writeCard) {
    const acClaim: Claim<unknown> = { ...anticheat.present, value: anticheat.present.value === true ? anticheat.systems : anticheat.present.value === false ? [] : null };
    writeCardFields(gamePath, {
      engine_family: engine.family,
      engine: engine.engine,
      version: engine.version,
      runtime_variant: engine.runtimeVariant,
      game_identity: engine.gameIdentity,
      main_exe: engine.mainExe,
      architecture: engine.architecture,
      storefront: engine.storefront,
      graphics_apis: graphics.apis,
      graphics_primary: graphics.primary,
      anticheat: acClaim,
      native_vr: nativeVr.possible,
      exe_sha256: fp.sha256 ? { value: fp.sha256, status: "observed", evidence: [{ kind: "file", detail: "SHA-256 de l'exécutable principal", path: fp.exe ?? undefined }] } : { value: null, status: "unknown", evidence: [], note: "exécutable non lu" },
    });
  }
  return { engine, graphics, anticheat, nativeVr, fingerprint: fp };
}

/** Identity hints the ladder understands, derived from detection names. */
export function ladderIdentity(t: Triage): string | null {
  const name = (t.engine.engine.value ?? "").toLowerCase();
  if (t.engine.family.value === "java" && name.includes("minecraft")) return "minecraft";
  if (t.engine.family.value === "java") return "java_other";
  const port = /\((quake\d?|doom3?|heretic_hexen|duke3d|wolf3d)\)/.exec(name);
  if (port) return port[1];
  return t.engine.gameIdentity.value;
}

export function ladderInputFrom(t: Triage, signals?: LadderSignals): LadderInput {
  return {
    family: (t.engine.family.value as EngineFamily | null) ?? null,
    engineVersion: t.engine.version.value,
    gameIdentity: ladderIdentity(t),
    graphicsApis: t.graphics.apis.value,
    antiCheat: t.anticheat.present.value === true ? true : t.anticheat.present.value === false ? false : null,
    nativeVr: t.nativeVr.possible.value === true,
    signals,
  };
}

export function summarizeTriage(t: Triage) {
  const c = computeCeiling(ladderInputFrom(t));
  return {
    jeu: path.basename(t.engine.gamePath),
    moteur: t.engine.engine,
    famille: t.engine.family,
    version: t.engine.version,
    variante: t.engine.runtimeVariant,
    identite: t.engine.gameIdentity,
    executable: t.engine.mainExe,
    architecture: t.engine.architecture,
    lanceur: t.engine.storefront,
    api_graphique: t.graphics.apis,
    anti_cheat: { present: t.anticheat.present, systemes: t.anticheat.systems, bloque_injection: t.anticheat.blocksInjection, notes: t.anticheat.notes },
    vr_native: { possible: t.nativeVr.possible, runtimes: t.nativeVr.runtimes, conseil: t.nativeVr.advice },
    autres_candidats: t.engine.candidates.slice(1, 5).map((x) => `${x.name} (${x.family})`),
    indices_steamdb: t.engine.steamdb.slice(0, 12).map((m) => `${m.section}.${m.name} ← ${m.file}`),
    notes_graphiques: t.graphics.notes,
    plafond_preliminaire: { niveau: c.ceiling, nom: c.ceilingName, inconnus: c.unknowns, blocages: c.blockers, note: "Préliminaire : relancer plan_target après la recherche web (mods existants, anti-cheat en ligne, VR officielle)." },
    scan_tronque: t.engine.scanTruncated,
    alerte_dossier: !t.engine.mainExe.value
      ? "Aucun exécutable trouvé : le dossier semble incomplet ou le jeu n'est pas installé. Vérifier le chemin avant de conclure."
      : null,
    empreinte: t.fingerprint,
  };
}

export async function recordFingerprint(gamePath: string, fp: Fingerprint): Promise<{ changed: boolean; previous: Fingerprint | null }> {
  const st = readState(gamePath);
  const prev = (st.fingerprints.at(-1) as Fingerprint | undefined) ?? null;
  const changed = !!(prev && prev.sha256 && fp.sha256 && prev.sha256 !== fp.sha256);
  if (!prev || changed || prev.sha256 !== fp.sha256) st.fingerprints.push(fp);
  writeState(gamePath, st);
  return { changed, previous: prev };
}
