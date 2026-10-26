using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Security;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32;

namespace EdgePanel;

/// <summary>
/// "Start with Windows" and "Run as administrator".
/// Normal mode uses the per-user Run key. Admin mode uses a scheduled task with highest
/// privileges instead, because Windows never elevates Run-key entries; the task also lets
/// the app relaunch itself elevated without a UAC prompt (CPU temperatures need admin).
/// </summary>
public static class WindowsStartup
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "EdgePanel";
    private const string TaskName = "EdgePanel";
    public const string ElevatedArg = "--elevated";

    private static string ExePath => Environment.ProcessPath ?? throw new InvalidOperationException("No process path");

    public static bool IsElevated { get; } =
        new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);

    public static bool IsEnabled() => RunKeyMatches() || TaskStartsAtLogon();

    /// <summary>Applies both settings. Returns false when a needed UAC prompt was declined.</summary>
    public static bool Apply(bool startWithWindows, bool runAsAdmin)
    {
        var ok = true;
        if (runAsAdmin)
        {
            // Keep the task even when not starting at logon: it is what makes elevated relaunches prompt-free.
            ok = CreateTask(startAtLogon: startWithWindows);
            SetRunKey(false);
        }
        else
        {
            if (TaskExists()) ok = RunSchtasks($"/Delete /TN {TaskName} /F", elevate: true);
            SetRunKey(startWithWindows);
        }
        Log.Info($"Startup applied: startWithWindows={startWithWindows}, runAsAdmin={runAsAdmin}, ok={ok}");
        return ok;
    }

    /// <summary>
    /// Starts an elevated copy of the app: through the scheduled task when it exists (no prompt),
    /// otherwise with a UAC prompt. Returns false when it could not start one.
    /// </summary>
    public static bool StartElevatedCopy()
    {
        if (TaskExists() && RunSchtasks($"/Run /TN {TaskName}", elevate: false)) return true;

        try
        {
            Process.Start(new ProcessStartInfo(ExePath, ElevatedArg) { UseShellExecute = true, Verb = "runas" });
            return true;
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223) // UAC prompt cancelled
        {
            Log.Info("Elevation declined by the user");
            return false;
        }
    }

    private static bool RunKeyMatches()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(ValueName) is string value &&
               value.Trim('"').Equals(ExePath, StringComparison.OrdinalIgnoreCase);
    }

    private static void SetRunKey(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled)
            key.SetValue(ValueName, $"\"{ExePath}\"");
        else
            key.DeleteValue(ValueName, throwOnMissingValue: false);
    }

    private static bool TaskExists() => QueryTaskXml() is not null;

    private static bool TaskStartsAtLogon()
    {
        var xml = QueryTaskXml();
        if (xml is null) return false;
        var start = xml.IndexOf("<LogonTrigger>", StringComparison.Ordinal);
        var end = xml.IndexOf("</LogonTrigger>", StringComparison.Ordinal);
        return start >= 0 && end > start && !xml[start..end].Contains("<Enabled>false</Enabled>", StringComparison.Ordinal);
    }

    private static string? QueryTaskXml()
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("schtasks.exe", $"/Query /TN {TaskName} /XML")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            })!;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(5000);
            return p.ExitCode == 0 ? output : null;
        }
        catch (Exception ex)
        {
            Log.Error("schtasks query failed", ex);
            return null;
        }
    }

    private static bool CreateTask(bool startAtLogon)
    {
        var user = SecurityElement.Escape(WindowsIdentity.GetCurrent().Name);
        var exe = SecurityElement.Escape(ExePath);
        var dir = SecurityElement.Escape(Path.GetDirectoryName(ExePath) ?? "");
        var xml = $"""
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <RegistrationInfo><Description>Edge Panel, elevated so CPU temperatures can be read.</Description></RegistrationInfo>
              <Triggers>
                <LogonTrigger><Enabled>{(startAtLogon ? "true" : "false")}</Enabled><UserId>{user}</UserId><Delay>PT5S</Delay></LogonTrigger>
              </Triggers>
              <Principals>
                <Principal id="Author"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal>
              </Principals>
              <Settings>
                <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
                <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
                <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
                <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
                <Priority>5</Priority>
              </Settings>
              <Actions Context="Author">
                <Exec><Command>"{exe}"</Command><Arguments>{ElevatedArg}</Arguments><WorkingDirectory>{dir}</WorkingDirectory></Exec>
              </Actions>
            </Task>
            """;

        var file = Path.Combine(Path.GetTempPath(), "EdgePanel.task.xml");
        File.WriteAllText(file, xml, Encoding.Unicode);
        try
        {
            return RunSchtasks($"/Create /TN {TaskName} /XML \"{file}\" /F", elevate: true);
        }
        finally
        {
            try { File.Delete(file); } catch { }
        }
    }

    /// <summary>Runs schtasks, through a UAC prompt when <paramref name="elevate"/> and not already elevated.</summary>
    private static bool RunSchtasks(string args, bool elevate)
    {
        try
        {
            var useUac = elevate && !IsElevated;
            using var p = Process.Start(new ProcessStartInfo("schtasks.exe", args)
            {
                UseShellExecute = useUac,
                Verb = useUac ? "runas" : "",
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            })!;
            p.WaitForExit(15000);
            if (p.ExitCode != 0) Log.Error($"schtasks {args} exited with {p.ExitCode}");
            return p.ExitCode == 0;
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            Log.Info($"UAC declined for schtasks {args}");
            return false;
        }
        catch (Exception ex)
        {
            Log.Error($"schtasks {args} failed", ex);
            return false;
        }
    }
}
