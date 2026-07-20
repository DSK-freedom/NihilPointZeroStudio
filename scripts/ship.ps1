# NIHILPOINTZERO-OS ship pipeline: test -> build -> deploy to Desktop studio -> push to GitHub.
# Run via `npm run ship`. Stops loudly at the first failed step.
# SAFETY: never touches nihilpointzero-data (the user's work) - it only copies
# the two exes and the four doc files into the studio folder.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$studio = Join-Path ([Environment]::GetFolderPath('Desktop')) 'NihilPointZeroStudio'
if (-not (Test-Path $studio)) { throw "Desktop studio folder not found: $studio" }

function Step([string]$name, [scriptblock]$block) {
    Write-Host "==> $name" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE) { throw "FAILED: $name (exit $LASTEXITCODE)" }
}

Step 'Tests' { npm run test }

Step 'Build (portable + installer)' { npm run dist:win }

Step 'Deploy exes to Desktop studio' {
    Copy-Item (Join-Path $repo 'release\NIHILPOINTZERO-OS-portable.exe') $studio -Force
    Copy-Item (Join-Path $repo 'release\NIHILPOINTZERO-OS-setup.exe')    $studio -Force
}

Step 'Deploy docs to Desktop studio' {
    foreach ($doc in 'HOW-TO-USE.txt', 'NIHILPOINTZERO-GUIDE.txt',
                     'NIHILPOINTZERO-CHEATSHEET.txt', 'MEGA-DIAGNOSTIC-REPORT.md') {
        Copy-Item (Join-Path $repo "docs\$doc") $studio -Force
    }
}

Step 'Push to GitHub' {
    git add -A
    if (git status --porcelain) {
        git commit -m ("Ship " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
    }
    git push
}

$ver  = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$hash = git rev-parse --short HEAD
Write-Host ''
Write-Host "SHIPPED OK  v$ver - $hash" -ForegroundColor Green
Write-Host "  Desktop studio updated: $studio"
Write-Host '  GitHub updated: push complete'
Write-Host '  REMINDER: run NIHILPOINTZERO-OS-setup.exe once (one click) to update the INSTALLED app.' -ForegroundColor Yellow
