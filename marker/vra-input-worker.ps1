# VRA - game UI control worker (Windows). Long-lived process: reads one JSON command per line on stdin,
# writes one JSON result per line on stdout. Started and driven by the VRA MCP server (lab/input.ts).
# Commands: window, focus, capture, ocr, click, move, key, type, cursor.
# Safety (enforced again here): input is only sent while the target game window is in the foreground.
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ("VraUi" -as [type])) {
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class VraUi {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
    public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
    static INPUT Key(ushort vk, bool up, bool extended) {
        var i = new INPUT(); i.type = 1;
        ushort scan = (ushort)MapVirtualKey(vk, 0);
        i.u.ki.wVk = vk; i.u.ki.wScan = scan;
        i.u.ki.dwFlags = 0x0008 | (up ? 0x0002u : 0u) | (extended ? 0x0001u : 0u); // SCANCODE (+KEYUP, +EXTENDED)
        return i;
    }
    public static void KeyDown(ushort vk, bool ext) { SendInput(1, new[] { Key(vk, false, ext) }, Marshal.SizeOf(typeof(INPUT))); }
    public static void KeyUp(ushort vk, bool ext) { SendInput(1, new[] { Key(vk, true, ext) }, Marshal.SizeOf(typeof(INPUT))); }
    public static void Unicode(char c) {
        var d = new INPUT(); d.type = 1; d.u.ki.wScan = c; d.u.ki.dwFlags = 0x0004;
        var u = new INPUT(); u.type = 1; u.u.ki.wScan = c; u.u.ki.dwFlags = 0x0004 | 0x0002;
        SendInput(2, new[] { d, u }, Marshal.SizeOf(typeof(INPUT)));
    }
    public static void Mouse(uint flags, int data) {
        var i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = (uint)data;
        SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
    }
}
"@
}
[void][VraUi]::SetProcessDPIAware()

# --- OCR (Windows.Media.Ocr, built into Windows 10/11) ---
$script:ocrReady = $false
function Init-Ocr {
    if ($script:ocrReady) { return }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    $script:ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    $script:ocrReady = $true
}
function Await($op, [Type]$t) { $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); return $task.Result }

function Get-Ocr([string]$file) {
    Init-Ocr
    if (-not $script:ocrEngine) { throw "OCR Windows indisponible (aucune langue OCR installee)" }
    $sf = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
    $stream = Await ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $res = Await ($script:ocrEngine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    } finally { $stream.Dispose() }
    $lines = @()
    foreach ($l in $res.Lines) {
        $words = @()
        foreach ($w in $l.Words) { $r = $w.BoundingRect; $words += @{ text = $w.Text; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height } }
        if ($words.Count) {
            $x0 = ($words | ForEach-Object { $_.x } | Measure-Object -Minimum).Minimum
            $y0 = ($words | ForEach-Object { $_.y } | Measure-Object -Minimum).Minimum
            $x1 = ($words | ForEach-Object { $_.x + $_.w } | Measure-Object -Maximum).Maximum
            $y1 = ($words | ForEach-Object { $_.y + $_.h } | Measure-Object -Maximum).Maximum
            $lines += @{ text = $l.Text; x = $x0; y = $y0; w = $x1 - $x0; h = $y1 - $y0; words = $words }
        }
    }
    return @{ language = $script:ocrEngine.RecognizerLanguage.LanguageTag; lines = $lines }
}

# --- window helpers ---
function Get-Win([int]$procId) {
    $p = Get-Process -Id $procId -ErrorAction Stop
    if ($p.MainWindowHandle -eq [IntPtr]::Zero) { throw "le processus $procId n'a pas de fenetre principale" }
    $h = $p.MainWindowHandle
    $rc = New-Object VraUi+RECT
    [void][VraUi]::GetClientRect($h, [ref]$rc)
    $pt = New-Object VraUi+POINT
    [void][VraUi]::ClientToScreen($h, [ref]$pt)
    return @{ handle = $h; pid = $procId; title = [VraUi]::Title($h); x = $pt.X; y = $pt.Y; w = $rc.Right - $rc.Left; h = $rc.Bottom - $rc.Top; minimized = [VraUi]::IsIconic($h) }
}

function Focus-Win($win) {
    if ($win.minimized) { [void][VraUi]::ShowWindow($win.handle, 9) }
    # Already in front: do nothing (an ALT tap would open the window menu and swallow the next key).
    if (-not $win.minimized -and [VraUi]::ForegroundPid() -eq [uint32]$win.pid) { return $true }
    # ALT tap lets SetForegroundWindow succeed despite Windows focus-stealing rules.
    [VraUi]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [VraUi]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][VraUi]::SetForegroundWindow($win.handle)
    Start-Sleep -Milliseconds 120
    return ([VraUi]::ForegroundPid() -eq [uint32]$win.pid)
}

function Assert-Foreground([int]$procId) {
    if ([VraUi]::ForegroundPid() -ne [uint32]$procId) { throw "SECURITE : la fenetre du jeu n'est plus au premier plan, action annulee" }
}

$script:lastCursor = $null
function Assert-UserIdle {
    # Fail-safe: if the user moved the mouse since our last move, they are taking back control.
    if ($script:lastCursor) {
        $p = New-Object VraUi+POINT
        [void][VraUi]::GetCursorPos([ref]$p)
        if ([math]::Abs($p.X - $script:lastCursor.X) -gt 25 -or [math]::Abs($p.Y - $script:lastCursor.Y) -gt 25) {
            $script:lastCursor = $null
            throw "SECURITE : la souris a ete bougee par l'utilisateur, automatisation interrompue"
        }
    }
}

$VK = @{
    enter = 0x0D; return = 0x0D; esc = 0x1B; escape = 0x1B; space = 0x20; tab = 0x09; backspace = 0x08;
    up = 0x26; down = 0x28; left = 0x25; right = 0x27; shift = 0x10; ctrl = 0x11; control = 0x11; alt = 0x12;
    home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22; insert = 0x2D; delete = 0x2E;
    f1 = 0x70; f2 = 0x71; f3 = 0x72; f4 = 0x73; f5 = 0x74; f6 = 0x75; f7 = 0x76; f8 = 0x77; f9 = 0x78; f10 = 0x79; f11 = 0x7A; f12 = 0x7B
}
$EXT = @(0x26, 0x28, 0x25, 0x27, 0x24, 0x23, 0x21, 0x22, 0x2D, 0x2E)
function Get-Vk([string]$name) {
    $n = $name.ToLower()
    if ($VK.ContainsKey($n)) { return [uint16]$VK[$n] }
    if ($n.Length -eq 1) { return [uint16][char]$n.ToUpper() }
    throw "touche inconnue : $name"
}

function Handle($c) {
    switch ($c.op) {
        "ping" { return @{ pong = $true } }
        "window" { $w = Get-Win $c.pid; $w.Remove("handle"); $w.foreground = ([VraUi]::ForegroundPid() -eq [uint32]$c.pid); return $w }
        "focus" { $w = Get-Win $c.pid; $ok = Focus-Win $w; if ($w.minimized) { Start-Sleep -Milliseconds 250 }; return @{ focused = $ok } }
        "cursor" { $p = New-Object VraUi+POINT; [void][VraUi]::GetCursorPos([ref]$p); return @{ x = $p.X; y = $p.Y } }
        "capture" {
            $w = Get-Win $c.pid
            if ($c.focus -or $w.minimized) {
                [void](Focus-Win $w)
                Start-Sleep -Milliseconds 250
                $w = Get-Win $c.pid   # restored / moved: read the geometry again
            }
            if ($w.w -le 0 -or $w.h -le 0) { throw "fenetre du jeu sans surface visible (reduite ?)" }
            $bmp = New-Object System.Drawing.Bitmap($w.w, $w.h)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            try { $g.CopyFromScreen($w.x, $w.y, 0, 0, $bmp.Size); $bmp.Save($c.out, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $g.Dispose(); $bmp.Dispose() }
            return @{ file = $c.out; x = $w.x; y = $w.y; w = $w.w; h = $w.h; foreground = ([VraUi]::ForegroundPid() -eq [uint32]$c.pid) }
        }
        "ocr" { return (Get-Ocr $c.file) }
        "move" {
            $w = Get-Win $c.pid; Assert-UserIdle; Assert-Foreground $c.pid
            $sx = $w.x + [int]$c.x; $sy = $w.y + [int]$c.y
            [void][VraUi]::SetCursorPos($sx, $sy); $script:lastCursor = @{ X = $sx; Y = $sy }
            return @{ x = $sx; y = $sy }
        }
        "click" {
            $w = Get-Win $c.pid; Assert-UserIdle; Assert-Foreground $c.pid
            if ($c.x -lt 0 -or $c.y -lt 0 -or $c.x -ge $w.w -or $c.y -ge $w.h) { throw "point hors de la fenetre du jeu ($($c.x),$($c.y))" }
            $sx = $w.x + [int]$c.x; $sy = $w.y + [int]$c.y
            [void][VraUi]::SetCursorPos($sx, $sy); $script:lastCursor = @{ X = $sx; Y = $sy }
            Start-Sleep -Milliseconds 40
            $down = 0x0002; $up = 0x0004
            if ($c.button -eq "right") { $down = 0x0008; $up = 0x0010 }
            $n = [math]::Max(1, [int]$c.count)
            for ($i = 0; $i -lt $n; $i++) { [VraUi]::Mouse($down, 0); Start-Sleep -Milliseconds 50; [VraUi]::Mouse($up, 0); Start-Sleep -Milliseconds 60 }
            return @{ x = $sx; y = $sy }
        }
        "key" {
            $null = Get-Win $c.pid; Assert-UserIdle; Assert-Foreground $c.pid
            $parts = ([string]$c.keys).Split("+") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
            $vks = @($parts | ForEach-Object { Get-Vk $_ })
            $times = [math]::Max(1, [int]$c.repeat)
            for ($r = 0; $r -lt $times; $r++) {
                foreach ($v in $vks) { [VraUi]::KeyDown($v, ($EXT -contains $v)) ; Start-Sleep -Milliseconds 15 }
                Start-Sleep -Milliseconds ([math]::Max(30, [int]$c.hold_ms))
                [array]::Reverse($vks); foreach ($v in $vks) { [VraUi]::KeyUp($v, ($EXT -contains $v)) }; [array]::Reverse($vks)
                Start-Sleep -Milliseconds 80
            }
            return @{ keys = $c.keys; repeat = $times }
        }
        "type" {
            $null = Get-Win $c.pid; Assert-UserIdle; Assert-Foreground $c.pid
            foreach ($ch in ([string]$c.text).ToCharArray()) { [VraUi]::Unicode($ch); Start-Sleep -Milliseconds 25 }
            return @{ typed = ([string]$c.text).Length }
        }
        default { throw "commande inconnue : $($c.op)" }
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if (-not $line.Trim()) { continue }
    $id = $null
    try {
        $c = $line | ConvertFrom-Json
        $id = $c.id
        $res = Handle $c
        $out = @{ id = $id; ok = $true; result = $res }
    } catch {
        $out = @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($out | ConvertTo-Json -Depth 8 -Compress))
    [Console]::Out.Flush()
}
