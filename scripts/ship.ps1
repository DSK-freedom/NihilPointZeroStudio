# NIHILPOINTZERO-OS ship pipeline: test -> build -> deploy to Desktop studio
# -> push to GitHub -> refresh the GitHub release downloads.
# Run via `npm run ship`. Stops loudly at the first failed step.
# SAFETY: never touches nihilpointzero-data (the user's work) - it only copies
# the two exes and the four doc files into the studio folder.
# The release step keeps ONE rolling release (tag 'latest') whose assets are
# replaced on every ship, so the README's /releases/latest/download/... links
# always serve the newest build. Auth reuses the git credential store (GCM);
# the token is never written to disk or shown.

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

# Build identity: the doc stamp carries version + date-time; the sidebar badge carries the
# same PLUS the git hash. The hash can only be truthful if the ship commit exists BEFORE
# the build, so the order is: stamp doc -> commit -> compute badge from HEAD -> build.
# (A commit can never contain its own hash, which is why the doc line carries no hash.)
$ver = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$dot = [char]0x00B7  # the badge's middle-dot separator, kept out of this file's literal text
$stamp = "v$ver $dot $(Get-Date -Format 'yyyy-MM-dd HH:mm')"

Step 'Stamp build identity into the diagnostic report' {
    # Keeps the doc's "## Build:" line matching the sidebar badge's version+date prefix,
    # so comparing the two remains a valid staleness check.
    $doc = Join-Path $repo 'docs\MEGA-DIAGNOSTIC-REPORT.md'
    $txt = [IO.File]::ReadAllText($doc)
    $txt = $txt -replace '(?m)^## Build: .*$', "## Build: $stamp"
    [IO.File]::WriteAllText($doc, $txt, [Text.UTF8Encoding]::new($false))
    $global:LASTEXITCODE = 0
}

Step 'Commit source (so the badge hash names the code actually built)' {
    # Committing BEFORE the build lets the badge carry THIS commit's hash. Previously the
    # hash was read before the ship commit existed, so the badge always named the PREVIOUS
    # ship's commit (one behind) - which misled anyone comparing it against git log.
    git add -A
    if ($LASTEXITCODE) { throw 'git add failed - fix the reported git error and re-ship' }
    if (git status --porcelain) {
        git commit -m ("Ship " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
        # A masked commit failure would silently rebuild the old one-behind badge bug AND
        # ship code that exists in no commit - keep this check loud.
        if ($LASTEXITCODE) { throw 'git commit failed - fix the reported git error and re-ship' }
    }
    $global:LASTEXITCODE = 0
}

$buildTag = "$stamp $dot $(git rev-parse --short HEAD)"
$env:NPZ_BUILD_TAG = $buildTag

Step 'Verify NSIS tooling (self-heal after antivirus quarantine)' {
    # COMODO/Defender sometimes silently quarantine makensis.exe from the electron-builder
    # cache (a classic NSIS false positive) -> the build dies with "spawn UNKNOWN".
    # If the exe is missing but a stale cache dir remains, rename it aside (never delete)
    # so electron-builder re-downloads a fresh copy. The durable fix is an antivirus
    # exclusion for %LOCALAPPDATA%\electron-builder\Cache - only the user can add that.
    $nsisRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis'
    if (Test-Path $nsisRoot) {
        $mk = Get-ChildItem $nsisRoot -Recurse -Filter 'makensis.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $mk) {
            $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
            Get-ChildItem $nsisRoot -Directory | ForEach-Object {
                Rename-Item $_.FullName "$($_.Name).quarantined-$stamp.bak"
                Write-Host "  NSIS cache '$($_.Name)' was incomplete (antivirus?) - set aside for re-download" -ForegroundColor Yellow
            }
        }
    }
    $global:LASTEXITCODE = 0
}

Step 'Clear previous build artifacts' {
    # NSIS fails with "Can't open output file" if an old exe is momentarily
    # locked (e.g. antivirus scan). Deleting first surfaces the lock early,
    # with a retry to ride out a scan in progress.
    foreach ($exe in 'NIHILPOINTZERO-OS-portable.exe', 'NIHILPOINTZERO-OS-setup.exe') {
        $p = Join-Path $repo "release\$exe"
        if (Test-Path $p) {
            try { Remove-Item $p -Force -ErrorAction Stop }
            catch { Start-Sleep -Seconds 5; Remove-Item $p -Force -ErrorAction Stop }
        }
    }
}

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
    # The setup guide lives at the repo root (it covers building from source too).
    Copy-Item (Join-Path $repo 'SETUP_GUIDE.md') $studio -Force
}

Step 'Push to GitHub' {
    # The ship commit was already made before the build (see above); nothing tracked
    # changes during build/deploy (build outputs are gitignored), so this is push-only.
    git push
}

Step 'Update GitHub release downloads' {
    $gh   = 'DSKJazz/NihilPointZeroStudio'
    $tag  = 'latest'

    # Token from the git credential store (same auth git push just used).
    # Piping into git from PowerShell can mangle encoding, so feed exact bytes.
    $q = Join-Path $env:TEMP 'npz-cred-query.txt'   # contains no secrets
    [IO.File]::WriteAllBytes($q, [Text.Encoding]::ASCII.GetBytes("protocol=https`nhost=github.com`n`n"))
    $credOut = cmd /c "git credential fill < `"$q`""
    Remove-Item $q -Force
    $token = ''
    foreach ($line in $credOut) { if ($line -like 'password=*') { $token = $line.Substring(9) } }
    if (-not $token) { throw 'No GitHub credential available - run any git push once to sign in, then re-ship.' }
    $hdr = @{ Authorization = "Bearer $token"; 'User-Agent' = 'npz-ship'; Accept = 'application/vnd.github+json' }

    $body = @"
**This is always the newest version.** Build $buildTag

| You are on... | Download | Notes |
|---|---|---|
| A Windows PC (normal use) | **NIHILPOINTZERO-OS-setup.exe** | Installs the app with a desktop shortcut |
| A Windows PC, no install wanted | **NIHILPOINTZERO-OS-portable.exe** | Single file, keeps data in a folder next to itself |
| A phone or tablet | (guides below only) | The app itself runs on Windows PCs only |

If Windows shows "Windows protected your PC": click **More info -> Run anyway** (the app is not code-signed yet).
"@

    # JSON bodies must be sent as UTF-8 BYTES, built INLINE at each call site: a plain
    # string body gets encoded as ISO-8859-1 (breaks on the build tag's middle-dot), and
    # a helper FUNCTION returning byte[] gets pipeline-unrolled into loose numbers —
    # GitHub then sees "123" (the byte for '{') instead of JSON. Inline expressions
    # avoid both traps.

    # Get or create the single rolling release.
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$gh/releases/tags/$tag" -Headers $hdr
    } catch {
        $newJson = @{ tag_name = $tag; name = 'Download NIHILPOINTZERO-OS (always the newest version)'
                      body = $body; draft = $false; prerelease = $false } | ConvertTo-Json
        $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$gh/releases" -Headers $hdr `
            -Body ([Text.Encoding]::UTF8.GetBytes($newJson)) -ContentType 'application/json; charset=utf-8'
    }

    # Keep the 'latest' tag on the commit we just pushed (cosmetic but honest).
    $sha = (git rev-parse HEAD).Trim()
    try {
        Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$gh/git/refs/tags/$tag" -Headers $hdr `
            -Body ([Text.Encoding]::UTF8.GetBytes((@{ sha = $sha; force = $true } | ConvertTo-Json))) `
            -ContentType 'application/json; charset=utf-8' | Out-Null
    } catch { Write-Host '  (tag pointer not moved - harmless)' -ForegroundColor DarkGray }

    # Refresh release title/body with the new version stamp.
    $patchJson = @{ name = 'Download NIHILPOINTZERO-OS (always the newest version)'; body = $body } | ConvertTo-Json
    Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$gh/releases/$($rel.id)" -Headers $hdr `
        -Body ([Text.Encoding]::UTF8.GetBytes($patchJson)) -ContentType 'application/json; charset=utf-8' | Out-Null

    # Replace assets: the two exes + the four plain-English docs.
    $assets = @(
        (Join-Path $repo 'release\NIHILPOINTZERO-OS-setup.exe'),
        (Join-Path $repo 'release\NIHILPOINTZERO-OS-portable.exe'),
        (Join-Path $repo 'docs\HOW-TO-USE.txt'),
        (Join-Path $repo 'docs\NIHILPOINTZERO-GUIDE.txt'),
        (Join-Path $repo 'docs\NIHILPOINTZERO-CHEATSHEET.txt'),
        (Join-Path $repo 'docs\MEGA-DIAGNOSTIC-REPORT.md'),
        (Join-Path $repo 'SETUP_GUIDE.md')
    )
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$gh/releases/$($rel.id)/assets" -Headers $hdr
    Add-Type -AssemblyName System.Net.Http
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromMinutes(60)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('npz-ship')
    $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)
    try {
        foreach ($path in $assets) {
            $name = Split-Path $path -Leaf
            $old = $existing | Where-Object { $_.name -eq $name }
            if ($old) { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$gh/releases/assets/$($old.id)" -Headers $hdr | Out-Null }
            $mb = [math]::Round((Get-Item $path).Length / 1MB, 1)
            Write-Host "  uploading $name ($mb MB)..." -ForegroundColor DarkCyan
            $fs = [IO.File]::OpenRead($path)
            try {
                $content = New-Object System.Net.Http.StreamContent($fs)
                $content.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
                $up = "https://uploads.github.com/repos/$gh/releases/$($rel.id)/assets?name=$([uri]::EscapeDataString($name))"
                $resp = $client.PostAsync($up, $content).GetAwaiter().GetResult()
                if (-not $resp.IsSuccessStatusCode) {
                    throw "Upload of $name failed: $($resp.StatusCode) $($resp.Content.ReadAsStringAsync().GetAwaiter().GetResult())"
                }
            } finally { $fs.Dispose() }
        }
    } finally { $client.Dispose() }
    $global:LASTEXITCODE = 0
}

Write-Host ''
Write-Host "SHIPPED OK  $buildTag" -ForegroundColor Green
Write-Host "  Desktop studio updated: $studio"
Write-Host '  GitHub updated: push complete'
Write-Host '  Download page updated: https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest'
Write-Host '  REMINDER: run NIHILPOINTZERO-OS-setup.exe once (one click) to update the INSTALLED app.' -ForegroundColor Yellow
