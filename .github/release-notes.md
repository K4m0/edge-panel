A lightweight touch dashboard for the Corsair XENEON EDGE that runs without iCUE.

## Install

1. Download `EdgePanel-<version>-win-x64.zip` below and extract it.
2. Open **PowerShell as administrator** in the extracted folder and run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
   ```

   This installs Edge Panel to `C:\Program Files\EdgePanel` and starts it. .NET does not need to be installed.

3. Follow the first-time setup in [INSTALL.md](https://github.com/K4m0/edge-panel/blob/main/docs/INSTALL.md#4-first-setup): close iCUE, map touch to the Edge, and open Settings from the tray icon.

The app is not code-signed yet, so Windows SmartScreen may show a warning the first time. To check your download, compare its SHA-256 with the `.sha256` file attached to this release:

```powershell
Get-FileHash .\EdgePanel-*-win-x64.zip
```

Built by GitHub Actions from the tagged source.
