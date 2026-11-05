import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ensureDir, vraHome } from "./paths.js";
import { appendJsonl } from "./util/fsx.js";

/**
 * Windows notification (toast, falling back to a tray balloon) and opening of a
 * file (the autopilot report). Every notification is also logged in
 * <VRA_HOME>/lab/notifications.jsonl. VRA_NO_NOTIFY=1 → log only (tests, CI).
 */

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
const xmlEsc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function notificationsLog(): string {
  return path.join(ensureDir(path.join(vraHome(), "lab")), "notifications.jsonl");
}

export function notifyUser(title: string, body: string, opts: { open?: string } = {}): { shown: boolean; method: string } {
  appendJsonl(notificationsLog(), { at: new Date().toISOString(), title, body, open: opts.open ?? null });
  if (process.env.VRA_NO_NOTIFY === "1" || process.platform !== "win32") return { shown: false, method: "journal seulement" };
  const toastXml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEsc(title)}</text><text>${xmlEsc(body)}</text></binding></visual></toast>`;
  const script = [
    "$ErrorActionPreference='Stop'",
    "try {",
    "  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "  $x = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `  $x.LoadXml(${psq(toastXml)})`,
    "  $app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))",
    "} catch {",
    "  Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing",
    "  $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true",
    `  $n.ShowBalloonTip(15000, ${psq(title)}, ${psq(body)}, 'Info'); Start-Sleep -Seconds 16; $n.Dispose()`,
    "}",
    ...(opts.open && fs.existsSync(opts.open) ? [`Start-Process -FilePath ${psq(opts.open)}`] : []),
  ].join("\n");
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return { shown: true, method: "notification Windows" };
  } catch {
    return { shown: false, method: "échec (journal seulement)" };
  }
}
