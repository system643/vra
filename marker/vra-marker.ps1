# VRA - in-game test markers.
# While you play, press Ctrl+Alt+M (keyboard) or hold LB+RB+A for ~1 s (XInput gamepad):
# VRA saves a timestamp, a screen capture and the tail of every known log.
# Beeps confirm each marker. Stops when the game process exits or after MaxMinutes.
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.
param(
    [Parameter(Mandatory = $true)][string]$MarkersDir,
    [Parameter(Mandatory = $true)][string]$CaptureScript,
    [string]$Logs = "",
    [string]$WatchProcess = "",
    [int]$MaxMinutes = 240,
    [int]$TailLines = 60
)

$ErrorActionPreference = "Continue"
if (-not (Test-Path $MarkersDir)) { New-Item -ItemType Directory -Force $MarkersDir | Out-Null }

if (-not ("VraInput" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VraInput {
    [StructLayout(LayoutKind.Sequential)] public struct XINPUT_GAMEPAD { public ushort wButtons; public byte bLeftTrigger; public byte bRightTrigger; public short sThumbLX; public short sThumbLY; public short sThumbRX; public short sThumbRY; }
    [StructLayout(LayoutKind.Sequential)] public struct XINPUT_STATE { public uint dwPacketNumber; public XINPUT_GAMEPAD Gamepad; }
    [DllImport("xinput1_4.dll")] public static extern uint XInputGetState(uint dwUserIndex, out XINPUT_STATE pState);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    public static bool KeyDown(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
    public static ushort Buttons(uint index) {
        XINPUT_STATE s;
        try { if (XInputGetState(index, out s) == 0) return s.Gamepad.wButtons; } catch { }
        return 0;
    }
}
"@
}

$VK_CONTROL = 0x11; $VK_MENU = 0x12; $VK_M = 0x4D
$COMBO = 0x0100 -bor 0x0200 -bor 0x1000   # LB + RB + A
$logList = @()
if ($Logs -ne "") { $logList = $Logs.Split("|") | Where-Object { $_ -ne "" } }

$deadline = (Get-Date).AddMinutes($MaxMinutes)
$heldFrames = 0
$keyLatch = $false
$count = 0
$seenGame = $false
$tick = 0

function Save-Marker([string]$source) {
    $script:count++
    $stamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
    $base = Join-Path $MarkersDir ("marker_" + $stamp + "_" + $script:count)
    $png = $base + ".png"
    try { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CaptureScript -OutFile $png | Out-Null } catch { $png = $null }
    $tails = @{}
    foreach ($l in $logList) {
        if (Test-Path -LiteralPath $l) {
            try { $tails[$l] = (Get-Content -LiteralPath $l -Tail $TailLines -ErrorAction Stop) -join "`n" } catch { }
        }
    }
    $obj = [ordered]@{
        at       = (Get-Date).ToUniversalTime().ToString("o")
        index    = $script:count
        source   = $source
        capture  = $png
        logs     = $tails
        analyzed = $false
    }
    $json = $obj | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($base + ".json", $json, (New-Object System.Text.UTF8Encoding($false)))
    [console]::Beep(880, 120); [console]::Beep(1320, 120)
}

[console]::Beep(660, 150)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 16
    # keyboard: Ctrl+Alt+M (edge-triggered)
    $k = [VraInput]::KeyDown($VK_CONTROL) -and [VraInput]::KeyDown($VK_MENU) -and [VraInput]::KeyDown($VK_M)
    if ($k -and -not $keyLatch) { Save-Marker "clavier" }
    $keyLatch = $k
    # gamepad: LB+RB+A held ~1 s on any of the 4 XInput slots
    $pressed = $false
    for ($i = 0; $i -lt 4; $i++) { if (([VraInput]::Buttons($i) -band $COMBO) -eq $COMBO) { $pressed = $true } }
    if ($pressed) { $heldFrames++ } else { $heldFrames = 0 }
    if ($heldFrames -eq 60) { Save-Marker "manette" }
    # stop when the watched game exits (once it has been seen running)
    $tick++
    if ($WatchProcess -ne "" -and ($tick % 300 -eq 0)) {
        $running = Get-Process -Name $WatchProcess -ErrorAction SilentlyContinue
        if ($running) { $seenGame = $true }
        elseif ($seenGame) { break }
    }
}
[console]::Beep(440, 200)
