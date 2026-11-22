# XOD 3.0 sanitized single-snapshot publisher. Windows PowerShell 5.1+.
# Run only after verifying this file's Git blob SHA. Never modifies the original Codex checkout.
$ErrorActionPreference = 'Stop'

function Assert-Native([string]$label) {
    if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)" }
}
function Checked-Hash([string]$path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

try {
    Write-Host 'XOD-PUBLISH START'
    $docs = [Environment]::GetFolderPath('MyDocuments')
    $source = Join-Path $docs 'Codex\2026-11-18\xod-holst\work\xod-3.0-release'
    $root = Join-Path $docs 'xod-private-rebuilt-29f4bf9\xod-test13-source'
    $zip = Join-Path $HOME 'Downloads\XOD-Test13-source-6429ad6.zip'
    $git = 'C:\Program Files\Git\cmd\git.exe'
    $target = 'https://github.com/PodkinDmitry/xod-private.git'
    $expected = '29f4bf9a2b6655f60d8877cf21fe604e51254ca7'
    $base = '542ddd0b5190ecc12524348f6493b89e4d2ecb1e'
    $updated = @('tests/live_delivery_acceptance.py', 'v224/m_mark224.js')
    $manifest = Join-Path $root 'SOURCE_SHA256SUMS.txt'
    $provenance = Join-Path $root 'SOURCE_PROVENANCE.json'
    $utf8 = [Text.UTF8Encoding]::new($false)
    $repoGit = Join-Path $root '.git'

    Write-Host '1/6 Verify source and baseline archive'
    foreach ($f in @($source, $root, $zip, $git)) {
        if (!(Test-Path -LiteralPath $f)) { throw "Missing expected path: $f" }
    }
    if ((Checked-Hash $zip) -ne 'a7f1f7e7ae1903ab524f19aea450d0329dbcde1bd6fb234ba8fc4be7d40cf9c4') {
        throw 'Baseline ZIP digest mismatch'
    }
    $sourceHead = (& $git -c "safe.directory=$source" -C $source rev-parse HEAD).Trim()
    Assert-Native 'Read source HEAD'
    if ($sourceHead -ne $expected) { throw 'Original source HEAD has changed' }
    $sourceStatus = @(& $git -c "safe.directory=$source" -C $source status --porcelain --untracked-files=no)
    Assert-Native 'Check original source state'
    if ($sourceStatus.Count -gt 0) { throw 'Tracked modifications exist in original checkout' }
    $delta = @(& $git -c "safe.directory=$source" -C $source diff --name-only --no-renames $base $expected)
    Assert-Native 'Read source delta'
    if ((($delta | Sort-Object) -join '|') -ne (($updated | Sort-Object) -join '|')) {
        throw "Unexpected source delta: $($delta -join ', ')"
    }

    # Resume a completed sanitized Git commit without recopying files. Never rewrite it.
    if (Test-Path -LiteralPath $repoGit) {
        Write-Host 'Existing export Git detected: verification and safe retry only'
        $commitCount = @(& $git -C $root rev-list --count HEAD)
        Assert-Native 'Read existing export history'
        $subject = (& $git -C $root log -1 --format=%s).Trim()
        Assert-Native 'Read export commit message'
        if ($commitCount[0] -ne '1' -or $subject -ne 'Import sanitized integrated XOD 3.0 at 29f4bf9') {
            throw 'Existing Git history is not the expected one-commit sanitized snapshot'
        }
        $tracked = @(& $git -C $root ls-files)
        Assert-Native 'Read export tracked files'
        if ($tracked.Count -ne 433) { throw "Export should track 433 files, found $($tracked.Count)" }
        $existingChanges = @(& $git -C $root status --porcelain --untracked-files=no)
        Assert-Native 'Check export tree'
        if ($existingChanges.Count -gt 0) { throw 'Export tracked files have changed' }
    } else {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($zip)
        try {
            $entry = $archive.GetEntry('xod-test13-source/SOURCE_SHA256SUMS.txt')
            if ($null -eq $entry) { throw 'Missing original checksum manifest in ZIP' }
            $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
            try { $rows = @($reader.ReadToEnd() -split '\r?\n' | Where-Object { $_ }) }
            finally { $reader.Dispose() }
        } finally { $archive.Dispose() }
        if ($rows.Count -ne 431) { throw "Expected 431 original checksum rows, found $($rows.Count)" }

        Write-Host '2/6 Verify copied source, without trusting its existing manifest'
        $names = @()
        foreach ($line in $rows) {
            if ($line -notmatch '^([0-9a-fA-F]{64})  (.+)$') { throw 'Invalid original checksum entry' }
            $digest = $Matches[1].ToLowerInvariant()
            $rel = $Matches[2]
            $names += $rel
            if ($rel -eq 'v224/m_mark224.js') { continue }
            $f = Join-Path $root ($rel.Replace('/', '\'))
            if (!(Test-Path -LiteralPath $f -PathType Leaf) -or (Checked-Hash $f) -ne $digest) {
                throw "Copied baseline mismatch: $rel"
            }
        }
        foreach ($rel in $updated) {
            $p = $rel.Replace('/', '\')
            $orig = Join-Path $source $p
            $copy = Join-Path $root $p
            if (!(Test-Path -LiteralPath $orig -PathType Leaf) -or !(Test-Path -LiteralPath $copy -PathType Leaf)) {
                throw "Missing current source file: $rel"
            }
            if ((Checked-Hash $orig) -ne (Checked-Hash $copy)) { throw "Updated file differs: $rel" }
            $body = [IO.File]::ReadAllText($copy)
            if ($body -match '(?i)ghp_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Z]:\\Users\\|@gmail\.com|@yandex\.ru') {
                throw "Potential personal data or credentials in updated file: $rel"
            }
        }
        $actual = @(Get-ChildItem -LiteralPath $root -Recurse -Force -File | ForEach-Object {
            $_.FullName.Substring($root.Length + 1).Replace('\', '/')
        })
        $allowed = @($names) + @('SOURCE_SHA256SUMS.txt', 'tests/live_delivery_acceptance.py')
        if ($actual.Count -ne 433 -or @($actual | Where-Object { $_ -notin $allowed }).Count -gt 0) {
            throw 'Unexpected file count or names in sanitized export'
        }
        if (!(Test-Path -LiteralPath $provenance -PathType Leaf)) { throw 'Missing SOURCE_PROVENANCE.json' }
        if (!(Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'Missing SOURCE_SHA256SUMS.txt' }

        Write-Host '3/6 Update provenance and checksum manifest'
        $meta = Get-Content -LiteralPath $provenance -Encoding UTF8 -Raw | ConvertFrom-Json
        if ($meta.original_local_commit -ne $base) { throw 'Incorrect baseline provenance commit' }
        $meta | Add-Member -NotePropertyName post_clean_source_commit -NotePropertyValue $expected -Force
        $meta | Add-Member -NotePropertyName post_clean_changed_paths -NotePropertyValue $updated -Force
        [IO.File]::WriteAllText($provenance, (($meta | ConvertTo-Json -Depth 40) + [Environment]::NewLine), $utf8)
        $entries = @(Get-ChildItem -LiteralPath $root -Recurse -Force -File |
            Where-Object { $_.FullName -ne $manifest } | Sort-Object FullName | ForEach-Object {
                (Checked-Hash $_.FullName) + '  ' + $_.FullName.Substring($root.Length + 1).Replace('\', '/')
            })
        if ($entries.Count -ne 432) { throw "Expected 432 checksum entries, found $($entries.Count)" }
        [IO.File]::WriteAllText($manifest, (($entries -join [Environment]::NewLine) + [Environment]::NewLine), $utf8)

        Write-Host '4/6 Create private-migration single-root Git history'
        & $git -C $root init -b release/xod-3.0
        Assert-Native 'Git init'
        & $git -C $root add --all
        Assert-Native 'Git add'
        $tracked = @(& $git -C $root ls-files)
        Assert-Native 'Read staged file list'
        if ($tracked.Count -ne 433) { throw "Expected 433 tracked files, found $($tracked.Count)" }
        & $git -C $root -c 'user.name=XOD Source Migration' -c 'user.email=xod-migration@users.noreply.github.com' commit -m 'Import sanitized integrated XOD 3.0 at 29f4bf9'
        Assert-Native 'Git commit'
    }

    Write-Host '5/6 Verify source safety and build'
    $gate = Join-Path $env:TEMP 'xod-source-gate-pinned.py'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/PodkinDmitry/holst/ai-workspace/ai-workspace/tools/xod-source-gate.py' -OutFile $gate
    $gateHash = (& $git hash-object $gate).Trim()
    Assert-Native 'Verify source gate'
    if ($gateHash -ne 'f9537b955a8b7a8694865c5fdc337e19b5178048') {
        throw 'Source gate code does not match its approved Git blob SHA'
    }
    & python $gate --repo $root --max-blob-mb 6
    Assert-Native 'Source safety gate'
    Push-Location $root
    try {
        & python build.py dist
        Assert-Native 'Build XOD'
    } finally {
        Pop-Location
    }
    $changedAfterBuild = @(& $git -C $root status --porcelain --untracked-files=no)
    Assert-Native 'Check post-build tracked files'
    if ($changedAfterBuild.Count -gt 0) { throw 'Build changed tracked files; no push' }

    Write-Host '6/6 Push sanitized snapshot to PRIVATE GitHub'
    $remotes = @(& $git -C $root remote)
    Assert-Native 'Check export remotes'
    if ($remotes.Count -eq 0) {
        & $git -C $root remote add origin $target
        Assert-Native 'Configure private remote'
    } elseif ($remotes.Count -eq 1 -and $remotes[0] -eq 'origin') {
        $origin = (& $git -C $root remote get-url origin).Trim()
        Assert-Native 'Check private origin'
        if ($origin -ne $target) { throw 'Origin is not the expected PRIVATE repository' }
    } else { throw 'Unexpected Git remotes; no push' }
    & $git -C $root push -u origin 'HEAD:refs/heads/release/xod-3.0'
    Assert-Native 'Push sanitized release branch'
    Write-Host 'SUCCESS: XOD 3.0 published to PRIVATE GitHub'
    Write-Host 'BRANCH: release/xod-3.0'
    Write-Host ('SNAPSHOT SHA: ' + (& $git -C $root rev-parse HEAD).Trim())
} catch {
    Write-Host ('STOP: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
