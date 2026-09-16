[CmdletBinding()]
param(
    [string]$OutputDirectory = "dist/windows"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "../..")).Path
$packageJsonPath = Join-Path $repositoryRoot "package.json"

function Get-RepositoryOutputPath([string]$RequestedPath) {
    if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
        throw "OutputDirectory must name a repository-contained descendant directory."
    }
    if ([System.IO.Path]::IsPathRooted($RequestedPath) -and
        -not [System.IO.Path]::IsPathFullyQualified($RequestedPath)) {
        throw "OutputDirectory must not be a drive-relative path: '$RequestedPath'."
    }

    $candidate = if ([System.IO.Path]::IsPathFullyQualified($RequestedPath)) {
        $RequestedPath
    } else {
        Join-Path $repositoryRoot $RequestedPath
    }
    $root = [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $fullPath = [System.IO.Path]::GetFullPath($candidate).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $descendantPrefix = "$root$([System.IO.Path]::DirectorySeparatorChar)"
    if (-not $fullPath.StartsWith($descendantPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "OutputDirectory must be a descendant of the repository root: '$RequestedPath'."
    }

    # Reject junctions/symlinks in the existing path so recursive deletion cannot escape via a reparse point.
    $existingAncestor = $fullPath
    while (-not (Test-Path -LiteralPath $existingAncestor)) {
        $parent = [System.IO.Path]::GetDirectoryName($existingAncestor)
        if ([string]::IsNullOrEmpty($parent) -or $parent -eq $existingAncestor) {
            throw "Could not resolve an existing ancestor for OutputDirectory '$RequestedPath'."
        }
        $existingAncestor = $parent
    }
    $probe = $existingAncestor
    while ($probe.StartsWith($descendantPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $item = Get-Item -LiteralPath $probe -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "OutputDirectory traverses a junction or symbolic link: '$probe'."
        }
        $probe = [System.IO.Path]::GetDirectoryName($probe)
    }
    $resolvedAncestor = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $existingAncestor).Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    if ($resolvedAncestor -ne $root -and
        -not $resolvedAncestor.StartsWith($descendantPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "OutputDirectory resolves outside the repository root: '$RequestedPath'."
    }
    return $fullPath
}

$outputRoot = Get-RepositoryOutputPath $OutputDirectory

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required build tool '$Name' was not found on PATH."
    }
}

foreach ($tool in @("bun", "node", "cl.exe", "rc.exe")) {
    Assert-Command $tool
}

$bunVersion = (& bun --version).Trim()
if ($bunVersion -ne "1.3.13") {
    throw "Bun 1.3.13 is required; found '$bunVersion'."
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
$versionMatch = [regex]::Match($version, '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')
if (-not $versionMatch.Success) {
    throw "package.json contains an invalid semantic version: '$version'."
}
$versionParts = @($versionMatch.Groups[1].Value, $versionMatch.Groups[2].Value, $versionMatch.Groups[3].Value)
if (@($versionParts | Where-Object { [uint64]$_ -gt 65535 }).Count -ne 0) {
    throw "package.json version '$version' cannot be represented in Windows version metadata."
}
$windowsVersion = "$($versionParts[0]).$($versionParts[1]).$($versionParts[2]).0"
$windowsVersionTuple = "$($versionParts[0]),$($versionParts[1]),$($versionParts[2]),0"

$requiredInputs = @(
    "apps/control-plane/src/compiled-server.ts",
    "players/firefox-extension/package.json",
    "packaging/windows/Launcher.cpp",
    "packaging/windows/app.manifest",
    "packaging/windows/resources.rc",
    "FRIEND_SETUP_WINDOWS.md",
    "LICENSE",
    "NOTICE.md"
)
foreach ($relativePath in $requiredInputs) {
    if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $relativePath) -PathType Leaf)) {
        throw "Required package input is missing: $relativePath"
    }
}

$resourceSource = Get-Content -LiteralPath (Join-Path $repositoryRoot "packaging/windows/resources.rc") -Raw
$resourceVersionString = '"' + $windowsVersion + '\0"'
foreach ($pattern in @(
    "(?m)^\s*FILEVERSION\s+$([regex]::Escape($windowsVersionTuple))\s*$",
    "(?m)^\s*PRODUCTVERSION\s+$([regex]::Escape($windowsVersionTuple))\s*$",
    "(?m)^\s*VALUE\s+`"FileVersion`",\s*$([regex]::Escape($resourceVersionString))\s*$",
    "(?m)^\s*VALUE\s+`"ProductVersion`",\s*$([regex]::Escape($resourceVersionString))\s*$"
)) {
    if ($resourceSource -notmatch $pattern) {
        throw "packaging/windows/resources.rc version metadata must match package.json version '$version' as '$windowsVersion'."
    }
}
$manifestSource = Get-Content -LiteralPath (Join-Path $repositoryRoot "packaging/windows/app.manifest") -Raw
$manifestIdentity = [regex]::Match($manifestSource, '(?s)<assemblyIdentity\b(?:(?!/>).)*?\bname\s*=\s*"MansionKaraoke\.Host"(?:(?!/>).)*?\bversion\s*=\s*"([^"]+)"(?:(?!/>).)*?/>')
if (-not $manifestIdentity.Success -or $manifestIdentity.Groups[1].Value -ne $windowsVersion) {
    throw "packaging/windows/app.manifest assembly version must match package.json version '$version' as '$windowsVersion'."
}

Remove-Item -LiteralPath $outputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$bundleRoot = Join-Path $outputRoot "Mansion Karaoke"
$resourcesRoot = Join-Path $bundleRoot "resources"
$controllerRelativePath = "resources/mansion-controller.exe"
$extensionRelativePath = "resources/firefox-extension"
$extensionDestination = Join-Path $bundleRoot $extensionRelativePath
New-Item -ItemType Directory -Path $resourcesRoot -Force | Out-Null

Push-Location $repositoryRoot
try {
    & bun run firefox:build
    if ($LASTEXITCODE -ne 0) { throw "Firefox extension build failed with exit code $LASTEXITCODE." }
    & bun run firefox:verify
    if ($LASTEXITCODE -ne 0) { throw "Firefox extension verification failed with exit code $LASTEXITCODE." }

    $controllerPath = Join-Path $bundleRoot $controllerRelativePath
    & bun build "apps/control-plane/src/compiled-server.ts" --compile --target=bun-windows-x64 --windows-hide-console --outfile $controllerPath
    if ($LASTEXITCODE -ne 0) { throw "Standalone controller compilation failed with exit code $LASTEXITCODE." }

    Copy-Item -LiteralPath (Join-Path $repositoryRoot "players/firefox-extension/dist") -Destination $extensionDestination -Recurse -Force

    $resourceObject = Join-Path $outputRoot "mansion-resources.res"
    & rc.exe /nologo /I $scriptDirectory "/fo$resourceObject" (Join-Path $scriptDirectory "resources.rc")
    if ($LASTEXITCODE -ne 0) { throw "Windows resource compilation failed with exit code $LASTEXITCODE." }

    $launcherPath = Join-Path $bundleRoot "Mansion Karaoke.exe"
    $launcherSource = Join-Path $scriptDirectory "Launcher.cpp"
    $launcherObject = Join-Path $outputRoot "Launcher.obj"
    & cl.exe /nologo /std:c++20 /O2 /EHsc /MT /W4 /WX /DUNICODE /D_UNICODE "/Fo$launcherObject" "/Fe$launcherPath" $launcherSource $resourceObject /link /SUBSYSTEM:WINDOWS /MACHINE:X64 bcrypt.lib advapi32.lib shell32.lib ole32.lib user32.lib winhttp.lib ws2_32.lib
    if ($LASTEXITCODE -ne 0) { throw "Native launcher compilation failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}

foreach ($fileName in @("FRIEND_SETUP_WINDOWS.md", "LICENSE", "NOTICE.md")) {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot $fileName) -Destination (Join-Path $bundleRoot $fileName) -Force
}

$extensionManifest = Join-Path $extensionDestination "manifest.json"
foreach ($artifact in @(
    (Join-Path $bundleRoot "Mansion Karaoke.exe"),
    (Join-Path $resourcesRoot "mansion-controller.exe"),
    $extensionManifest
)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
        throw "Expected build artifact is missing: $artifact"
    }
}

$archiveName = "Mansion-Karaoke-$version-Windows-x64.zip"
$archivePath = Join-Path $outputRoot $archiveName
Compress-Archive -LiteralPath $bundleRoot -DestinationPath $archivePath -CompressionLevel Optimal -Force
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = "$archivePath.sha256"
[System.IO.File]::WriteAllText($checksumPath, "$hash *$archiveName`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "Built $bundleRoot"
Write-Host "Created $archivePath"
Write-Host "SHA-256 $hash"
