using System;
using System.IO;

namespace EdgePanel;

public static class Log
{
    private static readonly object Gate = new();

    public static string Directory { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EdgePanel");

    public static string FilePath { get; } = Path.Combine(Directory, "edge-panel.log");

    static Log()
    {
        System.IO.Directory.CreateDirectory(Directory);
        // Keep the log small; a fresh file per run is enough for a tray app.
        try { File.WriteAllText(FilePath, ""); } catch { }
    }

    public static void Info(string message) => Write("INFO", message);

    public static void Error(string message, Exception? ex = null) =>
        Write("ERROR", ex is null ? message : $"{message}: {ex}");

    private static void Write(string level, string message)
    {
        lock (Gate)
        {
            try { File.AppendAllText(FilePath, $"{DateTime.Now:HH:mm:ss.fff} [{level}] {message}{Environment.NewLine}"); }
            catch { }
        }
    }
}
