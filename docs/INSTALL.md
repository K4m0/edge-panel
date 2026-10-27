# Installing Edge Panel

This guide covers building Edge Panel from source, installing it, and setting it up on a Corsair XENEON EDGE.

## 1. What you need

- **Windows 10 (version 2004 or later) or Windows 11, 64-bit.**
- **A Corsair XENEON EDGE** connected over DisplayPort or USB-C, plus the USB cable for touch.
- **To build from source only:** the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) and [Git](https://git-scm.com/download/win). Release downloads are self-contained and run without .NET installed.
- **Microsoft Edge WebView2 Runtime.** Windows 11 already has it. On Windows 10, [download it here](https://developer.microsoft.com/microsoft-edge/webview2/#download-section) if needed.
- **Optional: [Elgato Stream Deck](https://www.elgato.com/downloads) 7 or later**, if you want the Stream Deck widget.

## 2. Get the app

### Option A: download a release (no .NET needed)

1. Download the latest `EdgePanel-<version>-win-x64.zip` from [Releases](https://github.com/K4m0/edge-panel/releases).
2. Extract it. You get an `EdgePanel` folder, `install.ps1` and the license files.
3. Continue with [3. Install](#3-install), running the script from the extracted folder instead of the cloned repository.

### Option B: build from source

Open a terminal (PowerShell or Command Prompt) and run:

```bash
git clone https://github.com/K4m0/edge-panel.git
```

```bash
cd edge-panel
```

```bash
dotnet publish src/EdgePanel/EdgePanel.csproj -c Release -o publish
```

The `publish` folder now holds `EdgePanel.exe`, a few native DLLs and the `wwwroot` folder. Keep them together.

## 3. Install

Install Edge Panel in **Program Files**. That folder can only be changed by administrators, which is what makes **Run as administrator** safe to use. That option is needed for CPU temperatures.

1. Open **PowerShell as administrator**: Start menu → type `PowerShell` → *Run as administrator*.
2. Go to the extracted release folder, or to the folder you cloned. For example:

   ```powershell
   cd "$env:USERPROFILE\Downloads\EdgePanel-v0.4.0-win-x64"
   ```

3. Run the install script. It closes any running copy, copies the app to `C:\Program Files\EdgePanel`, checks the copy, and starts the app:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install.ps1
   ```

   The `-ExecutionPolicy Bypass` part applies only to this one command. It does not change your system settings.

4. Optional: create a Start menu shortcut, then pin it to the taskbar or Start:

   ```powershell
   $s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Edge Panel.lnk"); $s.TargetPath = "C:\Program Files\EdgePanel\EdgePanel.exe"; $s.Save()
   ```

To update later, download the new release (or pull and run `dotnet publish` again) and run the install script again. Your settings are kept.

The release build is not code-signed yet, so Windows SmartScreen may warn about it the first time. Each release lists the zip's SHA-256 so you can check your download.

## 4. First setup

1. **Close iCUE,** or switch its Edge screen to **Desktop** mode, so the two apps don't fight over the display.
2. **Map touch to the Edge.** Go to *Control Panel → Hardware and Sound → Tablet PC Settings → Setup… → Touch input*. Press Enter on your main screen until the prompt appears on the Edge, then tap it there.
3. **Find the tray icon.** Edge Panel runs in the system tray. Drag its icon out of the overflow (^) if you want it always visible. Left-click it to open **Settings**; right-click it for quick options.
4. **Settings → App Settings:**
   - **Start with Windows** starts Edge Panel when you sign in.
   - **Run as administrator** is needed to show CPU temperatures. Windows asks for permission once and then starts Edge Panel elevated without prompts. This only works when Edge Panel is installed in Program Files.
5. **Settings → Widgets.** Drag widgets from the catalog onto the preview. Click a widget to change its settings. Drop a widget onto another one to swap them.

## 5. Stream Deck widget (optional)

1. In the Stream Deck app, open the device menu (top left) → **Add Virtual Device…**, choose a size (4 × 2 fits the Edge well), and set up your keys or copy your profile.
2. In Edge Panel, add the **Stream Deck** widget, select it, and press **Link Virtual Stream Deck**.
3. With **Fill the widget** turned on, Edge Panel resizes the deck's keys to fill the widget. Stream Deck restarts once when the size changes. Before changing anything, Edge Panel backs up the Stream Deck settings to `%LOCALAPPDATA%\EdgePanel`.

## 6. Where things are stored

| What | Where |
| --- | --- |
| App | `C:\Program Files\EdgePanel` |
| Settings | `%LOCALAPPDATA%\EdgePanel\config.json` |
| Images and videos you add | `%LOCALAPPDATA%\EdgePanel\media` |
| Log | `%LOCALAPPDATA%\EdgePanel\edge-panel.log` |

Edge Panel collects no data and sends nothing anywhere. The only network requests are the ones made by the widgets you add: weather and AQI (Open-Meteo), YouTube, Twitch, and the Web URL widget.

## 7. Uninstall

1. In Edge Panel, turn off **Start with Windows** and **Run as administrator**, then choose **Exit** from the tray menu.
2. In PowerShell as administrator, run each of these:

   ```powershell
   Remove-Item "C:\Program Files\EdgePanel" -Recurse -Force
   ```

   ```powershell
   schtasks /Delete /TN EdgePanel /F
   ```

   ```powershell
   Remove-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -Name EdgePanel -ErrorAction SilentlyContinue
   ```

3. Optional: delete your settings, which permanently removes your layout and media:

   ```powershell
   Remove-Item "$env:LOCALAPPDATA\EdgePanel" -Recurse -Force
   ```

## Troubleshooting

- **The panel shows up on the wrong screen, or not at all.** Edge Panel looks for a monitor named `XENEON EDGE`. Check the monitor list in the log, then set the name under *Settings → Screen Setup*.
- **Touch lands on the main screen.** Redo the touch mapping in step 4.2.
- **CPU temperature shows `--`.** Turn on *Run as administrator*. Edge Panel must be in Program Files.
- **"Run as administrator needs Edge Panel installed in Program Files".** Install it with the script in step 3, then turn the option on again.
