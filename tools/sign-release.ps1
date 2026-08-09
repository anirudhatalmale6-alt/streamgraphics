# StreamGraphics Pro - sign a release with Azure Artifact Signing.
#
#   .\sign-release.ps1                      signs Downloads\StreamGraphicsProSetup.exe
#   .\sign-release.ps1 -File C:\path\to.exe signs a specific file
#
# One command per release. Everything else (tool paths, config file, Azure sign-in)
# is worked out or repaired automatically each run.

param([string]$File = "$HOME\Downloads\StreamGraphicsProSetup.exe")

$ErrorActionPreference = 'Stop'
$tools = "$HOME\sgpro-tools"
$conf  = "$HOME\sgpro-signing.json"

function Fail($m) { Write-Host ""; Write-Host "STOPPED: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host ""; Write-Host "-> $m" -ForegroundColor Cyan }

if (-not (Test-Path $File)) { Fail "Can't find the file to sign:`n  $File`nDownload the installer first, or pass -File with the full path." }

# --- the two tools -----------------------------------------------------------
Step "Locating signing tools"
$st = Get-ChildItem "$tools\sdk" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1
$dl = Get-ChildItem "$tools\asx" -Recurse -Filter Azure.CodeSigning.Dlib.dll -ErrorAction SilentlyContinue |
      Select-Object -First 1

if (-not $st -or -not $dl) {
    Write-Host "   Tools missing - fetching them (one-time, ~30MB)..."
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    if (-not $st) {
        Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Windows.SDK.BuildTools" -OutFile "$tools\sdk.zip"
        Expand-Archive "$tools\sdk.zip" -DestinationPath "$tools\sdk" -Force
    }
    if (-not $dl) {
        Invoke-WebRequest "https://github.com/Azure/artifact-signing-clienttools/releases/download/v1.0.4/ArtifactSigningClientTools.msi" -OutFile "$tools\as.msi"
        Start-Process msiexec -ArgumentList '/a', "`"$tools\as.msi`"", '/qn', "TARGETDIR=`"$tools\asx`"" -Wait
    }
    $st = Get-ChildItem "$tools\sdk" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
          Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1
    $dl = Get-ChildItem "$tools\asx" -Recurse -Filter Azure.CodeSigning.Dlib.dll -ErrorAction SilentlyContinue |
          Select-Object -First 1
}
if (-not $st) { Fail "signtool.exe still missing under $tools\sdk" }
if (-not $dl) { Fail "Azure.CodeSigning.Dlib.dll still missing under $tools\asx" }
Write-Host "   signtool: $($st.FullName)"
Write-Host "   dlib:     $($dl.FullName)"

# --- config ------------------------------------------------------------------
# Rewritten every run with NO byte-order mark. The signing tool's JSON reader
# rejects a BOM, and PowerShell's -Encoding utf8 adds one - so we bypass it.
Step "Writing signing config (no BOM)"
$json = @'
{
  "Endpoint": "https://wus2.codesigning.azure.net",
  "CodeSigningAccountName": "streamgraphicspro",
  "CertificateProfileName": "streamgraphicspro-signing"
}
'@
[System.IO.File]::WriteAllText($conf, $json, (New-Object System.Text.UTF8Encoding($false)))

# --- Azure sign-in -----------------------------------------------------------
Step "Checking Azure sign-in"
$acct = (az account show 2>$null | Out-String)
if (-not $acct) {
    Write-Host "   Not signed in - opening browser. Use markn@manhattanbeachstudios.net"
    az login | Out-Null
    $acct = (az account show 2>$null | Out-String)
    if (-not $acct) { Fail "Azure sign-in didn't complete." }
}
Write-Host "   Signed in."

# --- sign --------------------------------------------------------------------
Step "Signing $([System.IO.Path]::GetFileName($File))"
& $st.FullName sign /v /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 `
    /dlib $dl.FullName /dmdf $conf $File
if ($LASTEXITCODE -ne 0) { Fail "Signing failed (exit $LASTEXITCODE). Send the output above." }

# --- verify ------------------------------------------------------------------
Step "Verifying the signature"
& $st.FullName verify /pa /v $File
if ($LASTEXITCODE -ne 0) { Fail "Signed, but verification failed - don't upload this one." }

Write-Host ""
Write-Host "DONE - signed and verified." -ForegroundColor Green
Write-Host "Upload this file to public_html/download on the website:" -ForegroundColor Green
Write-Host "  $File"
Write-Host ""
