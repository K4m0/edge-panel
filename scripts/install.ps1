# Installs publish\EdgePanel.exe into C:\Program Files\EdgePanel and restarts it.
# Run elevated. Waits for the running copy to exit and verifies the copied file,
# because a copy over a still-locked exe fails silently enough to be missed.
param(
    [string]$Source = (Join-Path $PSScriptRoot "..\publish\EdgePanel.exe"),
    [string]$Target = "C:\Program Files\EdgePanel\EdgePanel.exe"
)
$ErrorActionPreference = "Stop"

Get-Process EdgePanel -ErrorAction SilentlyContinue | Stop-Process -Force
for ($i = 0; $i -lt 50 -and (Get-Process EdgePanel -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 200 }

New-Item -ItemType Directory -Force (Split-Path $Target) | Out-Null
$copied = $false
for ($i = 0; $i -lt 10 -and -not $copied; $i++) {
    try {
        Copy-Item $Source $Target -Force
        $copied = (Get-FileHash $Source).Hash -eq (Get-FileHash $Target).Hash
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $copied) { throw "Could not replace $Target" }

# Start through the scheduled task when it exists (runs elevated without a prompt), otherwise directly.
schtasks /Query /TN EdgePanel *> $null
if ($LASTEXITCODE -eq 0) { schtasks /Run /TN EdgePanel | Out-Null } else { Start-Process $Target }
"Installed $Target"
