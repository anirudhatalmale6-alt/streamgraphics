# StreamGraphics Pro - check an installation and say what is wrong with it in plain English.
#
#   powershell -ExecutionPolicy Bypass -File "$HOME\check-install.ps1"
#
# Read-only. It changes nothing on the computer - it just looks and reports.

$ErrorActionPreference = 'SilentlyContinue'
$app  = "$env:LOCALAPPDATA\StreamGraphics Pro"
$bad  = @()

function Title($t) { Write-Host ""; Write-Host $t -ForegroundColor Cyan }
function Good($t)  { Write-Host "   OK   $t" -ForegroundColor Green }
function Bad($t)   { Write-Host "   BAD  $t" -ForegroundColor Red }

Write-Host ""
Write-Host "StreamGraphics Pro - installation check" -ForegroundColor White
Write-Host "=======================================" -ForegroundColor White

# --- the installed folder ----------------------------------------------------
Title "1. Program folder"
Write-Host "   $app"
if (-not (Test-Path $app)) {
    Bad "That folder does not exist - the app is not installed for this user."
    $bad += "not installed"
} else {
    Good "Folder is there."
    $pkg = Join-Path $app "package.json"
    if (Test-Path $pkg) {
        $v = (Get-Content $pkg -Raw | ConvertFrom-Json).version
        Write-Host "   Installed version: $v"
    } else {
        Bad "package.json is missing - the install is incomplete."
        $bad += "incomplete install"
    }
}

# --- the files that must be there -------------------------------------------
Title "2. Files the app needs"
$need = @(
    "StreamGraphics Pro.exe",
    "sgpro-engine.exe",
    "server.js",
    "StreamGraphics Pro.vbs",
    "assets\streamgraphics.ico"
)
foreach ($f in $need) {
    $p = Join-Path $app $f
    if (Test-Path $p) {
        $kb = [math]::Round((Get-Item $p).Length / 1KB)
        Good ("{0,-28} {1} KB" -f $f, $kb)
    } else {
        Bad  ("{0,-28} MISSING" -f $f)
        $bad += $f
    }
}

# --- the shortcuts -----------------------------------------------------------
Title "3. Shortcuts"
$sh = New-Object -ComObject WScript.Shell
$links = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "StreamGraphics Pro.lnk"),
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\StreamGraphics Pro\StreamGraphics Pro.lnk"
)
foreach ($lnk in $links) {
    Write-Host "   $lnk"
    if (-not (Test-Path $lnk)) {
        Bad "   shortcut is not there"
        $bad += "missing shortcut"
        continue
    }
    $s = $sh.CreateShortcut($lnk)
    Write-Host "      points at: $($s.TargetPath)"
    Write-Host "      icon:      $($s.IconLocation)"
    if (Test-Path $s.TargetPath) { Good "   what it points at exists" }
    else { Bad "   BROKEN - what it points at is gone"; $bad += "broken shortcut" }
    $ic = ($s.IconLocation -split ',')[0]
    if ($ic -and (Test-Path $ic)) { Good "   icon file exists" }
    elseif ($ic) { Bad "   icon file is gone - that is why you see a blank icon"; $bad += "missing icon file" }
}

# --- did the antivirus eat something? ---------------------------------------
Title "4. Windows Security history"
$hits = @()
foreach ($t in (Get-MpThreatDetection)) {
    $r = ($t.Resources -join ' ')
    if ($r -match 'StreamGraphics|sgpro') { $hits += "$($t.InitialDetectionTime)  $r" }
}
if ($hits.Count -gt 0) {
    Bad "Windows Security has acted on StreamGraphics files:"
    $hits | Select-Object -Last 6 | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
    $bad += "antivirus removed a file"
} else {
    Good "Nothing about StreamGraphics in the threat history."
    Write-Host "   (If this computer uses antivirus other than Windows Defender," -ForegroundColor DarkGray
    Write-Host "    check that program's quarantine list by hand.)" -ForegroundColor DarkGray
}

# --- verdict -----------------------------------------------------------------
Title "WHAT THIS MEANS"
if ($bad.Count -eq 0) {
    Write-Host "   Everything is where it should be." -ForegroundColor Green
    Write-Host "   If the desktop icon still looks blank, it is Windows' icon cache."
    Write-Host "   Restart the computer once and it will correct itself."
} else {
    Write-Host "   Problems found:" -ForegroundColor Red
    $bad | Select-Object -Unique | ForEach-Object { Write-Host "     - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "   Send me this whole window and I will tell you exactly what to do."
}
Write-Host ""
