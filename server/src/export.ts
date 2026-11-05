import fs from "node:fs";
import path from "node:path";
import { appData, ensureDir, gameSlug, vraHome } from "./paths.js";
import { readCard, readJournal, readState } from "./store.js";
import { checklistStatus } from "./checklist.js";

/** Case studies (REA "showcases") and share packages. */

export function exportCaseStudy(gamePath: string, extra: { timeSpent?: string; notes?: string }): string {
  const slug = gameSlug(gamePath);
  const card = readCard(gamePath);
  const st = readState(gamePath);
  const journal = readJournal(gamePath);
  const last = st.fingerprints.at(-1);
  const chk = checklistStatus(gamePath, last?.sha256 ?? null);
  const f = (k: string) => {
    const c = card.fields[k];
    if (!c || c.value === null || c.value === undefined) return "inconnu";
    return typeof c.value === "object" ? JSON.stringify(c.value) : String(c.value);
  };
  const problems = journal.filter((e) => e.kind === "result" || e.kind === "test").slice(-30);
  const lines = [
    `# Étude de cas VRA — ${slug}`,
    "",
    "| Champ | Contenu |",
    "| --- | --- |",
    `| Jeu et version | ${slug} · exe ${last?.sha256?.slice(0, 12) ?? "?"} · ${f("storefront")} |`,
    `| Moteur et variante | ${f("engine")} ${f("version")} · ${f("runtime_variant")} · API ${f("graphics_apis")} |`,
    `| Niveau atteint | ${st.target ? `cible ${st.target.level} / plafond ${st.target.ceiling}` : "non renseigné"} |`,
    `| Outils et versions | ${st.installs.map((i) => `${i.tool} ${i.version}`).join(", ") || "—"} |`,
    `| Réglages clés | ${Object.entries(st.activeSettings).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ") || "—"} |`,
    `| Temps passé | ${extra.timeSpent ?? `${journal.filter((e) => e.kind === "open").length} session(s)`} |`,
    `| Limites restantes | ${chk.rows.filter((r) => r.state === "blocked" || r.state === "out_of_scope" || r.state === "open").map((r) => `${r.label} (${r.state})`).join(", ") || "aucune"} |`,
    "",
    "## Checklist qualité",
    "",
    "| Point | État | Preuve |",
    "| --- | --- | --- |",
    ...chk.rows.map((r) => `| ${r.label} | ${r.state} | ${(r.evidence ?? "").replace(/\|/g, "\\|")} |`),
    "",
    "## Problèmes rencontrés",
    "",
    ...(problems.length ? problems.map((p) => `- ${p.at.slice(0, 10)} — ${p.summary}`) : ["- aucun consigné"]),
    "",
    extra.notes ? `## Notes\n\n${extra.notes}\n` : "",
    "_Crédits : merci aux auteurs des outils utilisés (voir leurs licences)._",
  ];
  const out = path.join(ensureDir(path.join(vraHome(), "gallery")), `${slug}.md`);
  fs.writeFileSync(out, lines.join("\n") + "\n", "utf8");
  return out;
}

export interface SharePackage {
  dir: string;
  copied: string[];
  reminders: string[];
}

function copyTree(src: string, dst: string, filter: (rel: string) => boolean, base = src, out: string[] = []): string[] {
  if (!fs.existsSync(src)) return out;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const rel = path.relative(base, s).replace(/\\/g, "/");
    if (e.isDirectory()) copyTree(s, path.join(dst, e.name), filter, base, out);
    else if (e.isFile() && filter(rel)) {
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(s, path.join(dst, e.name));
      out.push(rel);
    }
  }
  return out;
}

export function exportSharePackage(gamePath: string, opts: { exeStem?: string; exeDir?: string; include: string[] }): SharePackage {
  const slug = gameSlug(gamePath);
  const dir = ensureDir(path.join(vraHome(), "share", slug));
  const copied: string[] = [];
  const reminders: string[] = [];
  if (opts.include.includes("uevr_profile") && opts.exeStem) {
    const src = path.join(appData(), "UnrealVRMod", opts.exeStem);
    const got = copyTree(src, path.join(dir, "uevr", opts.exeStem), (rel) => !/^data\//.test(rel) && !/\.(?:log|dmp)$/i.test(rel) && !/^log/i.test(rel));
    copied.push(...got.map((g) => `uevr/${opts.exeStem}/${g}`));
    reminders.push("UEVR : vérifier que « Enabled at Startup » est coché dans UObjectHook, sinon le profil partagé n'active pas les attaches.");
  }
  if (opts.include.includes("bepinex_plugins") && opts.exeDir) {
    const got = copyTree(path.join(opts.exeDir, "BepInEx", "plugins"), path.join(dir, "BepInEx", "plugins"), (rel) => /^VRA\./i.test(path.basename(rel)));
    copied.push(...got.map((g) => `BepInEx/plugins/${g}`));
  }
  if (opts.include.includes("reframework_scripts") && opts.exeDir) {
    const got = copyTree(path.join(opts.exeDir, "reframework", "autorun"), path.join(dir, "reframework", "autorun"), (rel) => /^vra_/i.test(path.basename(rel)));
    copied.push(...got.map((g) => `reframework/autorun/${g}`));
  }
  const readme = `# Profil VR partagé — ${slug}\n\nPréparé avec VRA. Contenu : ${copied.length} fichier(s).\n\n## Crédits et licences\n\n- Les outils (UEVR, BepInEx, REFramework, UUVR…) appartiennent à leurs auteurs ; ce paquet ne contient que des réglages et scripts.\n- Respecter la licence de chaque outil (ex. UUVR GPL-3.0) en cas de redistribution.\n- Aucun fichier du jeu n'est inclus.\n`;
  fs.writeFileSync(path.join(dir, "LISEZMOI.md"), readme, "utf8");
  reminders.push("Ne jamais inclure de fichiers du jeu ; joindre l'étude de cas (export_case_study).");
  return { dir, copied, reminders };
}
