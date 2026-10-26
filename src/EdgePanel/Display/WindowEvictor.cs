using System;
using System.Collections.Generic;
using System.Text;
using EdgePanel.Native;
using static EdgePanel.Native.NativeMethods;

namespace EdgePanel.Display;

/// <summary>
/// Moves other apps' top-level windows off the Edge so it never behaves like a
/// regular extended desktop (Win+Shift+Arrow, apps restoring their last position, etc.).
/// </summary>
public static class WindowEvictor
{
    private const uint GW_OWNER = 4;

    private static readonly HashSet<string> IgnoredClasses = new(StringComparer.OrdinalIgnoreCase)
    {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
        "#32768", // menus
        "tooltips_class32", "NotifyIconOverflowWindow", "Windows.UI.Core.CoreWindow",
        "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland",
    };

    public static void Run(MonitorInfo edge, MonitorInfo destination, uint ownProcessId)
    {
        var className = new StringBuilder(256);

        EnumWindows((hwnd, _) =>
        {
            try
            {
                if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
                if (MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL) != edge.Handle) return true;

                GetWindowThreadProcessId(hwnd, out var pid);
                if (pid == ownProcessId) return true;

                if (GetWindow(hwnd, GW_OWNER) != IntPtr.Zero) return true; // dialogs/popups follow their owner

                var exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
                if ((exStyle & WS_EX_TOOLWINDOW) != 0) return true;

                if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out var cloaked, sizeof(int)) == 0 && cloaked != 0)
                    return true;

                className.Clear();
                GetClassName(hwnd, className, className.Capacity);
                if (IgnoredClasses.Contains(className.ToString())) return true;

                if (!GetWindowRect(hwnd, out var rect) || rect.Width < 50 || rect.Height < 50) return true;

                Move(hwnd, rect, edge.Bounds, destination.WorkArea);
                Log.Info($"Evicted window '{className}' from the Edge");
            }
            catch (Exception ex)
            {
                Log.Error("Evict failed", ex);
            }
            return true;
        }, IntPtr.Zero);
    }

    private static void Move(IntPtr hwnd, RECT rect, RECT from, RECT to)
    {
        var maximized = IsZoomed(hwnd);
        if (maximized) ShowWindow(hwnd, SW_RESTORE);

        // Keep the same relative position, clamped to the destination work area.
        var width = Math.Min(rect.Width, to.Width);
        var height = Math.Min(rect.Height, to.Height);
        var x = to.Left + Math.Clamp(rect.Left - from.Left, 0, Math.Max(0, to.Width - width));
        var y = to.Top + Math.Clamp(rect.Top - from.Top, 0, Math.Max(0, to.Height - height));

        SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE);

        if (maximized) ShowWindow(hwnd, SW_MAXIMIZE);
    }
}
