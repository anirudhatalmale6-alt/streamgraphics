# StreamGraphics Pro - copy the Companion module into the Bitfocus repository.
#
#   .\push-to-bitfocus.ps1
#
# Bitfocus have created an empty repository for the module. This puts the code and the
# version tag into it. Nothing on this computer is changed apart from a working folder
# it makes and removes itself; the module source is downloaded fresh each run, so there
# is nothing to keep tidy and nothing to get out of date.
#
# Run it as many times as you like - a re-run just copies whatever is newest.

# 🚨 NOT 'Stop'. git, gh and winget all write ordinary progress to stderr and report failure
# through an exit code. With ErrorActionPreference = Stop, Windows PowerShell turns both of
# those into TERMINATING errors - so a command that is SUPPOSED to fail, like asking gh whether
# we are signed in yet, kills the script before its exit code can be read. That is exactly what
# happened on the first version of this script: it died on "gh auth status" with a
# NativeCommandError instead of going on to sign in. Every external command below is checked by
# its exit code, which is the thing that actually means failure.
$ErrorActionPreference = 'Continue'
# PowerShell 7.3+ has its own switch for the same trap. Absent on Windows PowerShell 5.1, where
# assigning to it is harmless.
$PSNativeCommandUseErrorActionPreference = $false

$Source = 'https://github.com/moishe64/companion-module-streamgraphics-pro.git'
$Target = 'https://github.com/bitfocus/companion-module-manhattanbeachstudios-streamgraphicspro.git'
$Work   = Join-Path $env:TEMP 'sgp-bitfocus-push'

function Fail($m) { Write-Host ""; Write-Host "STOPPED: $m" -ForegroundColor Red; exit 1 }
function Step($m) { Write-Host ""; Write-Host "-> $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "   $m" -ForegroundColor Yellow }
function Done($m) { Write-Host "   $m" -ForegroundColor Green }

# winget installs do NOT touch the PATH of the window they were run from, so a freshly
# installed tool is invisible until we pick the PATH up ourselves.
function Reload-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Require-Tool($exe, $wingetId, $friendly, $manualUrl) {
    if (Get-Command $exe -ErrorAction SilentlyContinue) { Done "$friendly is already installed."; return }
    Step "Installing $friendly"
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail "$friendly isn't installed and winget isn't available to install it.`nInstall it by hand from $manualUrl then run this again."
    }
    winget install -e --id $wingetId --accept-package-agreements --accept-source-agreements
    Reload-Path
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
        Fail "$friendly was installed but this window still can't see it.`nClose PowerShell, open a new one, and run this script again."
    }
    Done "$friendly installed."
}

# --- tools ------------------------------------------------------------------
Require-Tool git 'Git.Git'      'Git'            'https://git-scm.com/download/win'
Require-Tool gh  'GitHub.cli'   'the GitHub CLI' 'https://cli.github.com'

# --- sign in ----------------------------------------------------------------
# The GitHub CLI signs in through your browser, so there is no password or token to
# create or paste anywhere. It also becomes what git uses to prove who you are, which
# is why the push below needs nothing else.
# Being signed in to github.com in your BROWSER is not the same thing as the GitHub CLI being
# signed in - they are separate. This is the step that connects the two, and the first run has
# to do it. Non-zero here just means "not signed in yet", which is why the script must not
# treat it as a crash.
Step "Signing in to GitHub"
gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    Warn "The GitHub CLI hasn't been signed in on this computer yet."
    Warn "A browser window will open. Sign in as moishe64, then come back to this window."
    gh auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) { Fail "Sign-in didn't complete. Run the script again to have another go." }
}
gh auth setup-git --hostname github.com
if ($LASTEXITCODE -ne 0) { Fail "Signed in, but the GitHub CLI couldn't hand its sign-in over to git." }
$who = (gh api user --jq '.login' 2>$null)
if (-not $who) { Fail "Signed in, but GitHub won't say who you are. Run 'gh auth login' on its own and try again." }
Done "Signed in as $who."
if ($who -ne 'moishe64') {
    Warn "That isn't the moishe64 account. If the push is refused further down, that is why -"
    Warn "run 'gh auth logout' and then this script again to sign in as moishe64."
}

# --- working folder ---------------------------------------------------------
# Only ever remove a folder this script made, and only after checking it is that folder.
Step "Preparing a working folder"
if (Test-Path $Work) {
    $isOurs = $false
    if (Test-Path (Join-Path $Work '.git')) {
        $existing = (git -C $Work remote get-url origin 2>$null)
        if ($existing -eq $Source) { $isOurs = $true }
    }
    if (-not $isOurs) {
        Fail "There is already a folder at`n  $Work`nand it isn't one this script made. Have a look at it, move or delete it yourself, then run this again."
    }
    try { Remove-Item -Recurse -Force $Work -ErrorAction Stop }
    catch { Fail "Couldn't clear the old working folder at`n  $Work`nClose anything that has it open, or delete it yourself, then run this again." }
}
Done $Work

# --- get the module ---------------------------------------------------------
Step "Downloading the module"
git clone --quiet $Source $Work
if ($LASTEXITCODE -ne 0) { Fail "Couldn't download the module from`n  $Source" }
$tag = (git -C $Work describe --tags --abbrev=0 2>$null)
if (-not $tag) { Fail "The module has no version tag, so there is nothing for Bitfocus to build." }
Done "Got the module, newest version tag is $tag."

# --- copy it into the Bitfocus repository -----------------------------------
Step "Copying it into the Bitfocus repository"
git -C $Work remote add bitfocus $Target
git -C $Work push bitfocus main
if ($LASTEXITCODE -ne 0) {
    Fail @"
The push was refused.

The usual reason is that your GitHub account hasn't been given write access to
  bitfocus/companion-module-manhattanbeachstudios-streamgraphicspro
yet. Bitfocus normally send an invitation - check github.com/notifications and your
GitHub e-mail for an invite to join the repository, accept it, then run this again.
"@
}
git -C $Work push bitfocus $tag
if ($LASTEXITCODE -ne 0) { Fail "The code went across but the version tag $tag did not. Run the script again." }
Done "Code and tag $tag are now in the Bitfocus repository."

# --- tidy up ----------------------------------------------------------------
Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
Write-Host ""
Write-Host "  1. Open  https://github.com/bitfocus/companion-module-manhattanbeachstudios-streamgraphicspro"
Write-Host "     The files should be there now. A tick or a cross appears next to the newest"
Write-Host "     commit within a couple of minutes - that is Bitfocus's own build checking it."
Write-Host "     Send me a picture of a cross and I'll deal with it."
Write-Host ""
Write-Host "  2. Then go to  https://developer.bitfocus.io  and sign in with GitHub."
Write-Host "     My Connections -> StreamGraphics Pro -> Submit Version -> choose $tag."
Write-Host ""
