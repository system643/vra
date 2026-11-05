import { type EngineFamily, type Level, LEVEL_NAMES, type Status } from "./types.js";

/**
 * Feasibility ladder 0→4 and the "always aim for the maximum" principle.
 * The ceiling is the highest level VRA can envisage for the game; the target
 * equals the ceiling unless the user explicitly asks for less, or a safety
 * rule (anti-cheat, competitive multiplayer) forbids it. No silent lowering.
 */

export interface ExistingMod {
  name: string;
  level: Level;
  requires_code?: boolean;
  url?: string;
  verified_on?: string;
  note?: string;
}

export interface LadderSignals {
  existing_mods?: ExistingMod[];
  official_vr?: boolean;
  online_competitive?: boolean;
  anticheat_online?: boolean;
  pck_encrypted?: boolean;
  metadata_unreadable?: boolean;
}

export interface LadderInput {
  family: EngineFamily | null;
  engineVersion?: string | null;
  gameIdentity?: string | null;
  graphicsApis?: string[] | null;
  /** true = anti-cheat observed; false = none found; null = not checked. */
  antiCheat?: boolean | null;
  nativeVr?: boolean | null;
  signals?: LadderSignals;
}

export interface Step {
  level: Level;
  tool: string;
  how: string;
  requiresCode: boolean;
  status: Status;
  note?: string;
}

export interface Ceiling {
  /** Highest level VRA envisages (includes steps still to confirm). The target aims here. */
  ceiling: Level;
  ceilingName: string;
  /** Highest level backed only by observed/deduced steps. */
  confirmedCeiling: Level;
  steps: Step[];
  blockers: string[];
  unknowns: string[];
  higherIf: string[];
  gestureGamepad: string;
}

export interface Contraindications {
  max_level?: Level;
  no_code?: boolean;
  gamepad_only?: boolean;
  visual_only?: boolean;
  /** The user's own words, kept for the record. */
  quote?: string;
}

export interface TargetPlan {
  ceiling: Level;
  confirmedCeiling: Level;
  target: Level;
  /** true when reaching the target depends on unknowns being resolved first. */
  conditional: boolean;
  conditions: string[];
  targetName: string;
  loweredBy: Array<{ origin: "user" | "safety" | "technical"; reason: string }>;
  reminder: string | null;
  staircase: Step[];
  firstPlayableStep: Step | null;
  blockers: string[];
  unknowns: string[];
  higherIf: string[];
  gestureGamepad: string;
}

const VD: Step = { level: 0, tool: "Virtual Desktop (écran géant)", how: "Mode bureau/cinéma de Virtual Desktop, rien n'est modifié", requiresCode: false, status: "observed" };

function geo11(apis: string[] | null | undefined): Step | null {
  if (!apis) return { level: 1, tool: "geo-11", how: "Pilote 3D stéréo DX11 (si le jeu tourne en DX11)", requiresCode: false, status: "unknown", note: "API graphique non établie" };
  if (apis.includes("dx11")) return { level: 1, tool: "geo-11", how: "Pilote 3D stéréo DX11, réglage de convergence", requiresCode: false, status: "deduced" };
  return null;
}

function versionAtLeast(v: string | null | undefined, major: number, minor: number): boolean | null {
  if (!v) return null;
  const m = /^(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > major || (a === major && b >= minor);
}

export function computeCeiling(input: LadderInput): Ceiling {
  const steps: Step[] = [VD];
  const blockers: string[] = [];
  const unknowns: string[] = [];
  const higherIf: string[] = [];
  const s = input.signals ?? {};
  const g = geo11(input.graphicsApis);
  const id = (input.gameIdentity ?? "").toLowerCase();

  switch (input.family) {
    case "unreal": {
      const nightly = versionAtLeast(input.engineVersion, 5, 5);
      const ueOld = input.engineVersion ? !versionAtLeast(input.engineVersion, 4, 8) : false;
      if (ueOld) {
        blockers.push(`Unreal ${input.engineVersion} est antérieur à 4.8 : hors de portée d'UEVR`);
        if (g) steps.push(g);
        break;
      }
      steps.push({
        level: 2,
        tool: nightly ? "UEVR (build nightly)" : "UEVR",
        how: nightly === null ? "Injecteur UEVR ; version d'Unreal inconnue → commencer par la stable, passer en nightly si échec" : nightly ? "Injecteur UEVR, build nightly (UE 5.5+)" : "Injecteur UEVR stable (UE 4.8–5.4)",
        requiresCode: false,
        status: nightly === null ? "deduced" : "observed",
      });
      steps.push({ level: 3, tool: "UEVR UObjectHook", how: "Attacher arme et objets aux mains depuis le menu UEVR, sans code", requiresCode: false, status: "deduced", note: "dépend de la structure du jeu (cartographie)" });
      steps.push({ level: 3, tool: "UEVR scripts Lua", how: "Visée, gestes, UI, cinématiques par script Lua", requiresCode: true, status: "deduced" });
      higherIf.push("Niveau 4 seulement avec un SDK de mod officiel du jeu ou un énorme travail de modding Unreal");
      break;
    }
    case "unreal_legacy":
      if (g) steps.push(g);
      blockers.push("UEVR ne gère pas Unreal Engine 3 et antérieurs");
      steps.push({ level: 2, tool: "Mod VR dédié (à rechercher)", how: "Mod VR propre à ce jeu, s'il existe", requiresCode: false, status: "unknown" });
      higherIf.push("Un mod VR dédié à ce jeu (à rechercher en ligne) ; des gestes vers une manette virtuelle pour les commandes");
      break;
    case "unity_mono":
    case "unity_il2cpp": {
      const il2 = input.family === "unity_il2cpp";
      steps.push({ level: 2, tool: "UUVR (via Rai Pal) ou UnityVRMod", how: il2 ? "Build IL2CPP de UnityVRMod (BepInEx 6) ou UUVR" : "UUVR via Rai Pal, ou UnityVRMod (BepInEx 6)", requiresCode: false, status: "deduced" });
      if (il2 && s.metadata_unreadable) {
        unknowns.push("Métadonnées IL2CPP illisibles : le niveau 3 dépend de leur lecture (outil dédié ou REA)");
        steps.push({ level: 3, tool: "Plugin BepInEx 6 (IL2CPP)", how: "Patchs Harmony via Il2CppInterop", requiresCode: true, status: "unknown" });
      } else {
        steps.push({ level: 3, tool: il2 ? "Plugin BepInEx 6 (IL2CPP)" : "Plugin BepInEx + Harmony", how: "Visée à la main, UI en World Space, gestes, cinématiques", requiresCode: true, status: "deduced" });
      }
      higherIf.push("Niveau 4 (interactions physiques) envisageable en plugin si le jeu expose ses objets proprement");
      break;
    }
    case "re_engine": {
      const ctrl = ["re2", "re3", "re7", "re8"].some((k) => id.startsWith(k));
      steps.push({ level: 2, tool: "REFramework", how: "Mode VR 6DOF générique de REFramework", requiresCode: false, status: "deduced" });
      steps.push(ctrl
        ? { level: 3, tool: "REFramework (contrôleurs natifs)", how: "Contrôles par mouvements intégrés pour RE2, RE3, RE7, RE8", requiresCode: false, status: "observed" }
        : { level: 3, tool: "REFramework scripts Lua", how: "Contrôleurs et UI par script Lua", requiresCode: true, status: "deduced" });
      unknowns.push("Version du jeu supportée par la release REFramework actuelle");
      break;
    }
    case "source1":
      steps.push({ level: 3, tool: "Mod VR communautaire", how: "Rechercher un mod VR existant pour ce jeu Source", requiresCode: false, status: "unknown" });
      steps.push({ level: 4, tool: "Source SDK 2013", how: "Mod VR compilé, si le jeu repose sur le SDK public", requiresCode: true, status: "unknown", note: "possible seulement pour les jeux basés sur le SDK public (HL2 et dérivés)" });
      if (g) steps.push(g);
      unknowns.push("Existence d'un mod VR communautaire ; compatibilité avec le Source SDK public");
      break;
    case "source2":
      blockers.push("Aucun injecteur VR générique connu pour Source 2 ; la plupart des jeux sont en ligne avec VAC");
      higherIf.push("Un mode VR officiel (Half-Life: Alyx est natif VR)");
      break;
    case "creation": {
      if (id === "skyrim_vr" || id === "fallout4_vr") {
        steps.push({ level: 3, tool: "Édition VR officielle + mods VR communautaires", how: "Édition VR déjà installée : enrichir avec des mods VR", requiresCode: false, status: "observed" });
      } else if (id === "skyrim" || id === "fallout4") {
        steps.push({ level: 3, tool: id === "skyrim" ? "Skyrim VR (édition officielle)" : "Fallout 4 VR (édition officielle)", how: "Édition VR officielle (achat séparé) + mods VR communautaires", requiresCode: false, status: "observed", note: "une édition VR officielle passe toujours avant un mod" });
      } else {
        if (g) steps.push(g);
        steps.push({ level: 3, tool: "Mods VR communautaires (à rechercher)", how: "Mods VR existants pour ce jeu Bethesda", requiresCode: false, status: "unknown" });
        unknowns.push("Mods VR communautaires pour ce jeu Bethesda");
      }
      break;
    }
    case "aaa_proprietary":
      if (g) steps.push(g);
      steps.push({ level: 2, tool: "Mod VR dédié (à rechercher)", how: "Mod propre au jeu (ex. R.E.A.L. : 6DOF sans contrôleurs)", requiresCode: false, status: "unknown" });
      steps.push({ level: 3, tool: "Écosystème de modding du jeu (à rechercher)", how: "Extender de scripts ou SDK officiel pour visée à la main et UI", requiresCode: true, status: "unknown" });
      unknowns.push("Mod VR dédié (ex. R.E.A.L. de Luke Ross : 6DOF sans contrôleurs) ; écosystème de modding du jeu");
      higherIf.push("Un mod dédié (niveau 2) ; un extender de scripts du jeu pour ajouter visée et UI (niveau 3)");
      break;
    case "java":
      if (id.includes("minecraft") || input.gameIdentity === null) {
        steps.push({ level: 4, tool: "Vivecraft", how: "Minecraft Java en VR complète (roomscale, interactions)", requiresCode: false, status: input.gameIdentity === null ? "deduced" : "observed", note: "Minecraft Java uniquement" });
      } else blockers.push("Pas d'outil VR générique pour les jeux Java");
      break;
    case "godot":
      if (s.pck_encrypted) {
        blockers.push("PCK chiffré : la clé du jeu est nécessaire pour récupérer le projet");
        unknowns.push("Clé de chiffrement du PCK");
      }
      steps.push({ level: 4, tool: "Projet Godot récupéré + nœuds XR", how: "GDRE Tools, puis XROrigin3D/XRCamera3D/XRController3D et export à côté de l'original", requiresCode: true, status: s.pck_encrypted ? "unknown" : "deduced" });
      break;
    case "opensource_port":
      steps.push({ level: 4, tool: id.includes("quake") || id === "" ? "Source port VR (ex. Quake VR)" : "Source port VR", how: "Port VR installé à côté du jeu acheté, données du jeu réutilisées", requiresCode: false, status: "deduced", note: "vérifier le port VR maintenu pour ce jeu" });
      break;
    case "2d":
      blockers.push("Jeu 2D : pas de scène 3D à extraire");
      break;
    case "emulator":
      if (g) steps.push(g);
      steps.push({ level: 2, tool: "Fork VR de l'émulateur (à rechercher)", how: "Version VR de l'émulateur, si elle existe pour cette console", requiresCode: false, status: "unknown" });
      unknowns.push("Forks VR de l'émulateur ; API de rendu choisie dans l'émulateur");
      break;
    default:
      if (g) steps.push(g);
      steps.push({ level: 2, tool: "Mod VR dédié (à rechercher)", how: "Mod propre au jeu, s'il existe", requiresCode: false, status: "unknown" });
      unknowns.push("Moteur non identifié : chercher le jeu en ligne (PCGamingWiki, SteamDB)");
  }

  if (input.nativeVr) {
    steps.push({ level: 3, tool: "Mode VR officiel (à confirmer)", how: "Bibliothèque VR livrée avec le jeu : vérifier un mode VR officiel", requiresCode: false, status: s.official_vr ? "observed" : "unknown" });
    if (!s.official_vr) unknowns.push("Mode VR officiel : une bibliothèque VR est livrée, son usage n'est pas confirmé");
  } else if (s.official_vr) {
    steps.push({ level: 3, tool: "Mode VR officiel", how: "Mode VR officiel confirmé en ligne", requiresCode: false, status: "observed" });
  }
  for (const m of s.existing_mods ?? []) {
    steps.push({ level: m.level, tool: m.name, how: m.note ?? "Mod existant trouvé en ligne", requiresCode: !!m.requires_code, status: "observed", note: m.url ? `source : ${m.url}${m.verified_on ? ` (vérifié le ${m.verified_on})` : ""}` : undefined });
    if (m.level === 2) higherIf.push(`« ${m.name} » s'arrête au visuel : chercher une voie plus haute (injecteur du moteur, modding du jeu, gestes vers manette virtuelle)`);
  }

  const maxOf = (list: Step[]) => list.reduce<Level>((mx, st) => (st.level > mx ? st.level : mx), 0);
  const confirmedCeiling = maxOf(steps.filter((st) => st.status !== "unknown"));
  const ceiling = maxOf(steps);
  return {
    ceiling,
    ceilingName: LEVEL_NAMES[ceiling],
    confirmedCeiling,
    steps: steps.sort((a, b) => a.level - b.level),
    blockers,
    unknowns,
    higherIf,
    gestureGamepad:
      "Voie de secours pour dépasser le visuel : traduire gestes et boutons des contrôleurs en manette virtuelle (nécessite un pilote de manette virtuelle ; expérimental, à valider jeu par jeu).",
  };
}

export function planTarget(c: Ceiling, input: LadderInput, contra: Contraindications = {}): TargetPlan {
  const lowered: TargetPlan["loweredBy"] = [];
  let target: Level = c.ceiling;
  const s = input.signals ?? {};
  if (input.antiCheat === true || s.anticheat_online || s.online_competitive) {
    target = 0;
    lowered.push({ origin: "safety", reason: input.antiCheat === true ? "anti-cheat détecté : aucune injection" : s.online_competitive ? "multijoueur compétitif" : "anti-cheat en ligne signalé" });
  } else {
    if (contra.max_level !== undefined && contra.max_level < target) {
      target = contra.max_level;
      lowered.push({ origin: "user", reason: `niveau maximum demandé : ${contra.max_level}` });
    }
    if (contra.visual_only && target > 2) {
      target = 2;
      lowered.push({ origin: "user", reason: "« le visuel me suffit »" });
    }
    if (contra.gamepad_only && target > 2) {
      target = 2;
      lowered.push({ origin: "user", reason: "« juste à la manette » (UI et confort restent traités)" });
    }
    if (contra.no_code) {
      const noCode = c.steps.filter((st) => !st.requiresCode);
      const best = noCode.reduce<Level>((mx, st) => (st.level > mx ? st.level : mx), 0);
      if (best < target) {
        target = best;
        lowered.push({ origin: "user", reason: "« pas de code » : seulement les outils et mods existants" });
      }
    }
  }
  if (c.blockers.length && c.ceiling === 0 && target === 0 && !lowered.length) {
    lowered.push({ origin: "technical", reason: c.blockers.join(" ; ") });
  }
  const usable = c.steps.filter((st) => st.level <= target && !(contra.no_code && st.requiresCode));
  const byLevel = new Map<number, Step>();
  for (const st of usable) {
    const prev = byLevel.get(st.level);
    const rank = (x: Step) => (x.status === "unknown" ? 0 : 2) + (x.requiresCode ? 0 : 1);
    if (!prev || rank(st) > rank(prev)) byLevel.set(st.level, st);
  }
  const staircase = [...byLevel.values()].sort((a, b) => a.level - b.level);
  const firstPlayableStep = staircase.find((st) => st.level >= 2 && st.status !== "unknown") ?? [...staircase].reverse().find((st) => st.status !== "unknown") ?? null;
  const conditional = target > c.confirmedCeiling;
  const conditions = conditional ? staircase.filter((st) => st.status === "unknown" && st.level > c.confirmedCeiling).map((st) => `${st.tool} — ${st.how}`) : [];
  const reminder = target < c.ceiling ? `Maximum possible pour ce jeu : niveau ${c.ceiling} (${LEVEL_NAMES[c.ceiling]}).` : null;
  return {
    ceiling: c.ceiling,
    confirmedCeiling: c.confirmedCeiling,
    target,
    conditional,
    conditions,
    targetName: LEVEL_NAMES[target],
    loweredBy: lowered,
    reminder,
    staircase,
    firstPlayableStep,
    blockers: c.blockers,
    unknowns: c.unknowns,
    higherIf: c.higherIf,
    gestureGamepad: c.gestureGamepad,
  };
}
