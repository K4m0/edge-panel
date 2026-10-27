# Installs Edge Panel into C:\Program Files\EdgePanel and starts it.
# Run from an elevated PowerShell (see docs/INSTALL.md). Works from a release zip
# (app in .\EdgePanel next to this script) or from a source checkout (app in ..\publish).
# Waits for a running copy to exit and verifies the copied exe, because copying over a
# still-locked exe can fail in a way that is easy to miss.
param(
    [string]$Source,
    [string]$Target = (Join-Path $env:ProgramFiles "EdgePanel")
)
$ErrorActionPreference = "Stop"

if (-not $Source) {
    $fromZip = Join-Path $PSScriptRoot "EdgePanel"
    $Source = if (Test-Path (Join-Path $fromZip "EdgePanel.exe")) { $fromZip } else { Join-Path $PSScriptRoot "..\publish" }
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run this script from PowerShell opened as administrator." }

$sourceExe = Join-Path $Source "EdgePanel.exe"
if (-not (Test-Path $sourceExe)) { throw "No build found at $Source. Run: dotnet publish src/EdgePanel/EdgePanel.csproj -c Release -o publish" }

Get-Process EdgePanel -ErrorAction SilentlyContinue | Stop-Process -Force
for ($i = 0; $i -lt 50 -and (Get-Process EdgePanel -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 200 }

New-Item -ItemType Directory -Force $Target | Out-Null
$targetExe = Join-Path $Target "EdgePanel.exe"
$copied = $false
for ($i = 0; $i -lt 10 -and -not $copied; $i++) {
    try {
        Copy-Item (Join-Path $Source "*") $Target -Recurse -Force
        $copied = (Get-FileHash $sourceExe).Hash -eq (Get-FileHash $targetExe).Hash
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $copied) { throw "Could not replace $targetExe" }

# Start through the scheduled task when it exists (runs elevated without a prompt), otherwise
# start it unelevated through Explorer so the app doesn't inherit this console's admin rights.
schtasks /Query /TN EdgePanel *> $null
if ($LASTEXITCODE -eq 0) { schtasks /Run /TN EdgePanel | Out-Null } else { Start-Process explorer.exe "`"$targetExe`"" }
"Installed to $Target"
