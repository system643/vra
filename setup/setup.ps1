<#
  VRA — installation en une commande (Windows).
  Lancement : double-clic sur setup.cmd à la racine du dépôt, ou dans un terminal :
      .\setup.cmd                 interface graphique
      .\setup.cmd -NoGui          mode console (questions dans le terminal)
      .\setup.cmd -NoGui -Yes     mode console, tout accepter
  1. Vérifie Node.js 22+ (propose de l'installer via winget s'il manque).
  2. Ouvre l'interface : clients IA à configurer, téléchargements Meta, options, journal en direct.
  3. Délègue tout le reste à setup/setup.mjs (idempotent, sauvegarde chaque fichier modifié).
#>
param(
    [switch]$NoGui,
    [switch]$Yes,
    [switch]$SelfTest,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$SetupJs = Join-Path $PSScriptRoot "setup.mjs"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Update-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Get-NodeMajor {
    try {
        $v = (& node -v) 2>$null
        if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
    } catch { }
    return 0
}

function Confirm-Choice([string]$Message) {
    if ($Yes) { return $true }
    if ($NoGui) {
        $a = Read-Host "$Message [O/n]"
        return ($a -eq "" -or $a -match '^[oOyY]')
    }
    Add-Type -AssemblyName System.Windows.Forms
    $r = [System.Windows.Forms.MessageBox]::Show($Message, "Installation de VRA", "YesNo", "Question")
    return ($r -eq "Yes")
}

# ───────── 1. Node.js 22+ ─────────
if ((Get-NodeMajor) -lt 22) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget -and (Confirm-Choice "Node.js 22 ou plus récent est nécessaire. L'installer maintenant avec winget (Node.js LTS) ?")) {
        & winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
        Update-PathFromRegistry
    }
    if ((Get-NodeMajor) -lt 22) {
        $msg = "Node.js 22+ est introuvable. Installe-le depuis https://nodejs.org puis relance setup.cmd."
        if ($NoGui) { Write-Host $msg -ForegroundColor Red } else {
            Add-Type -AssemblyName System.Windows.Forms
            [void][System.Windows.Forms.MessageBox]::Show($msg, "Installation de VRA", "OK", "Error")
            Start-Process "https://nodejs.org/"
        }
        exit 1
    }
}

# ───────── Console mode ─────────
if ($NoGui) {
    $args2 = @($SetupJs)
    if ($Yes) { $args2 += "--yes" }
    if ($Rest) { $args2 += $Rest }
    & node @args2
    exit $LASTEXITCODE
}

# ───────── 2. Graphical interface ─────────
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Get-Status {
    $json = (& node $SetupJs --status) 2>$null
    return ($json | Out-String | ConvertFrom-Json)
}

$status = Get-Status
$font = New-Object System.Drawing.Font("Segoe UI", 9.5)
$bold = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)

$form = New-Object System.Windows.Forms.Form
$form.Text = "Installation de VRA — VR-ify Anything"
$form.Size = New-Object System.Drawing.Size(900, 760)
$form.StartPosition = "CenterScreen"
$form.Font = $font
$form.MinimumSize = New-Object System.Drawing.Size(820, 640)

$title = New-Object System.Windows.Forms.Label
$title.Text = "VRA : mettre n'importe quel jeu en VR"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(16, 12)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Dépôt : $Repo   •   Données : $($status.vraHome)"
$subtitle.AutoSize = $false
$subtitle.AutoEllipsis = $true
$subtitle.Size = New-Object System.Drawing.Size(850, 20)
$subtitle.ForeColor = [System.Drawing.Color]::DimGray
$subtitle.Location = New-Object System.Drawing.Point(18, 44)
$form.Controls.Add($subtitle)

# 1. Clients IA
$grpAgents = New-Object System.Windows.Forms.GroupBox
$grpAgents.Text = "1. Clients IA à configurer (cochés = détectés sur ce PC)"
$grpAgents.Font = $bold
$grpAgents.Location = New-Object System.Drawing.Point(16, 72)
$grpAgents.Size = New-Object System.Drawing.Size(420, 250)
$form.Controls.Add($grpAgents)
$agentBoxes = @{}
$y = 26
foreach ($p in $status.agents.PSObject.Properties) {
    $cb = New-Object System.Windows.Forms.CheckBox
    $cb.Font = $font
    $cb.Text = $p.Value.label + $(if ($p.Value.present) { "" } else { "  (non détecté)" })
    $cb.Checked = [bool]$p.Value.present
    $cb.AutoSize = $true
    $cb.Location = New-Object System.Drawing.Point(12, $y)
    $grpAgents.Controls.Add($cb)
    $agentBoxes[$p.Name] = $cb
    $y += 30
}

# 2. Téléchargements Meta
$grpMeta = New-Object System.Windows.Forms.GroupBox
$grpMeta.Text = "2. Banc d'essai sans casque (logiciels Meta)"
$grpMeta.Font = $bold
$grpMeta.Location = New-Object System.Drawing.Point(448, 72)
$grpMeta.Size = New-Object System.Drawing.Size(420, 250)
$form.Controls.Add($grpMeta)

function New-Row([System.Windows.Forms.Control]$parent, [int]$top, [string]$url) {
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Font = $font
    $lbl.AutoSize = $false
    $lbl.Size = New-Object System.Drawing.Size(270, 40)
    $lbl.Location = New-Object System.Drawing.Point(12, $top)
    $parent.Controls.Add($lbl)
    $btn = New-Object System.Windows.Forms.Button
    $btn.Font = $font
    $btn.Text = "Télécharger"
    $btn.Size = New-Object System.Drawing.Size(110, 30)
    $btn.Location = New-Object System.Drawing.Point(294, $top)
    $btn.Tag = $url
    $btn.Add_Click({ Start-Process $this.Tag })
    $parent.Controls.Add($btn)
    return $lbl
}

$lblSim = New-Row $grpMeta 28 $status.links.simulator
$lblOp = New-Row $grpMeta 76 $status.links.operator
$lblVd = New-Row $grpMeta 124 $status.links.virtualDesktop

$hint = New-Object System.Windows.Forms.Label
$hint.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)
$hint.ForeColor = [System.Drawing.Color]::DimGray
$hint.Text = "Mets les fichiers téléchargés dans Téléchargements, sur le Bureau ou dans le dossier VR : ils sont trouvés automatiquement. Ils ne sont jamais publiés sur GitHub."
$hint.Size = New-Object System.Drawing.Size(395, 46)
$hint.Location = New-Object System.Drawing.Point(12, 164)
$grpMeta.Controls.Add($hint)

$btnRescan = New-Object System.Windows.Forms.Button
$btnRescan.Font = $font
$btnRescan.Text = "Rechercher à nouveau"
$btnRescan.Size = New-Object System.Drawing.Size(170, 28)
$btnRescan.Location = New-Object System.Drawing.Point(12, 214)
$grpMeta.Controls.Add($btnRescan)

function Update-MetaLabels {
    $m = $script:status.meta
    if ($m.simulatorInstalled) { $lblSim.Text = "Meta XR Simulator : installé ✔"; $lblSim.ForeColor = [System.Drawing.Color]::DarkGreen }
    elseif ($m.simulatorMsi) { $lblSim.Text = "Meta XR Simulator : installeur trouvé, sera installé"; $lblSim.ForeColor = [System.Drawing.Color]::DarkOrange }
    else { $lblSim.Text = "Meta XR Simulator : à télécharger (.msi Windows)"; $lblSim.ForeColor = [System.Drawing.Color]::Firebrick }
    if ($m.operatorInstalled) { $lblOp.Text = "Meta XR Operator : installé ✔"; $lblOp.ForeColor = [System.Drawing.Color]::DarkGreen }
    elseif ($m.operatorZip) { $lblOp.Text = "Meta XR Operator : zip trouvé, sera installé"; $lblOp.ForeColor = [System.Drawing.Color]::DarkOrange }
    else { $lblOp.Text = "Meta XR Operator : à télécharger (zip « Standalone »)"; $lblOp.ForeColor = [System.Drawing.Color]::Firebrick }
    $lblVd.Text = "Virtual Desktop Streamer (pour jouer avec le Quest)"
    $lblVd.ForeColor = [System.Drawing.Color]::Black
}
Update-MetaLabels
$btnRescan.Add_Click({ $script:status = Get-Status; Update-MetaLabels })

# 3. Options
$grpOpt = New-Object System.Windows.Forms.GroupBox
$grpOpt.Text = "3. Options"
$grpOpt.Font = $bold
$grpOpt.Location = New-Object System.Drawing.Point(16, 330)
$grpOpt.Size = New-Object System.Drawing.Size(852, 62)
$form.Controls.Add($grpOpt)
function New-Opt([string]$text, [int]$x, [bool]$checked) {
    $cb = New-Object System.Windows.Forms.CheckBox
    $cb.Font = $font
    $cb.Text = $text
    $cb.Checked = $checked
    $cb.AutoSize = $true
    $cb.Location = New-Object System.Drawing.Point($x, 26)
    $grpOpt.Controls.Add($cb)
    return $cb
}
$optSim = New-Opt "Installer Meta XR Simulator s'il est trouvé" 12 $true
$optDotnet = New-Opt "Installer le SDK .NET 8 (mods Unity)" 320 $true
$optTests = New-Opt "Tests complets (plus long)" 610 $false

# Journal
$log = New-Object System.Windows.Forms.RichTextBox
$log.ReadOnly = $true
$log.Font = New-Object System.Drawing.Font("Consolas", 9)
$log.BackColor = [System.Drawing.Color]::White
$log.Location = New-Object System.Drawing.Point(16, 400)
$log.Size = New-Object System.Drawing.Size(852, 250)
$log.Anchor = "Top,Bottom,Left,Right"
$form.Controls.Add($log)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = "Marquee"
$progress.MarqueeAnimationSpeed = 0
$progress.Location = New-Object System.Drawing.Point(16, 658)
$progress.Size = New-Object System.Drawing.Size(300, 26)
$progress.Anchor = "Bottom,Left"
$form.Controls.Add($progress)

function New-Btn([string]$text, [int]$x, [int]$w) {
    $b = New-Object System.Windows.Forms.Button
    $b.Font = $bold
    $b.Text = $text
    $b.Size = New-Object System.Drawing.Size($w, 34)
    $b.Location = New-Object System.Drawing.Point($x, 654)
    $b.Anchor = "Bottom,Right"
    $form.Controls.Add($b)
    return $b
}
$btnInstall = New-Btn "Installer / mettre à jour" 330 200
$btnDry = New-Btn "Simulation" 538 110
$btnUninstall = New-Btn "Désinstaller" 656 110
$btnClose = New-Btn "Fermer" 774 94
$btnClose.Add_Click({ $form.Close() })

function Add-Log([string]$text, [System.Drawing.Color]$color) {
    $log.SelectionStart = $log.TextLength
    $log.SelectionLength = 0
    $log.SelectionColor = $color
    $log.AppendText($text + [Environment]::NewLine)
    $log.ScrollToCaret()
}

$script:proc = $null
$script:outFile = $null
$script:offset = 0
$script:lastExit = $null
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200

function Read-NewLines {
    if (-not $script:outFile -or -not (Test-Path $script:outFile)) { return @() }
    $fs = [System.IO.File]::Open($script:outFile, "Open", "Read", "ReadWrite")
    try {
        $fs.Seek($script:offset, "Begin") | Out-Null
        $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        $text = $sr.ReadToEnd()
    } finally { $fs.Close() }
    $lastNl = $text.LastIndexOf("`n")
    if ($lastNl -lt 0) { return @() }
    $complete = $text.Substring(0, $lastNl + 1)
    $script:offset += [System.Text.Encoding]::UTF8.GetByteCount($complete)
    return $complete -split "`r?`n" | Where-Object { $_ -ne "" }
}

function Show-Event([string]$line) {
    try { $ev = $line | ConvertFrom-Json } catch { Add-Log $line ([System.Drawing.Color]::Gray); return }
    switch ($ev.type) {
        "step" {
            $map = @{ start = @("…", [System.Drawing.Color]::SteelBlue); ok = @("✔", [System.Drawing.Color]::DarkGreen); warn = @("!", [System.Drawing.Color]::DarkOrange); fail = @("✖", [System.Drawing.Color]::Firebrick); skip = @("–", [System.Drawing.Color]::Gray) }
            $m = $map[[string]$ev.status]
            if (-not $m) { $m = @("•", [System.Drawing.Color]::Black) }
            $txt = "$($m[0]) $($ev.title)"
            if ($ev.detail) { $txt += " — $($ev.detail)" }
            Add-Log $txt $m[1]
        }
        "log" { Add-Log ("    " + $ev.text) ([System.Drawing.Color]::Gray) }
        "summary" { Add-Log "" ([System.Drawing.Color]::Black); Add-Log $ev.text ([System.Drawing.Color]::Black) }
        default { }
    }
}

function Complete-Run {
    foreach ($l in (Read-NewLines)) { Show-Event $l }
    $timer.Stop()
    $progress.MarqueeAnimationSpeed = 0
    foreach ($b in @($btnInstall, $btnDry, $btnUninstall)) { $b.Enabled = $true }
    $script:lastExit = $script:proc.ExitCode
    $script:proc = $null
    $script:status = Get-Status
    Update-MetaLabels
}

$timer.Add_Tick({
    foreach ($l in (Read-NewLines)) { Show-Event $l }
    if ($script:proc -and $script:proc.HasExited) {
        Complete-Run
        if ($SelfTest) { return }
        if ($script:lastExit -eq 0 -and $script:lastMode -eq "install") {
            $r = [System.Windows.Forms.MessageBox]::Show("VRA est installé.`n`nOuvrir Claude Code maintenant ?", "Installation de VRA", "YesNo", "Information")
            if ($r -eq "Yes") { Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location `"$env:USERPROFILE`"; claude" }
        } elseif ($script:lastExit -ne 0) {
            [void][System.Windows.Forms.MessageBox]::Show("Terminé avec des erreurs : voir le journal (lignes ✖).", "Installation de VRA", "OK", "Warning")
        }
    }
})

function Start-Setup([string]$mode) {
    $agents = ($agentBoxes.Keys | Where-Object { $agentBoxes[$_].Checked }) -join ","
    if (-not $agents) { $agents = "none" }
    $argList = @("`"$SetupJs`"", "--json", "--agents=$agents")
    if ($mode -eq "dry") { $argList += "--dry-run" }
    if ($mode -eq "uninstall") { $argList += "--uninstall" }
    if ($mode -eq "install") {
        if ($optSim.Checked) { $argList += "--install-simulator" }
        if ($optDotnet.Checked) { $argList += "--dotnet" } else { $argList += "--no-dotnet" }
        if ($optTests.Checked) { $argList += "--full-tests" }
    }
    $script:lastMode = $mode
    $script:outFile = Join-Path $env:TEMP ("vra-setup-" + [guid]::NewGuid().ToString("N") + ".log")
    $script:offset = 0
    $errFile = $script:outFile + ".err"
    $log.Clear()
    $label = switch ($mode) { "install" { "installation" } "dry" { "simulation (rien n'est modifié)" } "uninstall" { "désinstallation" } }
    Add-Log ("Démarrage : " + $label) ([System.Drawing.Color]::Black)
    foreach ($b in @($btnInstall, $btnDry, $btnUninstall)) { $b.Enabled = $false }
    $progress.MarqueeAnimationSpeed = 30
    $script:proc = Start-Process -FilePath "node" -ArgumentList $argList -WorkingDirectory $Repo -RedirectStandardOutput $script:outFile -RedirectStandardError $errFile -WindowStyle Hidden -PassThru
    $null = $script:proc.Handle   # keeps ExitCode readable after exit (PowerShell 5.1)
    $timer.Start()
}

$btnInstall.Add_Click({ Start-Setup "install" })
$btnDry.Add_Click({ Start-Setup "dry" })
$btnUninstall.Add_Click({
    $r = [System.Windows.Forms.MessageBox]::Show("Retirer VRA des clients IA cochés ? (tes données VRA et les sauvegardes sont conservées)", "Installation de VRA", "YesNo", "Question")
    if ($r -eq "Yes") { Start-Setup "uninstall" }
})

Add-Log "Coche les clients IA, télécharge les logiciels Meta si besoin, puis clique sur « Installer / mettre à jour »." ([System.Drawing.Color]::Black)
Add-Log "« Simulation » montre ce qui serait fait sans rien modifier." ([System.Drawing.Color]::Gray)

if ($SelfTest) {
    # Test the interface without user interaction: window drawn off-screen, a dry run through the
    # same log-reading code, optional screenshot (VRA_SELFTEST_PNG), then the journal is printed.
    $form.StartPosition = "Manual"
    $form.Location = New-Object System.Drawing.Point(-4000, -4000)
    $form.ShowInTaskbar = $false
    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
    Start-Setup "dry"
    $deadline = (Get-Date).AddMinutes(5)
    while ($script:proc -and (Get-Date) -lt $deadline) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 100
        if ($script:proc -and $script:proc.HasExited) { Complete-Run }
    }
    [System.Windows.Forms.Application]::DoEvents()
    if ($env:VRA_SELFTEST_PNG) {
        $bmp = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
        $form.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
        $bmp.Save($env:VRA_SELFTEST_PNG, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
    }
    Write-Output ("controles=" + $form.Controls.Count + " clients=" + $agentBoxes.Count + " sortie=" + $script:lastExit)
    Write-Output $log.Text
    $form.Close()
    exit 0
}
[void]$form.ShowDialog()
