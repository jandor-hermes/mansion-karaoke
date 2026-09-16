[CmdletBinding()]
param(
    [string]$OutputDirectory = "dist/windows"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "../..")).Path
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputDirectory))
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "Mansion Karaoke Windows Tests $PID"
$originalPath = $env:PATH
$controllerProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Test-PeX64([string]$Path, [bool]$ExpectWindowsGui = $false) {
    Assert-True (Test-Path -LiteralPath $Path -PathType Leaf) "Missing executable: $Path"
    $stream = [System.IO.File]::OpenRead($Path)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        Assert-True ($reader.ReadUInt16() -eq 0x5A4D) "$Path does not have an exact MZ signature (0x5A4D)."
        $stream.Position = 0x3c
        $peOffset = $reader.ReadInt32()
        Assert-True ($peOffset -ge 0x40 -and $peOffset -lt ($stream.Length - 96)) "$Path has an invalid PE header offset."
        $stream.Position = $peOffset
        Assert-True ($reader.ReadUInt32() -eq 0x00004550) "$Path does not have an exact PE signature (0x00004550)."
        Assert-True ($reader.ReadUInt16() -eq 0x8664) "$Path is not an exact AMD64 PE image (machine 0x8664)."
        if ($ExpectWindowsGui) {
            $stream.Position = $peOffset + 24
            Assert-True ($reader.ReadUInt16() -eq 0x020b) "$Path does not use the PE32+ optional header."
            $stream.Position = $peOffset + 24 + 68
            Assert-True ($reader.ReadUInt16() -eq 2) "$Path is not linked with /SUBSYSTEM:WINDOWS."
        }
    }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Invoke-NativeProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [hashtable]$Environment = @{},
        [int]$TimeoutSeconds = 30
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
    foreach ($entry in $Environment.GetEnumerator()) { $startInfo.Environment[$entry.Key] = [string]$entry.Value }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    Assert-True ($process.Start()) "Failed to start $FilePath."
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill($true)
        throw "$FilePath timed out after $TimeoutSeconds seconds."
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
}

function Invoke-LauncherSelfTest([string]$BundlePath, [string]$LocalAppData, [string]$Label) {
    New-Item -ItemType Directory -Path $LocalAppData -Force | Out-Null
    $reportPath = Join-Path $LocalAppData "$Label-report.json"
    $launcher = Join-Path $BundlePath "Mansion Karaoke.exe"
    $result = Invoke-NativeProcess -FilePath $launcher -Arguments @("--self-test-json", $reportPath) -Environment @{
        LOCALAPPDATA = $LocalAppData
        PATH = (Join-Path $env:SystemRoot "System32")
    }
    Assert-True ($result.ExitCode -eq 0) "Launcher self-test failed ($Label):`n$($result.Stdout)`n$($result.Stderr)"
    Assert-True (Test-Path -LiteralPath $reportPath -PathType Leaf) "Launcher did not write self-test JSON: $reportPath"
    $reportText = Get-Content -LiteralPath $reportPath -Raw
    $report = $reportText | ConvertFrom-Json
    Assert-True ($null -ne $report) "Launcher self-test report was not a JSON object."
    Assert-True ($report.resources.controllerExists -eq $true) "Launcher did not resolve its packaged controller."
    Assert-True ($report.resources.extensionManifestExists -eq $true) "Launcher did not resolve its packaged Firefox extension."
    Assert-True ($report.resources.installedManifestExists -eq $true) "Launcher did not install a writable extension copy."
    Assert-True ($report.token.valid -eq $true) "Launcher self-test reported an invalid party token."
    Assert-True ($report.acl.stateProtected -eq $true -and $report.acl.tokenProtected -eq $true -and $report.acl.logProtected -eq $true) "Launcher self-test reported an unprotected state ACL."
    $resolvedBundle = [System.IO.Path]::GetFullPath($BundlePath).TrimEnd('\')
    $resolvedResources = [System.IO.Path]::GetFullPath([string]$report.resources.root)
    Assert-True ($resolvedResources.StartsWith($resolvedBundle, [System.StringComparison]::OrdinalIgnoreCase)) "Launcher resolved resources outside its package path: $resolvedResources"
    return $report
}

function Test-LauncherState([string]$BundlePath, [string]$LocalAppData) {
    $createdReport = Invoke-LauncherSelfTest $BundlePath $LocalAppData "generated"
    Assert-True ($createdReport.token.disposition -eq "created") "First launch did not report a newly created token."
    $stateDirectory = Join-Path $LocalAppData "Mansion Karaoke"
    $tokenPath = Join-Path $stateDirectory "party-token"
    Assert-True (Test-Path -LiteralPath $tokenPath -PathType Leaf) "Launcher did not create party-token in LOCALAPPDATA."
    $generated = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
    Assert-True ($generated -match '^[A-HJ-NP-Z2-9]{8}$') "Generated party token has the wrong format."

    Set-Content -LiteralPath $tokenPath -Value "ABCDEFG2" -NoNewline
    $preservedReport = Invoke-LauncherSelfTest $BundlePath $LocalAppData "preserve"
    Assert-True ($preservedReport.token.disposition -eq "preserved") "Current token was not reported as preserved."
    Assert-True (((Get-Content -LiteralPath $tokenPath -Raw).Trim()) -ceq "ABCDEFG2") "Launcher did not preserve a current-format token."

    Set-Content -LiteralPath $tokenPath -Value "0123456789abcdef0123456789abcdef0123456789abcdef" -NoNewline
    $migratedReport = Invoke-LauncherSelfTest $BundlePath $LocalAppData "migrate"
    Assert-True ($migratedReport.token.disposition -eq "migrated") "Legacy token was not reported as migrated."
    $migrated = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
    Assert-True ($migrated -match '^[A-HJ-NP-Z2-9]{8}$') "Launcher did not migrate a legacy token."
    Assert-True ($migrated -cne "ABCDEFG2") "Legacy migration unexpectedly reused the test token."

    $acl = Get-Acl -LiteralPath $tokenPath
    Assert-True $acl.AreAccessRulesProtected "party-token ACL still inherits permissions."
    $worldAllows = @($acl.Access | Where-Object {
        $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $_.IdentityReference.Value -in @("Everyone", "BUILTIN\Users", "S-1-1-0", "S-1-5-32-545")
    })
    Assert-True ($worldAllows.Count -eq 0) "party-token ACL grants access to Everyone or BUILTIN\Users."
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port }
    finally { $listener.Stop() }
}

function Wait-ForStatus([int]$Port, [string]$Token, [int]$Attempts = 60) {
    $uri = "http://127.0.0.1:$Port/status"
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $uri -Headers @{ Authorization = "Bearer $Token" } -SkipHttpErrorCheck -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return $response }
        }
        catch { }
        Start-Sleep -Milliseconds 200
    }
    throw "Packaged controller did not return authenticated HTTP 200 from /status on port $Port."
}

function Assert-PortClosed([int]$Port, [int]$Attempts = 40) {
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $client = [System.Net.Sockets.TcpClient]::new()
        try {
            $connect = $client.ConnectAsync([System.Net.IPAddress]::Loopback, $Port)
            if (-not $connect.Wait(150) -or $connect.IsFaulted) { return }
        }
        catch { return }
        finally { $client.Dispose() }
        Start-Sleep -Milliseconds 100
    }
    throw "TCP port $Port still accepted connections after the launcher exited."
}

function Invoke-LauncherHostSmoke([string]$BundlePath, [string]$LocalAppData, [string]$Label, [bool]$ExpectSuccess) {
    New-Item -ItemType Directory -Path $LocalAppData -Force | Out-Null
    $reportPath = Join-Path $LocalAppData "$Label-host-smoke.json"
    $launcher = Join-Path $BundlePath "Mansion Karaoke.exe"
    $result = Invoke-NativeProcess -FilePath $launcher -Arguments @("--host-smoke-json", $reportPath) -Environment @{
        LOCALAPPDATA = $LocalAppData
        PATH = (Join-Path $env:SystemRoot "System32")
        KARAOKE_BIND = "127.0.0.1"
    } -TimeoutSeconds 30
    if ($ExpectSuccess) {
        Assert-True ($result.ExitCode -eq 0) "Launcher host smoke failed ($Label):`n$($result.Stdout)`n$($result.Stderr)"
    } else {
        Assert-True ($result.ExitCode -ne 0) "Launcher host smoke unexpectedly succeeded ($Label)."
    }
    Assert-True (Test-Path -LiteralPath $reportPath -PathType Leaf) "Launcher did not write host-smoke JSON: $reportPath"
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    Assert-True ($null -ne $report) "Launcher host-smoke report was not a JSON object."
    return $report
}

function Test-LauncherControlledRuntime([string]$BundlePath, [string]$LocalAppData) {
    $report = Invoke-LauncherHostSmoke $BundlePath $LocalAppData "production-startup" $true
    Assert-True ($report.readiness.authenticated -eq $true) "Launcher did not report authenticated controller readiness."
    Assert-True ([int]$report.readiness.statusCode -eq 200) "Launcher readiness did not observe HTTP 200."
    Assert-True ([string]$report.readiness.roomId -eq "local") "Launcher-controlled controller reported the wrong room."
    Assert-True ([int]$report.controller.port -eq 3010) "Launcher host smoke reported the wrong controller port."
    Assert-True ([int]$report.controller.pid -gt 0) "Launcher host smoke did not report its controller child PID."

    $remainingChild = Get-Process -Id ([int]$report.controller.pid) -ErrorAction SilentlyContinue
    Assert-True ($null -eq $remainingChild) "Launcher controller child PID $($report.controller.pid) survived launcher exit."
    Assert-PortClosed 3010
}

function Test-PackagedController([string]$BundlePath, [bool]$ExerciseLiveSearch) {
    $controller = Join-Path $BundlePath "resources/mansion-controller.exe"
    $port = Get-FreeTcpPort
    $token = "WINDOWS2"
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $controller
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment["PATH"] = (Join-Path $env:SystemRoot "System32")
    $startInfo.Environment["PORT"] = [string]$port
    $startInfo.Environment["KARAOKE_TOKEN"] = $token
    $startInfo.Environment["KARAOKE_ROOM_ID"] = "windows-package-test"
    $startInfo.Environment["KARAOKE_BIND"] = "127.0.0.1"
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    Assert-True ($process.Start()) "Could not execute packaged controller."
    $controllerProcesses.Add($process)
    try {
        $statusResponse = Wait-ForStatus $port $token
        $status = $statusResponse.Content | ConvertFrom-Json
        Assert-True ($status.roomId -eq "windows-package-test") "Authenticated /status returned the wrong room."

        $unauthorized = Invoke-WebRequest -Uri "http://127.0.0.1:$port/status" -SkipHttpErrorCheck -TimeoutSec 5
        Assert-True ($unauthorized.StatusCode -eq 401) "Unauthenticated /status did not return HTTP 401."
        $root = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -SkipHttpErrorCheck -TimeoutSec 5
        Assert-True ($root.StatusCode -eq 200) "Controller root did not return HTTP 200."

        if ($ExerciseLiveSearch) {
            $search = Invoke-WebRequest -Uri "http://127.0.0.1:$port/search" -Method Post -Headers @{
                Authorization = "Bearer $token"
                "Content-Type" = "application/json"
            } -Body '{"query":"Never Gonna Give You Up karaoke"}' -SkipHttpErrorCheck -TimeoutSec 45
            Assert-True ($search.StatusCode -eq 200) "Live packaged search failed with HTTP $($search.StatusCode): $($search.Content)"
            $searchJson = $search.Content | ConvertFrom-Json
            Assert-True ($null -ne $searchJson) "Live search did not return JSON."
            Assert-True ($null -ne $searchJson.PSObject.Properties["items"]) "Live search response is missing the items array."
            Assert-True ($searchJson.items -is [System.Array]) "Live search items is not an array."
            Assert-True ($searchJson.items.Count -gt 0) "Live search returned no normalized results."
            Assert-True ($null -ne $searchJson.PSObject.Properties["continuation"]) "Live search response is missing continuation."
            Assert-True ($null -eq $searchJson.continuation -or $searchJson.continuation -is [string]) "Live search continuation must be a string or null."
            $validResults = @($searchJson.items | Where-Object {
                $properties = $_.PSObject.Properties
                $_ -is [pscustomobject] -and
                $properties.Name -contains "id" -and
                $properties.Name -contains "title" -and
                $properties["id"].Value -is [string] -and $properties["id"].Value -match '^[A-Za-z0-9_-]{6,}$' -and
                $properties["title"].Value -is [string] -and -not [string]::IsNullOrWhiteSpace($properties["title"].Value) -and
                (-not ($properties.Name -contains "channel") -or $properties["channel"].Value -is [string]) -and
                (-not ($properties.Name -contains "duration") -or $properties["duration"].Value -is [string]) -and
                (-not ($properties.Name -contains "thumbnail") -or
                    ($properties["thumbnail"].Value -is [string] -and $properties["thumbnail"].Value -match '^https?://'))
            })
            Assert-True ($validResults.Count -eq $searchJson.items.Count) "Live search contained a result outside the normalized {id,title,channel?,duration?,thumbnail?} schema."
            Assert-True ($validResults.Count -gt 0) "Live search did not contain at least one valid normalized result."
        }
    }
    finally {
        if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit(10000) }
        Assert-True $process.HasExited "Packaged controller was left running after cleanup."
        [void]$controllerProcesses.Remove($process)
        $process.Dispose()
    }
}

function Test-OccupiedPortDiagnostic([string]$BundlePath) {
    $port = Get-FreeTcpPort
    $blocker = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
    $blocker.Start()
    try {
        $controller = Join-Path $BundlePath "resources/mansion-controller.exe"
        $result = Invoke-NativeProcess -FilePath $controller -TimeoutSeconds 15 -Environment @{
            PATH = (Join-Path $env:SystemRoot "System32")
            PORT = [string]$port
            KARAOKE_TOKEN = "WINDOWS2"
            KARAOKE_ROOM_ID = "occupied-port-test"
            KARAOKE_BIND = "127.0.0.1"
        }
        Assert-True ($result.ExitCode -ne 0) "Controller unexpectedly started on an occupied port."
        Assert-True (("$($result.Stdout)`n$($result.Stderr)") -match 'EADDRINUSE|address already in use|port.+in use') "Occupied-port output was not diagnosable: $($result.Stderr)"
    }
    finally {
        $blocker.Stop()
    }
}

function Test-LauncherOccupiedPortDiagnostic([string]$BundlePath, [string]$LocalAppData) {
    $blocker = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 3010)
    $ownsBlocker = $false
    try {
        $blocker.Start()
        $ownsBlocker = $true
    }
    catch [System.Net.Sockets.SocketException] {
        Assert-True ($_.Exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::AddressAlreadyInUse) "Could not establish occupied-port precondition: $($_.Exception.Message)"
    }
    try {
        $report = Invoke-LauncherHostSmoke $BundlePath $LocalAppData "occupied-port" $false
        Assert-True ([string]$report.classification -eq "address-in-use") "Launcher did not classify occupied port 3010 as address-in-use."
        Assert-True ([string]$report.message -match '(?i)port\s*3010.{0,160}(?:quit|close|stop).{0,80}(?:app|controller|process)') "Launcher occupied-port guidance was not actionable: $($report.message)"
    }
    finally {
        if ($ownsBlocker) { $blocker.Stop() }
    }
}

function Test-BundleBinaries([string]$BundlePath) {
    $launcher = Join-Path $BundlePath "Mansion Karaoke.exe"
    $controller = Join-Path $BundlePath "resources/mansion-controller.exe"
    Test-PeX64 $launcher $true
    Test-PeX64 $controller $false
    Assert-True (Test-Path -LiteralPath (Join-Path $BundlePath "resources/firefox-extension/manifest.json")) "Firefox extension manifest is missing."
    foreach ($name in @("FRIEND_SETUP_WINDOWS.md", "LICENSE", "NOTICE.md")) {
        Assert-True (Test-Path -LiteralPath (Join-Path $BundlePath $name) -PathType Leaf) "Package is missing $name."
    }

    if (-not (Get-Command dumpbin.exe -ErrorAction SilentlyContinue)) { throw "dumpbin.exe is required to inspect launcher imports." }
    $dependencies = (& dumpbin.exe /DEPENDENTS $launcher 2>&1 | Out-String)
    Assert-True ($LASTEXITCODE -eq 0) "dumpbin /DEPENDENTS failed: $dependencies"
    Assert-True ($dependencies -notmatch '(?im)^\s*(?:VCRUNTIME|MSVCP)[^\s]*\.dll\s*$') "Launcher depends on a dynamic VC runtime DLL:`n$dependencies"
}

try {
    Assert-True (Test-Path -LiteralPath $outputRoot -PathType Container) "Windows output directory does not exist: $outputRoot"
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null

    $builtBundle = Join-Path $outputRoot "Mansion Karaoke"
    Assert-True (Test-Path -LiteralPath $builtBundle -PathType Container) "Built bundle is missing: $builtBundle"
    $spaceParent = Join-Path $temporaryRoot "Package Path With Spaces"
    New-Item -ItemType Directory -Path $spaceParent -Force | Out-Null
    Copy-Item -LiteralPath $builtBundle -Destination $spaceParent -Recurse
    $spaceBundle = Join-Path $spaceParent "Mansion Karaoke"

    Test-BundleBinaries $spaceBundle
    Test-LauncherState $spaceBundle (Join-Path $temporaryRoot "Local App Data With Spaces")
    Test-LauncherControlledRuntime $spaceBundle (Join-Path $temporaryRoot "Host Smoke Local App Data")
    Test-PackagedController $spaceBundle $true
    Test-LauncherOccupiedPortDiagnostic $spaceBundle (Join-Path $temporaryRoot "Occupied Port Local App Data")
    Test-OccupiedPortDiagnostic $spaceBundle

    $packageJson = Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
    $expectedArchiveName = "Mansion-Karaoke-$($packageJson.version)-Windows-x64.zip"
    $archives = @(Get-ChildItem -LiteralPath $outputRoot -Filter "Mansion-Karaoke-*-Windows-x64.zip" -File)
    Assert-True ($archives.Count -eq 1) "Expected exactly one versioned Windows x64 ZIP; found $($archives.Count)."
    Assert-True ($archives[0].Name -ceq $expectedArchiveName) "Windows ZIP filename is not exact: expected '$expectedArchiveName', found '$($archives[0].Name)'."
    $archive = $archives[0]
    $expectedChecksumName = "$expectedArchiveName.sha256"
    $checksumFiles = @(Get-ChildItem -LiteralPath $outputRoot -Filter "Mansion-Karaoke-*-Windows-x64.zip.sha256" -File)
    Assert-True ($checksumFiles.Count -eq 1 -and $checksumFiles[0].Name -ceq $expectedChecksumName) "Expected exactly the checksum filename '$expectedChecksumName'."
    $checksumPath = $checksumFiles[0].FullName
    $checksumText = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    $checksumPattern = '^([0-9a-f]{64}) \*' + [regex]::Escape($expectedArchiveName) + '$'
    Assert-True ($checksumText -cmatch $checksumPattern) "Checksum sidecar must contain the exact lowercase hash and ZIP filename '$expectedArchiveName'."
    $expectedHash = $Matches[1]
    $actualHash = (Get-FileHash -LiteralPath $archive.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-True ($actualHash -eq $expectedHash) "ZIP SHA-256 does not match its sidecar."

    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive.FullName)
    try {
        $entryNames = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        Assert-True ($entryNames.Count -gt 0) "Windows ZIP is empty."
        $invalidEntries = @($entryNames | Where-Object {
            -not $_.StartsWith("Mansion Karaoke/", [System.StringComparison]::Ordinal) -or
            $_.Split('/') -contains ".."
        })
        Assert-True ($invalidEntries.Count -eq 0) "ZIP must have exactly one 'Mansion Karaoke' top-level directory; invalid entries: $($invalidEntries -join ', ')"
        foreach ($requiredEntry in @(
            "Mansion Karaoke/Mansion Karaoke.exe",
            "Mansion Karaoke/resources/mansion-controller.exe",
            "Mansion Karaoke/resources/firefox-extension/manifest.json"
        )) {
            Assert-True ($entryNames -ccontains $requiredEntry) "ZIP is missing required entry '$requiredEntry'."
        }
    }
    finally {
        $zip.Dispose()
    }

    $extractRoot = Join-Path $temporaryRoot "Extracted Artifact With Spaces"
    Expand-Archive -LiteralPath $archive.FullName -DestinationPath $extractRoot -Force
    $extractedBundle = Join-Path $extractRoot "Mansion Karaoke"
    Test-BundleBinaries $extractedBundle
    [void](Invoke-LauncherSelfTest $extractedBundle (Join-Path $temporaryRoot "Extracted Local App Data") "zip-round-trip")
    Test-PackagedController $extractedBundle $false

    Write-Host "Windows application bundle, runtime, ZIP round trip, and SHA-256 checks passed."
}
finally {
    foreach ($process in @($controllerProcesses)) {
        if ($null -ne $process -and -not $process.HasExited) {
            $process.Kill($true)
            $process.WaitForExit(10000)
        }
        if ($null -ne $process) { $process.Dispose() }
    }
    $env:PATH = $originalPath
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
