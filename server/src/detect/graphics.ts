import path from "node:path";
import { type Claim, type Evidence, deduced, observed, unknown } from "../types.js";
import { abs, findFiles, pickMainExe, scanGame } from "./scan.js";
import { tryReadPe } from "../util/pe.js";

export interface GraphicsDetection {
  apis: Claim<string[]>;
  primary: Claim<string>;
  imports: Record<string, string[]>;
  dx12AgilitySdk: boolean;
  notes: string[];
}

const API_DLLS: Record<string, string> = {
  "d3d9.dll": "dx9",
  "d3d10.dll": "dx10",
  "d3d10_1.dll": "dx10",
  "d3d11.dll": "dx11",
  "d3d12.dll": "dx12",
  "vulkan-1.dll": "vulkan",
  "opengl32.dll": "opengl",
  "ddraw.dll": "ddraw",
  "d3d8.dll": "dx8",
};

const ORDER = ["dx12", "dx11", "vulkan", "dx10", "dx9", "opengl", "dx8", "ddraw"];

export function detectGraphics(gamePath: string): GraphicsDetection {
  const scan = scanGame(gamePath);
  const main = pickMainExe(scan);
  const targets = new Set<string>();
  if (main.exe) targets.add(main.exe);
  for (const f of findFiles(scan, /(?:^|\/)(?:unityplayer|gameassembly|engine|renderer[^/]*|render[^/]*|.*rhi[^/]*)\.dll$/, 12)) targets.add(f);
  if (main.exe) {
    const dir = path.posix.dirname(main.exe);
    for (const f of findFiles(scan, /\.dll$/, 4000)) {
      if (path.posix.dirname(f) === dir && /(?:d3d|dx|vulkan|gl|render)/i.test(path.posix.basename(f))) targets.add(f);
    }
  }
  const imports: Record<string, string[]> = {};
  const found = new Map<string, Evidence[]>();
  for (const rel of targets) {
    const pe = tryReadPe(abs(scan, rel));
    if (!pe) continue;
    imports[rel] = pe.imports.filter((i) => API_DLLS[i] || i === "dxgi.dll" || i.startsWith("d3dcompiler"));
    for (const imp of pe.imports) {
      const api = API_DLLS[imp];
      if (api) {
        if (!found.has(api)) found.set(api, []);
        found.get(api)!.push({ kind: "import", detail: `${rel} importe ${imp}`, path: rel });
      }
    }
  }
  const bundled = findFiles(scan, /(?:^|\/)(?:d3d12\/)?d3d12core\.dll$/, 1);
  const notes: string[] = [];
  if (bundled.length) {
    if (!found.has("dx12")) found.set("dx12", []);
    found.get("dx12")!.push({ kind: "file", detail: "DirectX 12 Agility SDK livré avec le jeu", path: bundled[0] });
  }
  const local = findFiles(scan, /(?:^|\/)(?:d3d11|d3d9|dxgi|dinput8|winhttp|version)\.dll$/, 6);
  if (local.length) notes.push(`DLL proxy déjà présentes à côté du jeu (mod existant ?) : ${local.join(", ")}`);
  const apis = ORDER.filter((a) => found.has(a));
  const evidence = apis.flatMap((a) => found.get(a)!.slice(0, 2));
  const unity = findFiles(scan, /(?:^|\/)unityplayer\.dll$/, 1).length > 0;
  if (unity) {
    notes.push("Unity charge Direct3D dynamiquement : l'import d'OpenGL par UnityPlayer.dll ne dit rien de l'API réellement utilisée.");
    return {
      apis: apis.length ? observed(apis, evidence) : unknown("aucun import graphique statique"),
      primary: deduced("dx11", [{ kind: "reasoning", detail: "Unity sous Windows rend en Direct3D 11 par défaut (DX12 avec -force-d3d12 si le jeu le permet)" }], "à confirmer dans Player.log (ligne « Direct3D: Version: »)"),
      imports,
      dx12AgilitySdk: bundled.length > 0,
      notes,
    };
  }
  notes.push("Beaucoup de moteurs chargent leur API dynamiquement : une absence d'import ne prouve pas l'absence de l'API.");
  if (!apis.length) {
    return { apis: unknown("aucun import graphique statique trouvé"), primary: unknown("API chargée dynamiquement ou exécutable protégé"), imports, dx12AgilitySdk: bundled.length > 0, notes };
  }
  return {
    apis: observed(apis, evidence),
    primary: deduced(apis[0], evidence, "API la plus récente importée ; le jeu peut proposer un choix (-dx11, -dx12, -vulkan)"),
    imports,
    dx12AgilitySdk: bundled.length > 0,
    notes,
  };
}
