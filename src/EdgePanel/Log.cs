using System;
using System.Collections.Generic;
using System.IO;

namespace EdgePanel;

/// <summary>
/// Small file log for a tray app that runs 24/7: the file is capped (rolled over to .old at 1 MB)
/// and a message that repeats (e.g. a failing sensor every tick) is written at most once a minute.
/// </summary>
public static class Log
{
    private const long MaxBytes = 1024 * 1024;
    private static readonly TimeSpan RepeatWindow = TimeSpan.FromMinutes(1);

    private static readonly object Gate = new();
    private static readonly Dictionary<string, DateTime> LastWritten = new();

    public static string Directory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EdgePanel");

    public static string FilePath { get; } = Path.Combine(Directory, "edge-panel.log");

    static Log() => System.IO.Directory.CreateDirectory(Directory);

    public static void Info(string message) => Write("INFO", message);

    public static void Error(string message, Exception? ex = null) =>
        Write("ERROR", ex is null ? message : $"{message}: {ex.GetType().Name}: {ex.Message}");

    private static void Write(string level, string message)
    {
        lock (Gate)
        {
            try
            {
                var now = DateTime.Now;
                var key = level + message;
                if (LastWritten.TryGetValue(key, out var last) && now - last < RepeatWindow) return;
                LastWritten[key] = now;
                if (LastWritten.Count > 500) LastWritten.Clear();

                var info = new FileInfo(FilePath);
                if (info.Exists && info.Length > MaxBytes) File.Move(FilePath, FilePath + ".old", overwrite: true);

                File.AppendAllText(FilePath, $"{now:yyyy-MM-dd HH:mm:ss.fff} [{level}] {message}{Environment.NewLine}");
            }
            catch { }
        }
    }
}
