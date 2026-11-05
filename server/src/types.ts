/**
 * Shared types. The central rule borrowed from REA: every claim carries a status
 * (observed / deduced / unknown) and the evidence behind it. An unknown is never
 * treated as "absent" or "compatible".
 */

export type Status = "observed" | "deduced" | "unknown";

export type EvidenceKind =
  | "file"
  | "import"
  | "string"
  | "rule"
  | "metadata"
  | "web"
  | "user"
  | "log"
  | "capture"
  | "reasoning";

export interface Evidence {
  kind: EvidenceKind;
  detail: string;
  path?: string;
  url?: string;
  date?: string;
}

export interface Claim<T = string> {
  value: T | null;
  status: Status;
  evidence: Evidence[];
  note?: string;
}

export function observed<T>(value: T, evidence: Evidence[], note?: string): Claim<T> {
  return { value, status: "observed", evidence, ...(note ? { note } : {}) };
}

export function deduced<T>(value: T, evidence: Evidence[], note?: string): Claim<T> {
  return { value, status: "deduced", evidence, ...(note ? { note } : {}) };
}

export function unknown<T = string>(note: string, evidence: Evidence[] = []): Claim<T> {
  return { value: null, status: "unknown", evidence, note };
}

/** Engine families used everywhere (detection, ladder, references, tool families). */
export const ENGINE_FAMILIES = [
  "unreal",
  "unreal_legacy",
  "unity_mono",
  "unity_il2cpp",
  "re_engine",
  "source1",
  "source2",
  "creation",
  "aaa_proprietary",
  "java",
  "godot",
  "opensource_port",
  "2d",
  "emulator",
  "unknown",
] as const;

export type EngineFamily = (typeof ENGINE_FAMILIES)[number];

export type Level = 0 | 1 | 2 | 3 | 4;

export const LEVEL_NAMES: Record<Level, string> = {
  0: "Écran géant virtuel",
  1: "Profondeur stéréo / 3DOF",
  2: "6DOF par injecteur ou framework",
  3: "Contrôleurs et corps",
  4: "Mod sur mesure",
};
