import { type Claim, type Evidence, deduced, unknown } from "../types.js";
import { findFiles, scanGame } from "./scan.js";

export interface NativeVrDetection {
  possible: Claim<boolean>;
  runtimes: string[];
  evidence: Evidence[];
  advice: string;
}

const RULES: Array<[RegExp, string]> = [
  [/(?:^|\/)openvr_api\.dll$/, "OpenVR (SteamVR)"],
  [/(?:^|\/)openxr_loader\.dll$/, "OpenXR"],
  [/(?:^|\/)unityopenxr\.dll$/, "OpenXR (plugin Unity)"],
  [/(?:^|\/)xrsdkopenvr\.dll$/, "OpenVR (plugin Unity)"],
  [/(?:^|\/)ovrplugin\.dll$/, "Oculus (plugin Unity/Unreal)"],
  [/(?:^|\/)libovrrt\d*_\d+\.dll$/, "Oculus runtime"],
  [/\/plugins\/runtime\/(?:openxr|oculusvr|steamvr)\//, "Plugin XR Unreal"],
  [/(?:^|\/)(?:skyrimvr|fallout4vr)\.exe$/, "Édition VR officielle Bethesda"],
];

/** A VR runtime library in the folder suggests an official VR mode: check it before any mod. */
export function detectNativeVr(gamePath: string): NativeVrDetection {
  const scan = scanGame(gamePath);
  const evidence: Evidence[] = [];
  const runtimes = new Set<string>();
  for (const [re, name] of RULES) {
    const hits = findFiles(scan, re, 1);
    if (hits.length) {
      runtimes.add(name);
      evidence.push({ kind: "file", detail: `${name}`, path: hits[0] });
    }
  }
  if (!runtimes.size) {
    return { possible: unknown("aucune bibliothèque VR trouvée (le jeu peut quand même avoir un mode VR distribué à part)"), runtimes: [], evidence, advice: "Vérifier en ligne s'il existe une édition ou un mode VR officiel." };
  }
  return {
    possible: deduced(true, evidence, "une bibliothèque VR est livrée : un mode VR officiel est possible, ou la bibliothèque sert à autre chose"),
    runtimes: [...runtimes],
    evidence,
    advice: "Chercher un mode VR officiel (option de lancement, menu, page Steam) AVANT tout mod : il passe toujours en premier.",
  };
}
