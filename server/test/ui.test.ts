import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Real Windows test of the game UI control (opens a small window and moves the mouse for a few seconds).
 * Opt-in: VRA_UI_TEST=1 npx vitest run test/ui.test.ts
 */
const enabled = process.platform === "win32" && process.env.VRA_UI_TEST === "1";
process.env.VRA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vra-ui-home-"));
const { matchText, norm, worker, uiWindow, uiFindText, uiClickText, uiKey, uiType, runUiSteps } = await import("../src/lab/input.js");

describe("correspondance de texte OCR (toujours exécuté)", () => {
  it("insensible aux accents et à la casse, mots consécutifs", () => {
    expect(norm("Nouvelle Partie !")).toBe("nouvelle partie");
    const lines = [
      { text: "CONTINUER", x: 10, y: 10, w: 100, h: 20, words: [{ text: "CONTINUER", x: 10, y: 10, w: 100, h: 20 }] },
      { text: "NOUVELLE PARTIE", x: 10, y: 50, w: 200, h: 20, words: [{ text: "NOUVELLE", x: 10, y: 50, w: 90, h: 20 }, { text: "PARTIE", x: 110, y: 50, w: 100, h: 20 }] },
      { text: "Paramètres", x: 10, y: 90, w: 120, h: 20, words: [{ text: "Paramètres", x: 10, y: 90, w: 120, h: 20 }] },
    ];
    expect(matchText(lines, "nouvelle partie")?.y).toBe(50);
    expect(matchText(lines, "parametres")?.text).toBe("Paramètres");
    expect(matchText(lines, "charger")).toBeNull();
  });
});

describe.skipIf(!enabled)("contrôle réel d'une fenêtre (Windows)", () => {
  const log = path.join(os.tmpdir(), `vra-fake-game-${Date.now()}.log`);
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "fake-game-window.ps1"), log], { stdio: "ignore" });
  afterAll(() => {
    worker.stop();
    child.kill();
  });
  const target = () => ({ pid: child.pid!, gamePath: os.tmpdir() });
  const events = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean) : []);

  it("trouve la fenêtre, lit le menu par OCR, clique, tape, appuie sur des touches", async () => {
    const t0 = Date.now();
    while (!events().includes("shown") && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    const win = await uiWindow(target());
    expect(win.title).toBe("VRA Fake Game");
    const f = await uiFindText(target(), "nouvelle partie");
    expect(f.match).not.toBeNull();
    await uiClickText(target(), "Nouvelle partie");
    await uiClickText(target(), "options");
    await uiKey(target(), "esc");
    // Coordinates are capture pixels (physical): scale the text box position (logical 310,310 in a 624x381 client).
    const w2 = await uiWindow(target());
    const steps = await runUiSteps(target(), [{ do: "click", x: (w2.w * 310) / 624, y: (w2.h * 310) / 381 }, { do: "type", text: "Joueur VR" }, { do: "key", keys: "enter" }]);
    expect(steps.every((s) => s.ok)).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(events()).toEqual(expect.arrayContaining(["click:NOUVELLE PARTIE", "click:OPTIONS", "key:escape", "enter:Joueur VR"]));
  }, 90000);
});
