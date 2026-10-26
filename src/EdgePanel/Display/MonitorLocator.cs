using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using EdgePanel.Native;
using static EdgePanel.Native.NativeMethods;

namespace EdgePanel.Display;

public sealed record MonitorInfo(
    IntPtr Handle,
    string GdiName,
    string FriendlyName,
    RECT Bounds,
    RECT WorkArea,
    bool IsPrimary)
{
    public override string ToString() =>
        $"{GdiName} \"{FriendlyName}\" {Bounds}{(IsPrimary ? " primary" : "")}";
}

/// <summary>
/// Enumerates monitors and identifies the Xeneon Edge by its EDID friendly name
/// (never by index, because indices shuffle when another display is turned off).
/// </summary>
public static class MonitorLocator
{
    public static List<MonitorInfo> GetMonitors()
    {
        var friendlyNames = GetFriendlyNamesByGdiName();
        var result = new List<MonitorInfo>();

        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr handle, IntPtr hdc, ref RECT rect, IntPtr data) =>
        {
            var info = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (GetMonitorInfo(handle, ref info))
            {
                friendlyNames.TryGetValue(info.szDevice, out var friendly);
                result.Add(new MonitorInfo(handle, info.szDevice, friendly ?? "", info.rcMonitor, info.rcWork,
                    (info.dwFlags & MONITORINFOF_PRIMARY) != 0));
            }
            return true;
        }, IntPtr.Zero);

        return result;
    }

    public static MonitorInfo? FindEdge(IReadOnlyList<MonitorInfo> monitors, MonitorConfig config)
    {
        if (!string.IsNullOrWhiteSpace(config.NameContains))
        {
            var byName = monitors.FirstOrDefault(m =>
                m.FriendlyName.Contains(config.NameContains, StringComparison.OrdinalIgnoreCase));
            if (byName is not null) return byName;
        }

        return monitors.FirstOrDefault(m =>
            (m.Bounds.Width == config.FallbackWidth && m.Bounds.Height == config.FallbackHeight) ||
            (m.Bounds.Width == config.FallbackHeight && m.Bounds.Height == config.FallbackWidth));
    }

    /// <summary>Maps "\\.\DISPLAYn" to the EDID friendly name via the DisplayConfig API.</summary>
    private static Dictionary<string, string> GetFriendlyNamesByGdiName()
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out var pathCount, out var modeCount) != 0)
            return map;

        var paths = new DISPLAYCONFIG_PATH_INFO[pathCount];
        var modes = new DISPLAYCONFIG_MODE_INFO[modeCount];
        if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero) != 0)
            return map;

        for (var i = 0; i < pathCount; i++)
        {
            var path = paths[i];

            var source = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
            source.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            source.header.size = (uint)Marshal.SizeOf<DISPLAYCONFIG_SOURCE_DEVICE_NAME>();
            source.header.adapterId = path.sourceInfo.adapterId;
            source.header.id = path.sourceInfo.id;
            if (DisplayConfigGetDeviceInfo(ref source) != 0) continue;

            var target = new DISPLAYCONFIG_TARGET_DEVICE_NAME();
            target.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            target.header.size = (uint)Marshal.SizeOf<DISPLAYCONFIG_TARGET_DEVICE_NAME>();
            target.header.adapterId = path.targetInfo.adapterId;
            target.header.id = path.targetInfo.id;
            if (DisplayConfigGetDeviceInfo(ref target) != 0) continue;

            map[source.viewGdiDeviceName] = target.monitorFriendlyDeviceName;
        }

        return map;
    }
}
