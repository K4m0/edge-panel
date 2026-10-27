# Third-party notices

Edge Panel is licensed under the [Apache License 2.0](LICENSE). It uses the following third-party components. Each one keeps its own license.

| Component | License | Source |
| --- | --- | --- |
| [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) | MPL-2.0 | https://github.com/LibreHardwareMonitor/LibreHardwareMonitor |
| [HidSharp](https://www.zer7.com/software/hidsharp) (used by LibreHardwareMonitorLib) | Apache-2.0 | https://www.zer7.com/software/hidsharp |
| [NAudio](https://github.com/naudio/NAudio) (NAudio.Core, NAudio.Wasapi) | MIT | https://github.com/naudio/NAudio |
| [Microsoft Edge WebView2 SDK](https://www.nuget.org/packages/Microsoft.Web.WebView2) | Microsoft WebView2 SDK license (BSD-style) | https://www.nuget.org/packages/Microsoft.Web.WebView2 |
| [.NET runtime and libraries](https://github.com/dotnet/runtime) (bundled in self-contained builds), including System.Management, System.IO.Ports and System.IO.FileSystem.AccessControl | MIT | https://github.com/dotnet/runtime |
| [Mono.Posix.NETStandard](https://www.nuget.org/packages/Mono.Posix.NETStandard) (used by LibreHardwareMonitorLib) | MIT | https://github.com/mono/mono |

**LibreHardwareMonitorLib (MPL-2.0).** Edge Panel uses the unmodified library. Its source code is available at the link above, and if you modify it you must publish those changes under MPL-2.0.

## Services used at run time

These are optional. They are contacted only when you add the related widget.

- **Weather and AQI:** [Open-Meteo](https://open-meteo.com). Data is [CC BY 4.0](https://open-meteo.com/en/license), with attribution to Open-Meteo.
- **YouTube Video and Twitch Chat:** official embeds. Their own terms apply.

## Fonts and icons

The panel uses fonts that ship with Windows: Segoe UI, and Segoe Fluent Icons or Segoe MDL2 Assets. The app does not redistribute them. The widget icons in `wwwroot/icons.js` are simple SVG paths. Some of them follow the shapes of [Google Material Icons](https://github.com/google/material-design-icons), which are licensed under Apache-2.0.
