# VRA - screen capture (full virtual screen, or one window by title).
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.
param(
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$WindowTitle = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ("VraWin" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VraWin {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
}
[void][VraWin]::SetProcessDPIAware()

$left = 0; $top = 0; $width = 0; $height = 0
if ($WindowTitle -ne "") {
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$WindowTitle*" } | Select-Object -First 1
    if ($proc) {
        $r = New-Object VraWin+RECT
        [void][VraWin]::GetWindowRect($proc.MainWindowHandle, [ref]$r)
        $left = $r.Left; $top = $r.Top; $width = $r.Right - $r.Left; $height = $r.Bottom - $r.Top
    }
}
if ($width -le 0 -or $height -le 0) {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $left = $b.Left; $top = $b.Top; $width = $b.Width; $height = $b.Height
}

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
    $g.CopyFromScreen($left, $top, 0, 0, $bmp.Size)
    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $g.Dispose()
    $bmp.Dispose()
}
Write-Output $OutFile
