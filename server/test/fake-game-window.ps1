# Fake "game" window used to test VRA's game UI control: a title menu with buttons and a text box.
# Every action it receives is appended to the log file given as first argument. ASCII only.
param([string]$LogFile)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = "VRA Fake Game"
$form.Size = New-Object System.Drawing.Size(640, 420)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::White
$font = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
function Log([string]$s) { Add-Content -Path $LogFile -Value $s -Encoding UTF8 }
$y = 30
foreach ($label in @("NOUVELLE PARTIE", "OPTIONS", "QUITTER")) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $label
    $b.Font = $font
    $b.Size = New-Object System.Drawing.Size(380, 70)
    $b.Location = New-Object System.Drawing.Point(120, $y)
    $b.FlatStyle = "Flat"
    $b.Add_Click({ Log ("click:" + $this.Text) })
    $form.Controls.Add($b)
    $y += 85
}
$tb = New-Object System.Windows.Forms.TextBox
$tb.Font = New-Object System.Drawing.Font("Segoe UI", 14)
$tb.Size = New-Object System.Drawing.Size(380, 40)
$tb.Location = New-Object System.Drawing.Point(120, 290)
$tb.Add_KeyDown({ if ($_.KeyCode -eq "Enter") { Log ("enter:" + $tb.Text) } })
$form.Controls.Add($tb)
$form.KeyPreview = $true
$form.Add_KeyDown({ if ($_.KeyCode -eq "Escape") { Log "key:escape" } })
$form.Add_Shown({ Log "shown"; $form.Activate() })
[void]$form.ShowDialog()
