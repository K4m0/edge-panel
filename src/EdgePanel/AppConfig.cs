using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace EdgePanel;

public sealed class AppConfig
{
    public MonitorConfig Monitor { get; set; } = new();

    /// <summary>Block the physical mouse from entering the Edge; touch still works.</summary>
    public bool MouseGuard { get; set; } = true;

    /// <summary>Move any other app window that lands on the Edge back to the main display.</summary>
    public bool EvictWindows { get; set; } = true;

    /// <summary>Do not steal focus from the foreground app (e.g. a game) when the panel is touched.</summary>
    public bool NoActivate { get; set; } = true;

    public int SensorIntervalMs { get; set; } = 1000;

    public bool DevTools { get; set; }

    public List<Shortcut> Shortcuts { get; set; } = new();

    public static AppConfig Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "config.json");
        if (!File.Exists(path))
        {
            Log.Info($"No config at {path}, using defaults");
            return new AppConfig();
        }

        try
        {
            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
                ReadCommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true,
            };
            return JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(path), options) ?? new AppConfig();
        }
        catch (Exception ex)
        {
            Log.Error("Failed to read config.json, using defaults", ex);
            return new AppConfig();
        }
    }
}

public sealed class MonitorConfig
{
    /// <summary>Case-insensitive substring of the monitor's friendly (EDID) name.</summary>
    public string NameContains { get; set; } = "XENEON EDGE";

    /// <summary>Used when no monitor matches by name. Either orientation matches.</summary>
    public int FallbackWidth { get; set; } = 2560;
    public int FallbackHeight { get; set; } = 720;
}

public sealed class Shortcut
{
    public string Label { get; set; } = "";
    public string Icon { get; set; } = "";

    /// <summary>Anything ShellExecute accepts: exe path, URL, URI scheme (spotify:, steam://...).</summary>
    public string Target { get; set; } = "";
    public string? Arguments { get; set; }
}
