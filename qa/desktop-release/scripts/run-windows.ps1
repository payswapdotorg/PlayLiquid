<#
PLX-REL-001 Windows packaged-app smoke harness.

  powershell -ExecutionPolicy Bypass -File run-windows.ps1 `
    -Installer <PlayLiquid GameOS-<v>-win-x64.exe> `
    -PortableZip <PlayLiquid GameOS-<v>-win-x64.zip> `
    [-Sums <SHA256SUMS>] [-Out <dir>]

Thin driver: scripts/run-windows.mjs (uniform node entry point, mirrors the
run-ubuntu.sh convention of the Linux harness).

HONEST SCOPE — what this harness actually verifies on a real Windows machine
(built for windows-latest GitHub runners; any disposable Windows box works):

  - artifact checksums against SHA256SUMS (GNU sha256sum text format);
  - the portable zip's payload structure and that the PORTABLE app launches;
  - SILENT NSIS install (/S, per-user) — install dir + exe, the packaged
    .zcode-install-manifest, Start Menu shortcut, HKCU uninstall registry
    entry (identity: DisplayName / Publisher / DisplayVersion / InstallLocation);
  - launch of the INSTALLED app: process identity (exe path), window title
    (product identity), Electron userData dir creation;
  - user-data retention across a REINSTALL-over-existing + relaunch
    (same-version reinstall: an honest mechanical approximation of an
    upgrade — a cross-version upgrade needs two different builds and is a
    recorded follow-up, NOT claimed here);
  - SILENT uninstall (/S): app files, Start Menu shortcut and registry entry
    removed while USER DATA IS RETAINED (electron-builder NSIS default).

What it deliberately does NOT do (recorded, never faked):
  - no synthetic GUI interactions (no clicks/typing) — process-, file- and
    registry-level evidence only;
  - no cross-version upgrade test (one build per run);
  - no code-signing / SmartScreen verification (installer is unsigned —
    disclosed in the release notes; a silent /S install does not exercise
    the SmartScreen UI at all);
  - no auto-update verification (auto-update is disabled by product policy).

Launch flags: the app is launched with --disable-gpu (headless-runner
determinism) from a NEUTRAL working directory (never the repository
checkout — the packaged app's agent-runtime resolution is cwd-sensitive,
see the Linux harness's neutral-cwd discipline note).

Exit codes (same semantics as run-smoke.mjs): 0 = all checks passed (skips
allowed); 1 = unexpected failure(s); 2 = nothing ran; 3 = harness error.
The raw status of every check is always recorded in report.json.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$PortableZip,
  [string]$Sums = "",
  [string]$Out = ""
)

# ---------------------------------------------------------------- constants
$script:ProductName   = "PlayLiquid GameOS"
$script:ExeName       = "PlayLiquid GameOS.exe"
$script:ProcessName   = "PlayLiquid GameOS"
$script:UserdataDir   = Join-Path $env:APPDATA $script:ProductName
$script:DataRootDir   = Join-Path $env:USERPROFILE ".playliquid-gameos"
$script:StartMenuLnk  = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\PlayLiquid GameOS.lnk"
try {
  $script:DesktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "PlayLiquid GameOS.lnk"
} catch {
  $script:DesktopLnk = $null
}
$script:InstallManifestName = ".zcode-install-manifest"
$script:LaunchFlags = "--disable-gpu"
$script:MarkerFile  = "playliquid-smoke-marker.txt"

# Neutral working directory for every app launch (never the repo checkout).
$script:NeutralCwd = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }

$script:Checks     = New-Object System.Collections.Generic.List[object]
$script:Transcript = New-Object System.Collections.Generic.List[string]
$script:StartedAt  = (Get-Date).ToUniversalTime()

if ([string]::IsNullOrWhiteSpace($Out)) {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $Out = Join-Path (Split-Path -Parent $PSScriptRoot) ("evidence\windows-{0}" -f $stamp)
}
New-Item -ItemType Directory -Force -Path $Out | Out-Null

# ---------------------------------------------------------------- plumbing
function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date).ToUniversalTime().ToString("HH:mm:ss"), $Message
  $script:Transcript.Add($line)
  Write-Host $line
}

function Add-Check {
  param([string]$Id, [string]$Status, [string]$Detail, [long]$DurationMs = 0)
  $script:Checks.Add([ordered]@{
    id = $Id
    status = $Status
    detail = $Detail
    durationMs = $DurationMs
  })
  Write-Log ("check {0}: {1} — {2}" -f $Id, $Status.ToUpperInvariant(), $Detail)
}

function Get-Sha256 {
  param([string]$Path)
  (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

# Parse a GNU sha256sum-format file: "<64 hex>  <name>" or "<64 hex> *<name>".
function Read-SumsFile {
  param([string]$Path)
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }
  foreach ($rawLine in [System.IO.File]::ReadAllLines($Path)) {
    $line = $rawLine.TrimEnd("`r")
    if ($line.Length -lt 67) { continue }
    $hash = $line.Substring(0, 64).ToLowerInvariant()
    $rest = $line.Substring(64)
    if ($rest.StartsWith(" *"))      { $name = $rest.Substring(2) }
    elseif ($rest.StartsWith("  "))  { $name = $rest.Substring(2) }
    else { continue }
    if ($name) { $map[$name] = $hash }
  }
  return $map
}

function Get-UninstallEntry {
  # electron-builder's assisted NSIS installer registers the uninstall
  # entry with DisplayName "${productName} ${version}" (NsisTarget.js
  # default for oneClick=false); oneClick installers register the plain
  # product name. Match by PREFIX so both shapes are found.
  Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "$($script:ProductName)*" } |
    Select-Object -First 1
}

function Stop-PackagedAppProcesses {
  param([int]$TimeoutSeconds = 90)
  $procs = @(Get-Process -Name $script:ProcessName -ErrorAction SilentlyContinue)
  if ($procs.Count -gt 0) {
    Write-Log ("stopping {0} leftover app process(es) by product process name" -f $procs.Count)
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (@(Get-Process -Name $script:ProcessName -ErrorAction SilentlyContinue).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return (@(Get-Process -Name $script:ProcessName -ErrorAction SilentlyContinue).Count -eq 0)
}

function Wait-ProcessExit {
  param([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds)
  if ($null -eq $Process) { return $true }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# Launch the packaged app with the harness flags from a NEUTRAL cwd and wait
# for it to settle. Returns the Process (caller must terminate it).
function Start-PackagedApp {
  param([string]$ExePath)
  $proc = Start-Process -FilePath $ExePath -ArgumentList $script:LaunchFlags `
    -WorkingDirectory $script:NeutralCwd -PassThru
  Start-Sleep -Seconds 5
  return $proc
}

function Wait-MainWindowTitle {
  param([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) { return $null }
    if ($Process.MainWindowTitle) { return $Process.MainWindowTitle }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

function Invoke-Installer {
  param([string]$InstallerPath, [int]$TimeoutSeconds = 900)
  $proc = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -PassThru
  if (-not (Wait-ProcessExit -Process $proc -TimeoutSeconds $TimeoutSeconds)) {
    try { $proc.Kill() } catch { }
    throw "installer did not exit within $TimeoutSeconds s"
  }
  return $proc.ExitCode
}

function Get-UninstallerPath {
  param([string]$InstallLocation, [object]$Entry)
  # electron-builder's NSIS uninstaller file is NOT plain Uninstall.exe —
  # common.nsh defines UNINSTALL_FILENAME as "Uninstall ${PRODUCT_FILENAME}.exe"
  # (e.g. "Uninstall PlayLiquid GameOS.exe"). Resolve from the registry
  # entry's UninstallString first (authoritative), then the electron-builder
  # default name, then the plain legacy name.
  $candidates = @()
  if ($Entry -and $Entry.UninstallString) {
    $s = [string]$Entry.UninstallString
    if ($s.StartsWith('"')) { $candidates += ($s -replace '^"([^"]+)".*$', '$1') }
    else { $candidates += (($s -split ' ')[0]) }
  }
  $candidates += (Join-Path $InstallLocation "Uninstall $script:ProductName.exe")
  $candidates += (Join-Path $InstallLocation "Uninstall.exe")
  foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}

function Invoke-Uninstaller {
  param([string]$InstallLocation, [int]$TimeoutSeconds = 600)
  $entry = Get-UninstallEntry
  $uninstaller = Get-UninstallerPath -InstallLocation $InstallLocation -Entry $entry
  if (-not $uninstaller) {
    $expected = Join-Path $InstallLocation "Uninstall $script:ProductName.exe"
    throw "uninstaller not found (expected `"$expected`" or the registry UninstallString target)"
  }
  $proc = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru
  # The NSIS uninstaller re-spawns a copy of itself and the parent exits
  # immediately — wait for the APP FILES to disappear instead of the process.
  [void](Wait-ProcessExit -Process $proc -TimeoutSeconds 120)
  $appExe = Join-Path $InstallLocation $script:ExeName
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-Path -LiteralPath $appExe)) { return $true }
    Start-Sleep -Seconds 5
  }
  return $false
}

function Write-Report {
  param([int]$ExitCode, [string]$FatalError = "")
  $finishedAt = (Get-Date).ToUniversalTime()
  $pass = @($script:Checks | Where-Object { $_.status -eq "pass" }).Count
  $fail = @($script:Checks | Where-Object { $_.status -eq "fail" }).Count
  $skip = @($script:Checks | Where-Object { $_.status -eq "skip" }).Count
  $report = [ordered]@{
    harness = "run-windows.ps1"
    driver = "run-windows.mjs"
    startedUtc = $script:StartedAt.ToString("yyyy-MM-ddTHH:mm:ssZ")
    finishedUtc = $finishedAt.ToString("yyyy-MM-ddTHH:mm:ssZ")
    exitCode = $ExitCode
    fatalError = $FatalError
    environment = [ordered]@{
      osVersion = [System.Environment]::OSVersion.VersionString
      computerName = $env:COMPUTERNAME
      user = $env:USERNAME
      powershell = $PSVersionTable.PSVersion.ToString()
      launchFlags = $script:LaunchFlags
      neutralWorkingDirectory = $script:NeutralCwd
      runner = if ($env:RUNNER_NAME) { $env:RUNNER_NAME } else { "not-a-github-runner" }
    }
    summary = [ordered]@{ pass = $pass; fail = $fail; skip = $skip }
    scope = "Headless Windows harness: silent NSIS install/uninstall, shortcut + registry identity, installed and portable launches, data retention. No synthetic GUI interactions, no cross-version upgrade, no signing/SmartScreen or auto-update verification (auto-update is disabled by product policy)."
    checks = $script:Checks
  }
  $json = $report | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText(
    (Join-Path $Out "report.json"),
    $json,
    (New-Object System.Text.UTF8Encoding($false)))
  [System.IO.File]::WriteAllText(
    (Join-Path $Out "transcript.txt"),
    (($script:Transcript -join "`r`n") + "`r`n"),
    (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ""
  Write-Host ("summary: pass={0} fail={1} skip={2} exit={3}" -f $pass, $fail, $skip, $ExitCode)
  Write-Host ("evidence: {0}" -f $Out)
}

# ------------------------------------------------------------------ checks
function Assert-Checksum {
  param([string]$Id, [string]$Path, $SumsMap)
  if (-not $SumsMap) {
    Add-Check -Id $Id -Status "skip" -Detail "no SHA256SUMS provided (checksum verification skipped, recorded)"
    return
  }
  $name = Split-Path -Leaf $Path
  if (-not $SumsMap.ContainsKey($name)) {
    Add-Check -Id $Id -Status "skip" -Detail "$name not listed in SHA256SUMS (recorded)"
    return
  }
  $actual = Get-Sha256 -Path $Path
  if ($actual -eq $SumsMap[$name]) {
    Add-Check -Id $Id -Status "pass" -Detail "$name sha256=$actual matches SHA256SUMS"
  } else {
    Add-Check -Id $Id -Status "fail" -Detail "$name sha256 mismatch: expected $($SumsMap[$name]) got $actual"
  }
}

# -------------------------------------------------------------------- main
$exitCode = 3
$fatalError = ""
try {
  Write-Log ("harness start — installer: {0}" -f $Installer)
  Write-Log ("portable zip: {0}" -f $PortableZip)
  if ($Sums) { Write-Log ("sums: {0}" -f $Sums) }
  Write-Log ("out: {0}" -f $Out)

  foreach ($p in @($Installer, $PortableZip)) {
    if (-not (Test-Path -LiteralPath $p)) { throw "required artifact not found: $p" }
  }
  $sumsMap = $null
  if ($Sums) { $sumsMap = Read-SumsFile -Path $Sums }

  # 1. artifact checksums -------------------------------------------------
  Assert-Checksum -Id "artifact-checksum-installer" -Path $Installer -SumsMap $sumsMap
  Assert-Checksum -Id "artifact-checksum-portable-zip" -Path $PortableZip -SumsMap $sumsMap

  # 2. portable zip: structure + launch -----------------------------------
  $portableRoot = if ($env:RUNNER_TEMP) { Join-Path $env:RUNNER_TEMP "plx-portable" } else { Join-Path $Out "portable" }
  if (Test-Path -LiteralPath $portableRoot) { Remove-Item -Recurse -Force -LiteralPath $portableRoot }
  New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Expand-Archive -LiteralPath $PortableZip -DestinationPath $portableRoot -Force
  $sw.Stop()

  $portableExe = Join-Path $portableRoot $script:ExeName
  $layout = "root"
  if (-not (Test-Path -LiteralPath $portableExe)) {
    # tolerate a one-level-deep layout and record it honestly
    $nested = Get-ChildItem -LiteralPath $portableRoot -Directory | Select-Object -First 1
    if ($nested -and (Test-Path -LiteralPath (Join-Path $nested.FullName $script:ExeName))) {
      $portableExe = Join-Path $nested.FullName $script:ExeName
      $layout = "nested-single-dir"
    }
  }
  $portableManifest = Join-Path (Split-Path -Parent $portableExe) $script:InstallManifestName
  if ((Test-Path -LiteralPath $portableExe) -and (Test-Path -LiteralPath $portableManifest)) {
    Add-Check -Id "portable-zip-structure" -Status "pass" -Detail ("extracted in {0:N1}s; payload layout: {1}; exe + $script:InstallManifestName present" -f $sw.Elapsed.TotalSeconds, $layout)
  } else {
    Add-Check -Id "portable-zip-structure" -Status "fail" -Detail ("payload incomplete (layout={0}): exe={1} manifest={2}" -f $layout, (Test-Path -LiteralPath $portableExe), (Test-Path -LiteralPath $portableManifest))
  }

  if (Test-Path -LiteralPath $portableExe) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-PackagedApp -ExePath $portableExe
    Start-Sleep -Seconds 20
    $proc.Refresh()
    $alive = -not $proc.HasExited
    $title = $null
    $exePathObserved = $null
    if ($alive) {
      $title = Wait-MainWindowTitle -Process $proc -TimeoutSeconds 30
      try { $exePathObserved = $proc.Path } catch { }
    }
    $sw.Stop()
    if ($alive) {
      $titleNote = if ($title) { "window title: '$title'" } else { "no window title readable" }
      Add-Check -Id "portable-zip-launch" -Status "pass" -Detail ("portable app launched with $script:LaunchFlags and stayed alive for 20+ s ({0}; process: {1})" -f $titleNote, $exePathObserved)
    } else {
      Add-Check -Id "portable-zip-launch" -Status "fail" -Detail ("portable app exited during the 20 s observation window (exit code: {0})" -f $proc.ExitCode)
    }
    [void](Stop-PackagedAppProcesses)
  } else {
    Add-Check -Id "portable-zip-launch" -Status "skip" -Detail "portable exe not found — launch not attempted"
  }

  # 3. clean silent install (pre-clean any previous install first) --------
  $preEntry = Get-UninstallEntry
  if ($preEntry) {
    Write-Log ("pre-clean: a previous install exists (InstallLocation={0}) — uninstalling it first" -f $preEntry.InstallLocation)
    [void](Invoke-Uninstaller -InstallLocation $preEntry.InstallLocation)
    [void](Stop-PackagedAppProcesses)
  }

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $installExit = Invoke-Installer -InstallerPath $Installer
  $sw.Stop()
  $installDetail = ("NSIS silent install (/S, per-user) exited 0 in {0:N1}s" -f $sw.Elapsed.TotalSeconds)
  if ($installExit -ne 0) {
    # One honest retry for a crashed silent install (PLX-REL-001, run
    # 41220671862: the identical installer bytes installed cleanly in runs
    # 41216691320/41218769796 and one run crashed with 0xC0000005 ~30 s in
    # — an intermittent runner/installer fault, not a reproducible product
    # defect). BOTH attempts are recorded: the check detail reports the
    # first exit code and the retry outcome, and evidence preserves it.
    $firstExit = $installExit
    Write-Log ("clean-install: first attempt exited {0} — removing partial state and retrying once" -f $firstExit)
    $partialEntry = Get-UninstallEntry
    $partialDir = if ($partialEntry -and $partialEntry.InstallLocation) { $partialEntry.InstallLocation } else { Join-Path $env:LOCALAPPDATA "Programs\$script:ProductName" }
    [void](Stop-PackagedAppProcesses -TimeoutSeconds 30)
    $partialUninstaller = Get-UninstallerPath -InstallLocation $partialDir -Entry $partialEntry
    if ($partialUninstaller) {
      try { $null = Invoke-Uninstaller -InstallLocation $partialDir } catch { Write-Log ("clean-install retry cleanup: {0}" -f $_.Exception.Message) }
    }
    $sw.Restart()
    $installExit = Invoke-Installer -InstallerPath $Installer
    $sw.Stop()
    if ($installExit -eq 0) {
      $installDetail = ("NSIS silent install (/S, per-user) exited 0 in {0:N1}s — first attempt crashed with exit code {1}; the retry succeeded (both attempts recorded)" -f $sw.Elapsed.TotalSeconds, $firstExit)
    } else {
      $installDetail = ("NSIS silent install (/S) exited with code {0} (first attempt {1}; retried once, both failed)" -f $installExit, $firstExit)
    }
  }
  if ($installExit -eq 0) {
    Add-Check -Id "clean-install" -Status "pass" -Detail $installDetail
  } else {
    Add-Check -Id "clean-install" -Status "fail" -Detail $installDetail
  }
  Start-Sleep -Seconds 3

  # 4. install identity: dir + exe + manifest + registry + shortcuts ------
  $entry = Get-UninstallEntry
  $installLocation = $null
  if ($entry) { $installLocation = $entry.InstallLocation }
  if (-not $installLocation) {
    $installLocation = Join-Path $env:LOCALAPPDATA "Programs\$script:ProductName"
    Write-Log "registry InstallLocation missing — using the default per-user install dir fallback"
  }
  $installedExe = Join-Path $installLocation $script:ExeName
  $installedManifest = Join-Path $installLocation $script:InstallManifestName

  if (Test-Path -LiteralPath $installedExe) {
    Add-Check -Id "install-dir-exe" -Status "pass" -Detail "installed exe present: $installedExe"
  } else {
    Add-Check -Id "install-dir-exe" -Status "fail" -Detail "installed exe NOT found at $installedExe"
  }

  if (Test-Path -LiteralPath $installedManifest) {
    Add-Check -Id "install-manifest-present" -Status "pass" -Detail "packaged $script:InstallManifestName present in the install dir"
  } else {
    Add-Check -Id "install-manifest-present" -Status "fail" -Detail "$script:InstallManifestName missing from the install dir ($installLocation)"
  }

  if ($entry) {
    $pub = if ($entry.Publisher) { $entry.Publisher } else { "<none>" }
    $ver = if ($entry.DisplayVersion) { $entry.DisplayVersion } else { "<none>" }
    $icon = if ($entry.DisplayIcon) { $entry.DisplayIcon } else { "<none>" }
    Add-Check -Id "uninstall-registry-identity" -Status "pass" -Detail ("HKCU uninstall entry: DisplayName='{0}' Publisher='{1}' DisplayVersion='{2}' InstallLocation='{3}' DisplayIcon='{4}'" -f $entry.DisplayName, $pub, $ver, $entry.InstallLocation, $icon)
  } else {
    Add-Check -Id "uninstall-registry-identity" -Status "fail" -Detail "no HKCU uninstall entry with DisplayName '$script:ProductName'"
  }

  if (Test-Path -LiteralPath $script:StartMenuLnk) {
    Add-Check -Id "start-menu-shortcut" -Status "pass" -Detail "Start Menu shortcut present: $script:StartMenuLnk"
  } else {
    Add-Check -Id "start-menu-shortcut" -Status "fail" -Detail "Start Menu shortcut missing: $script:StartMenuLnk"
  }

  if ($script:DesktopLnk) {
    if (Test-Path -LiteralPath $script:DesktopLnk) {
      Add-Check -Id "desktop-shortcut" -Status "pass" -Detail "desktop shortcut present: $script:DesktopLnk"
    } else {
      Add-Check -Id "desktop-shortcut" -Status "skip" -Detail "desktop shortcut not created by the silent install (assisted-installer default checkbox state cannot be confirmed headlessly — recorded, not failed)"
    }
  } else {
    Add-Check -Id "desktop-shortcut" -Status "skip" -Detail "desktop folder could not be resolved on this machine"
  }

  # 5. launch the INSTALLED app -------------------------------------------
  if (Test-Path -LiteralPath $installedExe) {
    $proc = Start-PackagedApp -ExePath $installedExe
    Start-Sleep -Seconds 20
    $proc.Refresh()
    $alive = -not $proc.HasExited
    if ($alive) {
      Add-Check -Id "launch-installed-alive" -Status "pass" -Detail "installed app launched with $script:LaunchFlags and stayed alive for 20+ s"
    } else {
      Add-Check -Id "launch-installed-alive" -Status "fail" -Detail ("installed app exited during the 20 s observation window (exit code: {0})" -f $proc.ExitCode)
    }

    $exePathObserved = $null
    try { $exePathObserved = $proc.Path } catch { }
    if ($exePathObserved) {
      if ($exePathObserved -eq $installedExe) {
        Add-Check -Id "launch-installed-exe-path" -Status "pass" -Detail "running process is the installed product exe: $exePathObserved"
      } else {
        Add-Check -Id "launch-installed-exe-path" -Status "fail" -Detail "running process exe is $exePathObserved, expected $installedExe"
      }
    } else {
      Add-Check -Id "launch-installed-exe-path" -Status "skip" -Detail "process image path not readable on this machine (recorded)"
    }

    $title = $null
    if ($alive) { $title = Wait-MainWindowTitle -Process $proc -TimeoutSeconds 45 }
    if ($title -and $title -match "PlayLiquid") {
      Add-Check -Id "product-identity-window-title" -Status "pass" -Detail "main window title carries the product identity: '$title'"
    } elseif ($title) {
      Add-Check -Id "product-identity-window-title" -Status "fail" -Detail "main window title does not carry the product identity: '$title'"
    } else {
      Add-Check -Id "product-identity-window-title" -Status "fail" -Detail "no main window title readable within the observation window (headless session)"
    }

    if (Test-Path -LiteralPath $script:UserdataDir) {
      $dataRootNote = if (Test-Path -LiteralPath $script:DataRootDir) { "present" } else { "absent" }
      Add-Check -Id "user-data-dir-created" -Status "pass" -Detail "Electron userData dir created on launch: $script:UserdataDir (product data root $script:DataRootDir: $dataRootNote)"
    } else {
      Add-Check -Id "user-data-dir-created" -Status "fail" -Detail "Electron userData dir not created: $script:UserdataDir"
    }
    [void](Stop-PackagedAppProcesses)
  } else {
    foreach ($id in @("launch-installed-alive", "launch-installed-exe-path", "product-identity-window-title", "user-data-dir-created")) {
      Add-Check -Id $id -Status "skip" -Detail "installed exe missing — launch not attempted"
    }
  }

  # 6. data-retention marker ----------------------------------------------
  $markerPath = Join-Path $script:UserdataDir $script:MarkerFile
  if (Test-Path -LiteralPath $script:UserdataDir) {
    Set-Content -LiteralPath $markerPath -Value ("playliquid windows smoke retention marker {0}" -f (Get-Date).ToUniversalTime().ToString("o")) -Encoding UTF8
    if (Test-Path -LiteralPath $markerPath) {
      Add-Check -Id "data-retention-marker" -Status "pass" -Detail "retention marker written into the app data dir: $markerPath"
    } else {
      Add-Check -Id "data-retention-marker" -Status "fail" -Detail "could not write retention marker: $markerPath"
    }
  } else {
    Add-Check -Id "data-retention-marker" -Status "skip" -Detail "app data dir missing — marker not written"
  }

  # 7. reinstall-over-existing (same-version upgrade approximation) --------
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $reinstallExit = Invoke-Installer -InstallerPath $Installer
  $sw.Stop()
  if ($reinstallExit -eq 0) {
    Add-Check -Id "reinstall-over-existing" -Status "pass" -Detail ("installer re-run over the existing install exited 0 in {0:N1}s (same-version reinstall — the honest headless approximation of an upgrade; cross-version upgrade is NOT claimed)" -f $sw.Elapsed.TotalSeconds)
  } else {
    Add-Check -Id "reinstall-over-existing" -Status "fail" -Detail ("installer re-run over the existing install exited with code {0}" -f $reinstallExit)
  }
  Start-Sleep -Seconds 3

  $entryAfter = Get-UninstallEntry
  if ((Test-Path -LiteralPath $installedExe) -and $entryAfter) {
    Add-Check -Id "reinstall-app-present" -Status "pass" -Detail "app exe + uninstall registry entry present after the reinstall"
  } else {
    Add-Check -Id "reinstall-app-present" -Status "fail" -Detail ("app present after reinstall: exe={0} registry={1}" -f (Test-Path -LiteralPath $installedExe), [bool]$entryAfter)
  }

  if (Test-Path -LiteralPath $markerPath) {
    Add-Check -Id "data-retention-across-reinstall" -Status "pass" -Detail "user data (marker) retained across the reinstall: $markerPath"
  } else {
    Add-Check -Id "data-retention-across-reinstall" -Status "fail" -Detail "user data marker LOST across the reinstall: $markerPath"
  }

  # 8. relaunch after reinstall -------------------------------------------
  if (Test-Path -LiteralPath $installedExe) {
    $proc = Start-PackagedApp -ExePath $installedExe
    Start-Sleep -Seconds 20
    $proc.Refresh()
    $alive = -not $proc.HasExited
    $title = $null
    if ($alive) { $title = Wait-MainWindowTitle -Process $proc -TimeoutSeconds 30 }
    if ($alive -and $title -match "PlayLiquid") {
      Add-Check -Id "relaunch-after-reinstall" -Status "pass" -Detail "app relaunched after the reinstall and stayed alive (title: '$title')"
    } elseif ($alive) {
      Add-Check -Id "relaunch-after-reinstall" -Status "pass" -Detail "app relaunched after the reinstall and stayed alive (no title readable)"
    } else {
      Add-Check -Id "relaunch-after-reinstall" -Status "fail" -Detail ("app exited after the reinstall during the observation window (exit code: {0})" -f $proc.ExitCode)
    }
    [void](Stop-PackagedAppProcesses)
  } else {
    Add-Check -Id "relaunch-after-reinstall" -Status "skip" -Detail "installed exe missing after reinstall — relaunch not attempted"
  }

  # 9. silent uninstall + retention ---------------------------------------
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $uninstalled = Invoke-Uninstaller -InstallLocation $installLocation
  $sw.Stop()
  if ($uninstalled) {
    Add-Check -Id "uninstall-silent" -Status "pass" -Detail ("silent uninstall (/S) removed the app files in {0:N1}s" -f $sw.Elapsed.TotalSeconds)
  } else {
    Add-Check -Id "uninstall-silent" -Status "fail" -Detail "silent uninstall (/S) did not remove the app exe within the timeout: $installedExe"
  }

  if (-not (Test-Path -LiteralPath $script:StartMenuLnk)) {
    Add-Check -Id "uninstall-shortcut-removed" -Status "pass" -Detail "Start Menu shortcut removed by the uninstaller"
  } else {
    Add-Check -Id "uninstall-shortcut-removed" -Status "fail" -Detail "Start Menu shortcut still present after uninstall: $script:StartMenuLnk"
  }

  if (-not (Get-UninstallEntry)) {
    Add-Check -Id "uninstall-registry-removed" -Status "pass" -Detail "HKCU uninstall registry entry removed by the uninstaller"
  } else {
    Add-Check -Id "uninstall-registry-removed" -Status "fail" -Detail "HKCU uninstall registry entry still present after uninstall"
  }

  if ((Test-Path -LiteralPath $script:UserdataDir) -and (Test-Path -LiteralPath $markerPath)) {
    Add-Check -Id "user-data-retained-after-uninstall" -Status "pass" -Detail "user data RETAINED after uninstall (electron-builder default keeps app data): $script:UserdataDir"
  } else {
    Add-Check -Id "user-data-retained-after-uninstall" -Status "fail" -Detail ("user data not retained after uninstall: userDataDir={0} marker={1}" -f (Test-Path -LiteralPath $script:UserdataDir), (Test-Path -LiteralPath $markerPath))
  }

  # ---------------------------------------------------------------- exit --
  $fail = @($script:Checks | Where-Object { $_.status -eq "fail" }).Count
  $ran = @($script:Checks | Where-Object { $_.status -ne "skip" }).Count
  if ($fail -gt 0)      { $exitCode = 1 }
  elseif ($ran -eq 0)   { $exitCode = 2 }
  else                  { $exitCode = 0 }
} catch {
  $fatalError = $_.Exception.Message
  Write-Log ("harness fatal error: {0}" -f $fatalError)
  Write-Log ($_.ScriptStackTrace)
  $exitCode = 3
} finally {
  # never leave installed state or processes behind on the runner
  try { [void](Stop-PackagedAppProcesses) } catch { }
  Write-Report -ExitCode $exitCode -FatalError $fatalError
}

exit $exitCode
