using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace EdgePanel;

public sealed class AppConfig
{
    /// <summary>User config lives in AppData so it survives updates and works with the single-file exe.</summary>
    public static string UserPath { get; } = Path.Combine(Log.Directory, "config.json");

    private static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "config.json");

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public MonitorConfig Monitor { get; set; } = new();

    /// <summary>Block the physical mouse from entering the Edge; touch still works.</summary>
    public bool MouseGuard { get; set; } = true;

    /// <summary>Move any other app window that lands on the Edge back to the main display.</summary>
    public bool EvictWindows { get; set; } = true;

    /// <summary>Do not steal focus from the foreground app (e.g. a game) when the panel is touched.</summary>
    public bool NoActivate { get; set; } = true;

    public int SensorIntervalMs { get; set; } = 1000;

    public bool DevTools { get; set; }

    /// <summary>Panel layout, left to right (top to bottom when the Edge is mounted vertically).</summary>
    public List<WidgetConfig> Widgets { get; set; } = new();

    public int ShortcutColumns { get; set; } = 3;

    public List<Shortcut> Shortcuts { get; set; } = new();

    public static AppConfig Load()
    {
        // First run: start from the defaults bundled next to the exe.
        var path = File.Exists(UserPath) ? UserPath : DefaultPath;
        AppConfig config;
        try
        {
            config = File.Exists(path)
                ? JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(path), JsonOptions) ?? new AppConfig()
                : new AppConfig();
            Log.Info($"Config loaded from {path}");
        }
        catch (Exception ex)
        {
            Log.Error($"Failed to read {path}, using defaults", ex);
            config = new AppConfig();
        }

        config.Normalize();
        return config;
    }

    public void Save()
    {
        Normalize();
        Directory.CreateDirectory(Path.GetDirectoryName(UserPath)!);
        File.WriteAllText(UserPath, JsonSerializer.Serialize(this, JsonOptions));
        Log.Info($"Config saved to {UserPath}");
    }

    /// <summary>Drops unknown widget types and duplicates, appends missing ones (disabled), clamps values.</summary>
    public void Normalize()
    {
        if (Widgets.Count == 0) Widgets = WidgetConfig.Defaults();

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Widgets = Widgets
            .Where(w => WidgetConfig.KnownTypes.Contains(w.Type, StringComparer.OrdinalIgnoreCase) && seen.Add(w.Type))
            .ToList();
        foreach (var type in WidgetConfig.KnownTypes.Where(t => !seen.Contains(t)))
            Widgets.Add(new WidgetConfig { Type = type, Enabled = false, Size = 1 });

        foreach (var w in Widgets)
        {
            w.Type = w.Type.ToLowerInvariant();
            w.Size = Math.Clamp(w.Size, 0.3, 4);
        }

        Shortcuts = Shortcuts.Where(s => !string.IsNullOrWhiteSpace(s.Target)).ToList();
        ShortcutColumns = Math.Clamp(ShortcutColumns, 1, 6);
        SensorIntervalMs = Math.Clamp(SensorIntervalMs, 250, 10000);
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

public sealed class WidgetConfig
{
    public static readonly string[] KnownTypes = { "clock", "cpu", "gpu", "ram", "media", "shortcuts" };

    public string Type { get; set; } = "";
    public bool Enabled { get; set; } = true;

    /// <summary>Relative width (height in portrait) compared with the other widgets.</summary>
    public double Size { get; set; } = 1;

    public static List<WidgetConfig> Defaults() => new()
    {
        new() { Type = "clock", Size = 1.3 },
        new() { Type = "cpu", Size = 0.8 },
        new() { Type = "gpu", Size = 0.8 },
        new() { Type = "ram", Size = 0.8 },
        new() { Type = "media", Size = 1.7 },
        new() { Type = "shortcuts", Size = 1.6 },
    };
}

public sealed class Shortcut
{
    public string Label { get; set; } = "";
    public string Icon { get; set; } = "app";

    /// <summary>Anything ShellExecute accepts: exe path, URL, URI scheme (spotify:, steam://...).</summary>
    public string Target { get; set; } = "";
    public string? Arguments { get; set; }
}
