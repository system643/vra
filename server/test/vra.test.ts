import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-ignore — shared fixtures (plain ESM)
import { FIXTURES, writeFixture, buildPe, buildPck } from "../../evals/fixtures/fixtures.mjs";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vra-home-"));
process.env.VRA_HOME = HOME;
const GAMES = fs.mkdtempSync(path.join(os.tmpdir(), "vra-games-"));

const { runTriage, ladderInputFrom, recordFingerprint, fingerprint } = await import("../src/triage.js");
const { computeCeiling, planTarget } = await import("../src/ladder.js");
const { readPck } = await import("../src/map/godot.js");
const { mapGame } = await import("../src/map/index.js");
const { readPe } = await import("../src/util/pe.js");
const { readAssembly } = await import("../src/map/dotnet.js");
const { parseRules, pcreToJs, loadRules } = await import("../src/detect/steamdb.js");
const { createBackup, restoreBackup } = await import("../src/backup.js");
const { initChecklist, setPoint, checklistStatus } = await import("../src/checklist.js");
const { upsertIni, scaffoldUevr, scaffoldUnity, scaffoldReframework } = await import("../src/scaffold/index.js");
const { writeComfort, readComfort, recordFact, checkFacts } = await import("../src/store.js");
const { safeEntries: safeEntriesForTest } = await import("../src/install.js");

type Fx = (typeof FIXTURES)[number];
const dirs = new Map<string, string>();

beforeAll(async () => {
  for (const fx of FIXTURES as Fx[]) {
    const d = path.join(GAMES, fx.id);
    await writeFixture(fx, d);
    dirs.set(fx.id, d);
  }
});

describe("détection et principe du maximum sur les 24 faux jeux", () => {
  for (const fx of FIXTURES as Fx[]) {
    it(`${fx.id} — ${fx.title}`, async () => {
      const gp = dirs.get(fx.id)!;
      const t = await runTriage(gp, true);
      const e = fx.expect as Record<string, unknown>;
      if ("family" in e) expect(t.engine.family.value).toBe(e.family);
      if (e.version) expect(t.engine.version.value).toBe(e.version);
      if (e.identity) expect(t.engine.gameIdentity.value).toBe(e.identity);
      if (e.storefront) expect(t.engine.storefront.value).toBe(e.storefront);
      if (e.variant) expect(t.engine.runtimeVariant.value).toBe(e.variant);
      if (e.nativeVr) expect(t.nativeVr.possible.value).toBe(true);
      expect(t.anticheat.blocksInjection).toBe(!!e.blocked);
      const input = ladderInputFrom(t, fx.signals);
      const c = computeCeiling(input);
      const plan = planTarget(c, input, fx.contra ?? {});
      if (e.ceiling !== undefined) expect(c.ceiling).toBe(e.ceiling);
      if (e.confirmedCeiling !== undefined) expect(c.confirmedCeiling).toBe(e.confirmedCeiling);
      if (e.target !== undefined) expect(plan.target).toBe(e.target);
      if (e.nightly) expect(c.steps.some((s) => /nightly/i.test(s.tool))).toBe(true);
      // No silent lowering: whenever target < ceiling, a reason and a reminder exist.
      if (plan.target < plan.ceiling) {
        expect(plan.loweredBy.length).toBeGreaterThan(0);
        expect(plan.reminder).toMatch(/Maximum possible/);
      }
      if (e.blocked) expect(plan.loweredBy[0].origin).toBe("safety");
    });
  }

  it("le profil de confort n'abaisse jamais la cible", async () => {
    const gp = dirs.get("ue53-profile-gamepad")!;
    writeComfort({ input: "manette" }, gp);
    expect(readComfort(gp).effective.input).toBe("manette");
    const t = await runTriage(gp, false);
    const input = ladderInputFrom(t);
    const plan = planTarget(computeCeiling(input), input, {});
    expect(plan.target).toBe(3);
    expect(plan.loweredBy).toHaveLength(0);
  });

  it("« pas de code » garde les paliers sans code, dont UObjectHook", async () => {
    const t = await runTriage(dirs.get("ue53-solo")!, false);
    const input = ladderInputFrom(t);
    const plan = planTarget(computeCeiling(input), input, { no_code: true });
    expect(plan.target).toBe(3);
    expect(plan.staircase.every((s) => !s.requiresCode)).toBe(true);
  });

  it("un mod R.E.A.L. est un palier : on cherche plus haut", async () => {
    const fx = (FIXTURES as Fx[]).find((f) => f.id === "aaa-real-only")!;
    const t = await runTriage(dirs.get(fx.id)!, false);
    const c = computeCeiling(ladderInputFrom(t, fx.signals));
    expect(c.higherIf.join(" ")).toMatch(/visuel/);
    const plan = planTarget(c, ladderInputFrom(t, fx.signals), {});
    expect(plan.conditional).toBe(true);
    expect(plan.firstPlayableStep?.tool).toMatch(/R\.E\.A\.L/);
  });

  it("une mise à jour du jeu est détectée (hash de l'exe)", async () => {
    const fx = (FIXTURES as Fx[]).find((f) => f.id === "game-updated")!;
    const gp = dirs.get(fx.id)!;
    expect((await recordFingerprint(gp, await fingerprint(gp))).changed).toBe(false);
    for (const [rel, content] of Object.entries(fx.updateAfterOpen as Record<string, Buffer>)) fs.writeFileSync(path.join(gp, ...rel.split("/")), content);
    expect((await recordFingerprint(gp, await fingerprint(gp))).changed).toBe(true);
  });
});

describe("lecteurs de fichiers", () => {
  it("PE : imports lus", () => {
    const f = path.join(GAMES, "pe.exe");
    fs.writeFileSync(f, buildPe(["d3d11.dll", "dxgi.dll"]));
    const pe = readPe(f);
    expect(pe.machine).toBe("x64");
    expect(pe.imports).toEqual(["d3d11.dll", "dxgi.dll"]);
  });

  it("PCK Godot : version et chemins, standalone et intégré à un exe", () => {
    const pck = buildPck(["res://a.tscn", "res://b.gd"], [4, 3, 0]);
    const f = path.join(GAMES, "t.pck");
    fs.writeFileSync(f, pck);
    const info = readPck(f)!;
    expect(info.godotVersion).toBe("4.3.0");
    expect(info.paths).toEqual(["res://a.tscn", "res://b.gd"]);
    const size = Buffer.alloc(8);
    size.writeBigUInt64LE(BigInt(pck.length));
    const exe = path.join(GAMES, "embedded.exe");
    fs.writeFileSync(exe, Buffer.concat([Buffer.from("MZ" + "x".repeat(500)), pck, size, Buffer.from("GDPC", "latin1")]));
    const emb = readPck(exe)!;
    expect(emb.embedded).toBe(true);
    expect(emb.paths).toHaveLength(2);
  });

  it("cartographie Godot : scènes classées par catégorie", async () => {
    const m = await mapGame(dirs.get("godot")!, "godot");
    expect(m.categories.player.map((c) => c.name)).toContain("res://scenes/player.tscn");
    expect(m.categories.camera.map((c) => c.name)).toContain("res://scripts/player_camera.gd");
    expect(m.categories.hud_menus.map((c) => c.name)).toContain("res://ui/hud.tscn");
  });

  it("IL2CPP : métadonnées illisibles signalées", async () => {
    const m = await mapGame(dirs.get("unity-il2cpp-badmeta")!, "unity_il2cpp");
    expect(m.extra.metadataReadable).toBe(false);
  });

  const realDotNet = ["C:/Windows/Microsoft.NET/Framework64/v4.0.30319/System.Xml.dll", "C:/Windows/Microsoft.NET/Framework/v4.0.30319/System.Xml.dll"].find((p) => fs.existsSync(p));
  it.skipIf(!realDotNet)("métadonnées .NET : types, bases et méthodes d'une vraie assembly", () => {
    const asm = readAssembly(realDotNet!);
    expect(asm.types.length).toBeGreaterThan(100);
    const doc = asm.types.find((t) => t.namespace === "System.Xml" && t.name === "XmlDocument");
    expect(doc).toBeTruthy();
    expect(doc!.baseType).toBe("System.Xml.XmlNode");
    expect(doc!.methods).toContain("Load");
  });

  it("règles SteamDB : syntaxe PCRE convertie, règles chargées", () => {
    expect(pcreToJs("(?>a|b)\\w++x*+")).toBe("(?:a|b)\\w+x*");
    expect(parseRules("[Engine]\nFoo[] = (?:^|/)foo\\.dll$ ; note\n").length).toBe(1);
    expect(loadRules().length).toBeGreaterThan(200);
  });
});

describe("sauvegarde, checklist, générateurs", () => {
  it("sauvegarde puis restauration : fichiers remis, fichiers ajoutés supprimés", async () => {
    const gp = path.join(GAMES, "backup-game");
    fs.mkdirSync(gp, { recursive: true });
    fs.writeFileSync(path.join(gp, "dinput8.dll"), "original");
    const m = await createBackup(gp, gp, ["dinput8.dll", "reframework/autorun/x.lua"], "test");
    fs.writeFileSync(path.join(gp, "dinput8.dll"), "modded");
    fs.mkdirSync(path.join(gp, "reframework/autorun"), { recursive: true });
    fs.writeFileSync(path.join(gp, "reframework/autorun/x.lua"), "--");
    const dry = await restoreBackup(gp, m.id, true);
    expect(fs.readFileSync(path.join(gp, "dinput8.dll"), "utf8")).toBe("modded");
    expect(dry.deleted).toEqual(["reframework/autorun/x.lua"]);
    const r = await restoreBackup(gp, m.id, false);
    expect(r.verified).toEqual(["dinput8.dll"]);
    expect(fs.readFileSync(path.join(gp, "dinput8.dll"), "utf8")).toBe("original");
    expect(fs.existsSync(path.join(gp, "reframework"))).toBe(false);
  });

  it("checklist : preuve obligatoire, périmée après mise à jour", () => {
    const gp = dirs.get("unity-mono")!;
    initChecklist(gp, 2);
    expect(() => setPoint(gp, "stable_start", "closed", {})).toThrow(/preuve/);
    setPoint(gp, "stable_start", "closed", { evidence: "LogOutput.log propre, 10 min", exeSha256: "aaa" });
    expect(checklistStatus(gp, "aaa").rows.find((r) => r.id === "stable_start")!.state).toBe("closed");
    expect(checklistStatus(gp, "bbb").rows.find((r) => r.id === "stable_start")!.state).toBe("stale");
    expect(checklistStatus(gp, "aaa").rows.some((r) => r.id === "hand_aim")).toBe(false);
  });

  it("project.godot : clés ajoutées sans casser l'existant", () => {
    const src = '[application]\n\nconfig/name="X"\n\n[xr]\n\nopenxr/enabled=false\n';
    const out = upsertIni(upsertIni(upsertIni(src, "xr", "openxr/enabled", "true"), "xr", "shaders/enabled", "true"), "autoload", "VraXR", '"*res://a.gd"');
    expect(out).toContain("openxr/enabled=true");
    expect(out).not.toContain("openxr/enabled=false");
    expect(out).toContain("shaders/enabled=true");
    expect(out).toMatch(/\[autoload\]\s+VraXR="\*res:\/\/a\.gd"/);
    expect(out).toContain('config/name="X"');
  });

  it("générateurs : rien n'est déployé sans confirm", async () => {
    const gp = dirs.get("ue53-solo")!;
    const r = await scaffoldUevr({ gamePath: gp, exeStem: "Game-Win64-Shipping", classes: ["/Script/Game.GamePlayerCameraManager"], comfort: { rotation: "crans_30" }, deploy: true, confirm: false });
    expect(r.deployed).toBe(false);
    const lua = fs.readFileSync(r.files[0], "utf8");
    expect(lua).toContain("snap_turn = true");
    expect(lua).toContain("on_xinput_get_state");
    const u = await scaffoldUnity({ gamePath: dirs.get("unity-mono")!, exeDir: dirs.get("unity-mono")!, runtime: "mono", classes: [{ name: "Game.PlayerCamera", hooks: ["LateUpdate"] }], comfort: {} });
    const cs = fs.readFileSync(u.files[0], "utf8");
    expect(cs).toContain('AccessTools.TypeByName("Game.PlayerCamera")');
    expect(fs.readFileSync(u.files[1], "utf8")).toContain("Game_Data");
    const rf = await scaffoldReframework({ gamePath: dirs.get("re-engine")!, exeDir: dirs.get("re-engine")!, types: ["app.Player"], deploy: true, confirm: false });
    expect(rf.deployed).toBe(false);
    expect(fs.existsSync(path.join(dirs.get("re-engine")!, "reframework"))).toBe(false);
  });

  it("faits web : périmés selon leur type", () => {
    recordFact({ kind: "nightly_build", statement: "UEVR nightly 1143", url: "https://github.com/praydog/UEVR-nightly", game: "x" });
    const f = checkFacts({ game: "x" })[0];
    expect(f.fresh).toBe(true);
    expect(f.validityDays).toBe(7);
    const ac = recordFact({ kind: "anticheat_status", statement: "aucun", url: "https://example.org", game: "y" });
    expect(checkFacts({ game: "y" }, new Date(Date.parse(ac.at) + 1000).toISOString())[0].fresh).toBe(false);
  });

  it("archives : chemins dangereux refusés", () => {
    expect(safeEntriesForTest(["ok/a.dll", "../evil.dll", "C:/x.dll", "/abs"]).problems).toHaveLength(3);
  });
});

describe("choix automatique d'archive", () => {
  it("UnityVRMod, UnityExplorer, REFramework, Rai Pal", async () => {
    const { autoPick } = await import("../src/install.js");
    const uvm = ["UnityVRMod-v0.1.0-beta-OpenVR-IL2CPP.zip", "UnityVRMod-v0.1.0-beta-OpenVR-Mono.zip", "UnityVRMod-v0.1.0-beta-OpenXR-IL2CPP.zip", "UnityVRMod-v0.1.0-beta-OpenXR-Mono.zip"];
    expect(autoPick("unityvrmod", uvm, { runtime: "mono" })).toBe("UnityVRMod-v0.1.0-beta-OpenXR-Mono.zip");
    expect(autoPick("unityvrmod", uvm, { runtime: "il2cpp", backend: "openvr" })).toBe("UnityVRMod-v0.1.0-beta-OpenVR-IL2CPP.zip");
    const ue = ["UnityExplorer.BepInEx.IL2CPP.CoreCLR.zip", "UnityExplorer.BepInEx.IL2CPP.zip", "UnityExplorer.BepInEx.Unity.IL2CPP.CoreCLR.zip", "UnityExplorer.BepInEx5.Mono.zip", "UnityExplorer.BepInEx6.Mono.zip", "UnityExplorer.BepInEx6.Unity.Mono.zip"];
    expect(autoPick("unityexplorer", ue, { runtime: "mono" })).toBe("UnityExplorer.BepInEx6.Unity.Mono.zip");
    expect(autoPick("unityexplorer", ue, { runtime: "il2cpp" })).toBe("UnityExplorer.BepInEx.Unity.IL2CPP.CoreCLR.zip");
    expect(autoPick("reframework", ["DD2.zip", "RE2.zip", "RE2_TDB66.zip", "RE3.zip"], { identity: "re2" })).toBe("RE2.zip");
    expect(autoPick("rai-pal", ["RaiPal.exe", "updater-windows.zip"], {})).toBe("RaiPal.exe");
    expect(autoPick("reframework", ["DD2.zip", "RE2.zip"], {})).toBeNull();
  });
});
