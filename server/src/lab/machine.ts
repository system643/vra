import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Read-only hardware check: decides whether this PC can run the VRA Lab
 * (game + simulated headset + agent loop) at full speed, or only in "light" mode.
 */

export interface Gpu {
  name: string;
  vramGb: number | null;
  driver: string | null;
  dedicated: boolean;
  vendor: "nvidia" | "amd" | "intel" | "other";
  hardwareEncoder: string | null;
}

export interface MachineReport {
  cpu: string;
  cores: number;
  ramGb: number;
  freeRamGb: number;
  gpus: Gpu[];
  freeDiskGb: Record<string, number>;
  profile: "complet" | "léger";
  reasons: string[];
  advice: string[];
}

async function ps(script: string): Promise<string> {
  const { stdout } = await execFileP("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

export function classifyGpu(name: string, vramGb: number | null): Pick<Gpu, "vendor" | "dedicated" | "hardwareEncoder"> {
  const n = name.toLowerCase();
  const vendor = /nvidia|geforce|quadro|rtx|gtx/.test(n) ? "nvidia" : /amd|radeon/.test(n) ? "amd" : /intel/.test(n) ? "intel" : "other";
  const integrated = (vendor === "intel" && !/arc\(tm\) a\d{3}|arc a\d{3}|arc b\d{3}/.test(n)) || /radeon\(tm\) graphics$|vega \d+ graphics|radeon graphics$/.test(n);
  const dedicated = !integrated && (vramGb === null || vramGb >= 3);
  const hardwareEncoder = vendor === "nvidia" ? "NVENC" : vendor === "amd" ? "AMF/VCN" : vendor === "intel" ? "Quick Sync" : null;
  return { vendor, dedicated, hardwareEncoder };
}

export function decideProfile(gpus: Gpu[], ramGb: number): { profile: "complet" | "léger"; reasons: string[]; advice: string[] } {
  const best = [...gpus].sort((a, b) => (b.vramGb ?? 0) - (a.vramGb ?? 0)).find((g) => g.dedicated);
  const reasons: string[] = [];
  const advice: string[] = [];
  if (best && (best.vramGb ?? 8) >= 8 && ramGb >= 16) {
    reasons.push(`carte dédiée ${best.name} (${best.vramGb ?? "?"} Go de VRAM), ${Math.round(ramGb)} Go de RAM`);
    advice.push("Profil complet : résolution VR normale, matrices de réglages rapides, mesures de performance indicatives.");
    return { profile: "complet", reasons, advice };
  }
  if (!best) reasons.push("aucune carte graphique dédiée : le jeu, le casque simulé et l'encodage partagent la puce intégrée");
  else reasons.push(`carte dédiée ${best.name} avec ${best.vramGb ?? "?"} Go de VRAM (moins de 8 Go)`);
  if (ramGb < 16) reasons.push(`${Math.round(ramGb)} Go de RAM (moins de 16 Go)`);
  advice.push(
    "Profil léger : jeux légers seulement, réglages graphiques au minimum, résolution VR réduite (ex. 50 % dans UEVR), une variante à la fois.",
    "Les performances et le confort ne sont pas mesurables ici : les valider sur un PC avec carte dédiée et en casque.",
  );
  return { profile: "léger", reasons, advice };
}

export async function machineCheck(): Promise<MachineReport> {
  const cpus = os.cpus();
  const report: MachineReport = {
    cpu: cpus[0]?.model?.trim() ?? "inconnu",
    cores: cpus.length,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeRamGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    gpus: [],
    freeDiskGb: {},
    profile: "léger",
    reasons: [],
    advice: [],
  };
  if (process.platform === "win32") {
    try {
      const out = await ps(
        "$r=@();" +
          "$regs=Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue;" +
          "foreach($g in Get-CimInstance Win32_VideoController){ $v=$null; foreach($x in $regs){ if($x.DriverDesc -eq $g.Name -and $x.'HardwareInformation.qwMemorySize'){ $v=[double]$x.'HardwareInformation.qwMemorySize' } }; if(-not $v -and $g.AdapterRAM){ $v=[double]$g.AdapterRAM }; $r+=[pscustomobject]@{name=$g.Name;driver=$g.DriverVersion;vram=$v} };" +
          "$d=@{}; Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $d[$_.DeviceID]=[math]::Round($_.FreeSpace/1GB) };" +
          "[pscustomobject]@{gpus=$r;disks=$d} | ConvertTo-Json -Depth 4 -Compress",
      );
      const j = JSON.parse(out.trim()) as { gpus: Array<{ name: string; driver: string; vram: number | null }> | { name: string; driver: string; vram: number | null }; disks: Record<string, number> };
      const list = Array.isArray(j.gpus) ? j.gpus : [j.gpus];
      for (const g of list) {
        if (!g?.name || /basic|remote|virtual|parsec|meta|oculus/i.test(g.name)) continue;
        const vramGb = g.vram ? Math.round((g.vram / 1024 ** 3) * 10) / 10 : null;
        report.gpus.push({ name: g.name, vramGb, driver: g.driver ?? null, ...classifyGpu(g.name, vramGb) });
      }
      report.freeDiskGb = j.disks ?? {};
    } catch (e) {
      report.reasons.push(`lecture du matériel incomplète : ${(e as Error).message}`);
    }
  }
  const d = decideProfile(report.gpus, report.ramGb);
  report.profile = d.profile;
  report.reasons.push(...d.reasons);
  report.advice.push(...d.advice);
  const low = Object.entries(report.freeDiskGb).filter(([, gb]) => gb < 50);
  if (low.length) report.advice.push(`Peu d'espace libre (${low.map(([k, v]) => `${k} ${v} Go`).join(", ")}) : les jeux et les captures en demandent.`);
  if (report.freeRamGb < 6) report.advice.push("Moins de 6 Go de RAM libre : fermer les applications lourdes avant une session Lab.");
  return report;
}
