using System;
using Microsoft.Win32;

namespace EdgePanel;

/// <summary>"Start with Windows" through the per-user Run key (no admin needed).</summary>
public static class WindowsStartup
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "EdgePanel";

    private static string ExePath => Environment.ProcessPath ?? throw new InvalidOperationException("No process path");

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) is string value &&
               value.Trim('"').Equals(ExePath, StringComparison.OrdinalIgnoreCase);
    }

    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled)
            key.SetValue(ValueName, $"\"{ExePath}\"");
        else
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        Log.Info($"Start with Windows: {enabled}");
    }
}
