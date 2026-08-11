# StreamGraphics Pro - sign a release with Azure Artifact Signing.
#
#   .\sign-release.ps1                      signs the NEWEST installer in your Downloads folder
#   .\sign-release.ps1 -File C:\path\to.exe signs a specific file
#
# One command per release. Everything else (tool paths, config file, Azure sign-in)
# is worked out or repaired automatically each run.

param([string]$File)

$ErrorActionPreference = 'Stop'
$tools = "$HOME\sgpro-tools"
$conf  = "$HOME\sgpro-signing.json"

function Fail($m) { Write-Host ""; Write-Host "STOPPED: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host ""; Write-Host "-> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "   $m" -ForegroundColor Yellow }

# --- which file -------------------------------------------------------------
# Downloading the installer twice does NOT overwrite it: Windows keeps the first one and saves
# the new one as "StreamGraphicsProSetup (1).exe". A fixed default path therefore signs the OLD
# download while the new one sits there untouched - you get a cheerful "signed and verified" and
# an unsigned installer. So take the NEWEST matching file, and say out loud which one it is.
Step "Finding the installer"
if (-not $File) {
    $dl = Join-Path $HOME 'Downloads'
    $cands = @(Get-ChildItem $dl -Filter 'StreamGraphicsProSetup*.exe' -File -ErrorAction SilentlyContinue |
               Sort-Object LastWriteTime -Descending)
    if ($cands.Count -eq 0) {
        Fail "No StreamGraphicsProSetup*.exe in $dl`nDownload the installer first, or pass -File with the full path."
    }
    $File = $cands[0].FullName
    if ($cands.Count -gt 1) {
        Warn "$($cands.Count) installers in Downloads - using the newest. The others are older downloads:"
        $cands | Select-Object -Skip 1 | ForEach-Object {
            Write-Host ("     {0}   {1}" -f $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'), $_.Name)
        }
    }
}
if (-not (Test-Path $File)) { Fail "Can't find the file to sign:`n  $File" }

$item = Get-Item $File
$ver  = $item.VersionInfo.ProductVersion
Write-Host ("   {0}" -f $item.FullName)
Write-Host ("   version {0}   {1:N0} bytes   downloaded {2}" -f `
            $(if ($ver) { $ver } else { 'unknown' }), $item.Length,
            $item.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))

# Already signed? Worth knowing before rather than after - it usually means the wrong file.
$existing = (Get-AuthenticodeSignature $File).Status
if ($existing -eq 'Valid') { Warn "Heads up: this file is ALREADY signed. Signing it again is harmless." }

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

# --- Azure CLI ---------------------------------------------------------------
# A computer you've never signed from won't have this, and without the check the
# script died on a raw "'az' is not recognized" error instead of just fixing it.
Step "Checking the Azure CLI"
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "   Not on this computer yet - installing it (one-time, a minute or two)..."
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail "The Azure CLI isn't installed and winget isn't available to install it.`nInstall it by hand from https://aka.ms/installazurecliwindows then run this again."
    }
    winget install -e --id Microsoft.AzureCLI --accept-package-agreements --accept-source-agreements
    # winget doesn't touch the PATH of the window it was run from - pick it up ourselves.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        Fail "Azure CLI is installed, but this window still can't see it.`nClose PowerShell, open a new one, and run this script again - that's all it needs."
    }
}
Write-Host "   Azure CLI present."

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

# Prove it on the finished file, using Windows' own check rather than signtool's - this is the
# same answer Explorer's Properties tab and SmartScreen will give.
$sig = Get-AuthenticodeSignature $File
if ($sig.Status -ne 'Valid') { Fail "Signed, but Windows still reports '$($sig.Status)' - do not upload this one." }

Write-Host ""
Write-Host "DONE - signed and verified." -ForegroundColor Green
Write-Host ("  signer   {0}" -f $sig.SignerCertificate.Subject)
Write-Host ("  version  {0}" -f $(if ($ver) { $ver } else { 'unknown' }))
Write-Host ("  sha256   {0}" -f (Get-FileHash $File -Algorithm SHA256).Hash.ToLower())
Write-Host ""
Write-Host "UPLOAD EXACTLY THIS FILE to public_html/download on the website:" -ForegroundColor Green
Write-Host "  $File" -ForegroundColor Green
Write-Host ""
Write-Host "If Downloads has several StreamGraphicsProSetup files, that path above is the signed"
Write-Host "one - the others are older and unsigned. Check the name matches before you upload."
Write-Host ""
