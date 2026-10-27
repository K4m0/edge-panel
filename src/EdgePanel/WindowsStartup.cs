using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Security;
using System.Security.Principal;
using Microsoft.Win32;

namespace EdgePanel;

/// <summary>
/// "Start with Windows" and "Run as administrator".
/// Normal mode uses the per-user Run key. Admin mode uses a scheduled task with highest privileges
/// instead, because Windows never elevates Run-key entries; the task also lets the app relaunch itself
/// elevated without a UAC prompt (CPU temperatures need admin).
///
/// Security: a prompt-free elevated task is only safe when nobody without admin rights can change
/// what it runs. So admin mode is refused unless the exe lives in Program Files, and the task is
/// registered in memory through the Task Scheduler API by an elevated copy of the app (no temp file
/// that could be swapped before an elevated tool reads it).
/// </summary>
public static class WindowsStartup
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "EdgePanel";
    private const string TaskName = "EdgePanel";
    public const string ElevatedArg = "--elevated";
    public const string RegisterTaskArg = "--register-task";
    public const string UnregisterTaskArg = "--unregister-task";

    private static string ExePath => Environment.ProcessPath ?? throw new InvalidOperationException("No process path");

    public static bool IsElevated { get; } =
        new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);

    /// <summary>Program Files is writable only by administrators, so an elevated task can safely point there.</summary>
    public static bool IsInProtectedLocation
    {
        get
        {
            var dir = Path.GetFullPath(Path.GetDirectoryName(ExePath) ?? "") + Path.DirectorySeparatorChar;
            foreach (var folder in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 })
            {
                var root = Environment.GetFolderPath(folder);
                if (root.Length > 0 && dir.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
    }

    // Cached so the tray menu and settings don't query the Task Scheduler on the UI thread every time.
    private static bool? _taskStartsAtLogon;

    public static bool IsEnabled() => RunKeyMatches() || (_taskStartsAtLogon ??= TaskStartsAtLogon());

    /// <summary>Applies both settings. Returns an error message, or null on success.</summary>
    public static string? Apply(bool startWithWindows, bool runAsAdmin)
    {
        string? error = null;
        if (runAsAdmin)
        {
            if (!IsInProtectedLocation)
            {
                error = "Run as administrator needs Edge Panel installed in Program Files (see the install guide).";
                SetRunKey(startWithWindows);
            }
            else if (RunElevatedHelper(RegisterTaskArg, startWithWindows ? "1" : "0"))
            {
                // Keep the task even when not starting at logon: it is what makes elevated relaunches prompt-free.
                SetRunKey(false);
            }
            else
            {
                error = "Windows did not allow creating the startup task.";
                SetRunKey(startWithWindows);
            }
        }
        else
        {
            if (TaskExists() && !RunElevatedHelper(UnregisterTaskArg, null)) error = "Windows did not allow removing the startup task.";
            SetRunKey(startWithWindows);
        }

        _taskStartsAtLogon = null;
        Log.Info($"Startup applied: startWithWindows={startWithWindows}, runAsAdmin={runAsAdmin}, error={error ?? "none"}");
        return error;
    }

    /// <summary>
    /// Starts an elevated copy of the app: through the scheduled task when it exists (no prompt),
    /// otherwise with a UAC prompt. Returns false when it could not start one.
    /// </summary>
    public static bool StartElevatedCopy()
    {
        if (!IsInProtectedLocation) return false;
        if (TaskScheduler.Run(TaskName)) return true;

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

    /// <summary>
    /// Handles the helper command lines, run in an elevated copy of the app. Returns the process exit code,
    /// or null when the arguments are not a helper command.
    /// </summary>
    public static int? HandleHelperCommand(string[] args)
    {
        if (args.Length == 0 || (args[0] != RegisterTaskArg && args[0] != UnregisterTaskArg)) return null;
        if (!IsElevated || !IsInProtectedLocation) return 2;
        try
        {
            if (args[0] == UnregisterTaskArg) return TaskScheduler.Delete(TaskName) ? 0 : 1;
            var atLogon = args.Length > 1 && args[1] == "1";
            return TaskScheduler.Register(TaskName, TaskXml(atLogon)) ? 0 : 1;
        }
        catch (Exception ex)
        {
            Log.Error("Task helper failed", ex);
            return 1;
        }
    }

    private static bool RunElevatedHelper(string command, string? arg)
    {
        try
        {
            if (IsElevated)
                return HandleHelperCommand(arg is null ? new[] { command } : new[] { command, arg }) == 0;

            using var p = Process.Start(new ProcessStartInfo(ExePath, arg is null ? command : $"{command} {arg}")
            {
                UseShellExecute = true,
                Verb = "runas",
            })!;
            p.WaitForExit(30000);
            return p.HasExited && p.ExitCode == 0;
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            Log.Info($"UAC declined for {command}");
            return false;
        }
        catch (Exception ex)
        {
            Log.Error($"{command} failed", ex);
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

    private static bool TaskExists() => TaskScheduler.GetXml(TaskName) is not null;

    private static bool TaskStartsAtLogon()
    {
        var xml = TaskScheduler.GetXml(TaskName);
        if (xml is null) return false;
        var start = xml.IndexOf("<LogonTrigger>", StringComparison.Ordinal);
        var end = xml.IndexOf("</LogonTrigger>", StringComparison.Ordinal);
        return start >= 0 && end > start && !xml[start..end].Contains("<Enabled>false</Enabled>", StringComparison.Ordinal);
    }

    private static string TaskXml(bool startAtLogon)
    {
        var user = SecurityElement.Escape(WindowsIdentity.GetCurrent().Name);
        var exe = SecurityElement.Escape(ExePath);
        var dir = SecurityElement.Escape(Path.GetDirectoryName(ExePath) ?? "");
        return $"""
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
    }

    /// <summary>Minimal late-bound wrapper over the Task Scheduler 2.0 COM API (Schedule.Service).</summary>
    private static class TaskScheduler
    {
        private const int TASK_CREATE_OR_UPDATE = 6;
        private const int TASK_LOGON_INTERACTIVE_TOKEN = 3;

        private static dynamic? RootFolder()
        {
            var type = Type.GetTypeFromProgID("Schedule.Service");
            if (type is null) return null;
            dynamic service = Activator.CreateInstance(type)!;
            service.Connect();
            return service.GetFolder("\\");
        }

        public static string? GetXml(string name)
        {
            try { return (string)RootFolder()!.GetTask(name).Xml; }
            catch { return null; } // missing, or not readable
        }

        public static bool Register(string name, string xml)
        {
            RootFolder()!.RegisterTask(name, xml, TASK_CREATE_OR_UPDATE, null, null, TASK_LOGON_INTERACTIVE_TOKEN);
            Log.Info("Startup task registered");
            return true;
        }

        public static bool Delete(string name)
        {
            try { RootFolder()!.DeleteTask(name, 0); }
            catch (Exception ex) { Log.Error("Deleting the startup task failed", ex); return false; }
            return true;
        }

        public static bool Run(string name)
        {
            try
            {
                RootFolder()!.GetTask(name).Run(null);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
