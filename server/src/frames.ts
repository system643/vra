import { type Luma, crop, decodePngLuma, downsample } from "./util/png.js";

/**
 * Automatic checks on captured VR frames, so Claude can test without a headset:
 * black eye, mono (identical eyes), stereo disparity, vertical misalignment,
 * frozen image, and how the view moved between two captures (head-tracking test).
 * Results are "deduced" evidence: they complement Claude looking at the image itself.
 */

function stats(img: Luma): { mean: number; std: number } {
  let s = 0;
  for (const v of img.data) s += v;
  const mean = s / img.data.length;
  let q = 0;
  for (const v of img.data) q += (v - mean) ** 2;
  return { mean, std: Math.sqrt(q / img.data.length) };
}

/** Mean absolute difference between a and b with b shifted by (dx, dy), over the overlap. */
function mad(a: Luma, b: Luma, dx: number, dy: number): number {
  let s = 0;
  let n = 0;
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) {
    for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
      s += Math.abs(a.data[y * a.width + x] - b.data[(y + dy) * b.width + x + dx]);
      n++;
    }
  }
  return n ? s / n : Infinity;
}

function bestShift(a: Luma, b: Luma, maxDx: number, maxDy: number): { dx: number; dy: number; mad: number; mad0: number } {
  const mad0 = mad(a, b, 0, 0);
  let best = { dx: 0, dy: 0, mad: mad0 };
  for (let dy = -maxDy; dy <= maxDy; dy++) {
    for (let dx = -maxDx; dx <= maxDx; dx++) {
      const m = mad(a, b, dx, dy);
      if (m < best.mad - 1e-6) best = { dx, dy, mad: m };
    }
  }
  return { ...best, mad0 };
}

export interface FrameAnalysis {
  file: string;
  size: { width: number; height: number };
  layout: "side_by_side" | "single";
  eyes?: { left: { mean: number; std: number }; right: { mean: number; std: number } };
  findings: Array<{ check: string; result: "ok" | "problème" | "à vérifier"; detail: string }>;
  note: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function analyzeFrame(file: string, layout: "auto" | "side_by_side" | "single" = "auto"): FrameAnalysis {
  const full = decodePngLuma(file);
  const lay = layout === "auto" ? (full.width / full.height >= 1.9 ? "side_by_side" : "single") : layout;
  const small = downsample(full, lay === "side_by_side" ? 320 : 160);
  const findings: FrameAnalysis["findings"] = [];
  const all = stats(small);
  if (all.mean < 6 && all.std < 4) findings.push({ check: "image", result: "problème", detail: "image presque entièrement noire (jeu pas encore rendu, ou rendu VR absent)" });
  if (lay === "single") {
    findings.push({ check: "stéréo", result: "à vérifier", detail: "capture d'une seule vue : la stéréo ne peut pas être évaluée (capturer la fenêtre côte à côte du simulateur ou du miroir)" });
    return { file, size: { width: full.width, height: full.height }, layout: lay, findings, note: "Résultats déduits ; regarder aussi l'image." };
  }
  const half = Math.floor(small.width / 2);
  const left = crop(small, 0, 0, half, small.height);
  const right = crop(small, half, 0, half, small.height);
  const L = stats(left);
  const R = stats(right);
  for (const [name, s] of [["gauche", L], ["droit", R]] as const) {
    if (s.mean < 6 && s.std < 4) findings.push({ check: `œil ${name}`, result: "problème", detail: `œil ${name} noir (moyenne ${r1(s.mean)})` });
  }
  if (Math.abs(L.mean - R.mean) > 25) findings.push({ check: "luminosité", result: "problème", detail: `écart de luminosité entre les yeux (${r1(L.mean)} vs ${r1(R.mean)}) : effet ou post-traitement appliqué à un seul œil ?` });
  const shift = bestShift(left, right, Math.max(2, Math.round(half * 0.06)), 3);
  if (shift.mad0 < 1.2) {
    findings.push({ check: "stéréo", result: "problème", detail: "les deux yeux sont identiques : rendu mono (pas de profondeur) ou image 2D plaquée" });
  } else {
    findings.push({ check: "stéréo", result: shift.dx !== 0 ? "ok" : "à vérifier", detail: `décalage horizontal le plus probable entre les yeux : ${shift.dx} px (sur ${half} px de large), écart ${r1(shift.mad0)} → ${r1(shift.mad)}` });
  }
  if (shift.dy !== 0 && shift.mad < shift.mad0 * 0.8) findings.push({ check: "alignement vertical", result: "problème", detail: `les yeux semblent décalés verticalement de ${shift.dy} px (source fréquente de fatigue visuelle)` });
  if (!findings.some((f) => f.result === "problème")) findings.push({ check: "global", result: "ok", detail: "aucune anomalie automatique détectée" });
  return {
    file,
    size: { width: full.width, height: full.height },
    layout: lay,
    eyes: { left: { mean: r1(L.mean), std: r1(L.std) }, right: { mean: r1(R.mean), std: r1(R.std) } },
    findings,
    note: "Analyse automatique (statut « déduit ») : la compléter en regardant l'image avec Read (HUD, échelle, artefacts).",
  };
}

export interface FrameComparison {
  before: string;
  after: string;
  changed: boolean;
  meanDifference: number;
  viewShift: { dx: number; dy: number };
  interpretation: string;
}

/** Compare two captures, e.g. before/after a simulated head turn: did the view move, and which way? */
export function compareFrames(before: string, after: string, expect?: "left" | "right" | "up" | "down" | "change" | "same"): FrameComparison & { expectation?: string; expectationMet?: boolean } {
  const a = downsample(decodePngLuma(before), 160);
  const b = downsample(decodePngLuma(after), 160);
  if (a.width !== b.width || a.height !== b.height) throw new Error("Les deux captures n'ont pas la même taille.");
  const s = bestShift(a, b, Math.round(a.width * 0.25), Math.round(a.height * 0.2));
  const changed = s.mad0 > 1.5;
  let interpretation = !changed ? "image inchangée (figée, ou mouvement non pris en compte)" : s.mad < s.mad0 * 0.7 ? `la vue a glissé de ${s.dx} px horizontalement et ${s.dy} px verticalement` : "l'image a changé sans simple glissement (mouvement complexe, animation ou changement de scène)";
  let expectationMet: boolean | undefined;
  if (expect) {
    // Turning the head to the right makes the scene slide left in the image (dx < 0), and vice versa.
    const map = { left: s.dx > 0, right: s.dx < 0, up: s.dy > 0, down: s.dy < 0, change: changed, same: !changed };
    expectationMet = changed || expect === "same" ? map[expect] : false;
    interpretation += expectationMet ? " — conforme au mouvement attendu" : " — NON conforme au mouvement attendu";
  }
  return { before, after, changed, meanDifference: r1(s.mad0), viewShift: { dx: s.dx, dy: s.dy }, interpretation, ...(expect ? { expectation: expect, expectationMet } : {}) };
}
