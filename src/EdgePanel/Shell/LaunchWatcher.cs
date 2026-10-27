using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using EdgePanel.Native;
using static EdgePanel.Native.NativeMethods;

namespace EdgePanel.Shell;

public enum LaunchResult
{
    Opened,
    Failed,
    TimedOut,
}

/// <summary>
/// Launches something and waits until it visibly opened, so the panel can show a "loading" state
/// that ends when the app is up. ShellExecute through the desktop shell gives no process handle,
/// so "opened" is observed instead: a different window comes to the foreground (the usual case,
/// and also what happens when the app was already running), or a new app window appears,
/// preferably one from the expected exe.
/// </summary>
public static class LaunchWatcher
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(150);

    /// <summary>After this, a new window from any process counts (launcher stubs often start another exe).</summary>
    private static readonly TimeSpan StrictMatchFor = TimeSpan.FromSeconds(3);

    private static readonly HashSet<string> ShellClasses = new(StringComparer.OrdinalIgnoreCase)
    {
        "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW", "#32768", "tooltips_class32",
    };

    /// <summary>Must be called on the UI (STA) thread: the launch itself may use shell COM objects.</summary>
    public static async Task<LaunchResult> LaunchAndWaitAsync(Action launch, string target, TimeSpan timeout)
    {
        var expected = ExpectedProcessName(target);
        var before = new HashSet<IntPtr>(AppWindows());
        var foreground = GetForegroundWindow();

        try
        {
            launch();
        }
        catch (Exception ex)
        {
            Log.Error($"Launch '{target}' failed", ex);
            return LaunchResult.Failed;
        }

        var started = DateTime.Now;
        while (DateTime.Now - started < timeout)
        {
            await Task.Delay(PollInterval);

            var current = GetForegroundWindow();
            if (current != foreground && current != IntPtr.Zero && IsAppWindow(current)) return LaunchResult.Opened;

            var strict = expected is not null && DateTime.Now - started < StrictMatchFor;
            foreach (var hwnd in AppWindows())
            {
                if (before.Contains(hwnd)) continue;
                if (!strict || ProcessNameOf(hwnd)?.Equals(expected, StringComparison.OrdinalIgnoreCase) == true)
                    return LaunchResult.Opened;
            }
        }

        Log.Info($"Launch '{target}': no window seen within {timeout.TotalSeconds:0}s");
        return LaunchResult.TimedOut;
    }

    /// <summary>Exe name (without .exe) the launch should produce, when it can be known.</summary>
    private static string? ExpectedProcessName(string target)
    {
        try
        {
            var ext = Path.GetExtension(target);
            if (ext.Equals(".exe", StringComparison.OrdinalIgnoreCase)) return Path.GetFileNameWithoutExtension(target);
            if (ext.Equals(".lnk", StringComparison.OrdinalIgnoreCase) && File.Exists(target))
            {
                var type = Type.GetTypeFromProgID("WScript.Shell");
                if (type is null) return null;
                dynamic shell = Activator.CreateInstance(type)!;
                try
                {
                    string resolved = shell.CreateShortcut(target).TargetPath;
                    return resolved.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? Path.GetFileNameWithoutExtension(resolved) : null;
                }
                finally
                {
                    Marshal.FinalReleaseComObject(shell);
                }
            }
        }
        catch
        {
            // Unknown target type (URL, URI, folder, document): any new window counts.
        }
        return null;
    }

    private static List<IntPtr> AppWindows()
    {
        var list = new List<IntPtr>();
        EnumWindows((hwnd, _) =>
        {
            if (IsAppWindow(hwnd)) list.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    /// <summary>A visible, normal top-level window of another process (not shell chrome, tool windows or ours).</summary>
    private static bool IsAppWindow(IntPtr hwnd)
    {
        if (!IsWindowVisible(hwnd)) return false;
        if ((GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64() & WS_EX_TOOLWINDOW) != 0) return false;
        if (!GetWindowRect(hwnd, out var r) || r.Width < 80 || r.Height < 60) return false;

        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == (uint)Environment.ProcessId) return false;

        var cls = new System.Text.StringBuilder(64);
        GetClassName(hwnd, cls, cls.Capacity);
        return !ShellClasses.Contains(cls.ToString());
    }

    private static string? ProcessNameOf(IntPtr hwnd)
    {
        GetWindowThreadProcessId(hwnd, out var pid);
        try
        {
            using var p = Process.GetProcessById((int)pid);
            return p.ProcessName;
        }
        catch
        {
            return null;
        }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
}
