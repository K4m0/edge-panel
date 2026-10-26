using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace EdgePanel;

/// <summary>
/// User configuration (schema v3, see docs/ARCHITECTURE.md).
/// Widget <c>settings</c>/<c>style</c> stay raw JSON so new widget fields need no C# change;
/// the host only reads launcher apps and deck buttons.
/// </summary>
public sealed class AppConfig
{
    public const int CurrentVersion = 3;

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
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    public int Version { get; set; } = CurrentVersion;

    public MonitorConfig Monitor { get; set; } = new();

    /// <summary>Block the physical mouse from entering the Edge; touch still works.</summary>
    public bool MouseGuard { get; set; } = true;

    /// <summary>Move any other app window that lands on the Edge back to the main display.</summary>
    public bool EvictWindows { get; set; } = true;

    /// <summary>Do not steal focus from the foreground app (e.g. a game) when the panel is touched.</summary>
    public bool NoActivate { get; set; } = true;

    public int SensorIntervalMs { get; set; } = 1000;

    public bool DevTools { get; set; }

    /// <summary>"panel" (dashboard on the Edge) or "desktop" (panel hidden, Edge is a normal monitor).</summary>
    public string DisplayMode { get; set; } = DisplayModes.Panel;

    public HotkeyConfig Hotkeys { get; set; } = new();

    public ThemeConfig Theme { get; set; } = new();

    /// <summary>When true, <see cref="PageConfig.Theme"/> overrides the global theme.</summary>
    public bool ThemePerPage { get; set; }

    public List<PageConfig> Pages { get; set; } = new();

    /// <summary>v0.2 layout; only read for migration, never written.</summary>
    public JsonNode? Widgets { get; set; }

    /// <summary>v0.2 shortcuts; carried into the launcher on migration, never written.</summary>
    public List<LegacyShortcut>? Shortcuts { get; set; }

    /// <summary>Keeps fields written by a newer settings page instead of dropping them on save.</summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }

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
        // Write to a temp file first so a crash mid-write never leaves a truncated config.
        var temp = UserPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(this, JsonOptions));
        File.Move(temp, UserPath, overwrite: true);
        Log.Info($"Config saved to {UserPath}");
    }

    /// <summary>
    /// Makes any config (hand-edited, from the settings page, or v0.2) valid: migrates old layouts,
    /// guarantees unique ids, clamps widgets into the 4x2 grid and drops overlapping ones.
    /// </summary>
    public void Normalize()
    {
        if (Pages is null || Pages.Count == 0)
        {
            Pages = DefaultLayout.Pages();
            if (Shortcuts is { Count: > 0 } legacy) DefaultLayout.CarryShortcuts(Pages, legacy);
            if (Widgets is not null || Shortcuts is not null) Log.Info("Migrated v0.2 config to pages");
        }
        Widgets = null;
        Shortcuts = null;
        Extra?.Remove("shortcutColumns");
        Version = CurrentVersion;

        Monitor ??= new MonitorConfig();
        Hotkeys ??= new HotkeyConfig();
        Hotkeys.Normalize();
        Theme ??= new ThemeConfig();
        Theme.Normalize();
        DisplayMode = string.Equals(DisplayMode, DisplayModes.Desktop, StringComparison.OrdinalIgnoreCase)
            ? DisplayModes.Desktop
            : DisplayModes.Panel;
        SensorIntervalMs = Math.Clamp(SensorIntervalMs, 250, 10000);

        var pageIds = new HashSet<string>(StringComparer.Ordinal);
        var widgetIds = new HashSet<string>(StringComparer.Ordinal);
        var nextWidget = 1;

        for (var p = 0; p < Pages.Count; p++)
        {
            var page = Pages[p] ??= new PageConfig();
            if (string.IsNullOrWhiteSpace(page.Id) || !pageIds.Add(page.Id))
            {
                var n = p + 1;
                while (!pageIds.Add($"p{n}")) n++;
                page.Id = $"p{n}";
            }
            if (string.IsNullOrWhiteSpace(page.Name)) page.Name = $"Page {p + 1}";
            page.Theme?.Normalize();
            page.Widgets = NormalizeWidgets(page.Widgets, widgetIds, ref nextWidget);
        }
    }

    private static List<WidgetConfig> NormalizeWidgets(List<WidgetConfig>? widgets, HashSet<string> usedIds, ref int nextId)
    {
        var occupied = new bool[GridSize.Cols, GridSize.Rows];
        var result = new List<WidgetConfig>();

        foreach (var w in widgets ?? new List<WidgetConfig>())
        {
            if (w is null || string.IsNullOrWhiteSpace(w.Type)) continue;

            w.Size = GridSize.Normalize(w.Size);
            var (cols, rows) = GridSize.Span(w.Size);
            w.Col = Math.Clamp(w.Col, 0, GridSize.Cols - cols);
            w.Row = Math.Clamp(w.Row, 0, GridSize.Rows - rows);

            if (!GridSize.TryOccupy(occupied, w.Col, w.Row, cols, rows))
            {
                Log.Info($"Dropped widget '{w.Type}' ({w.Id}): overlaps another widget");
                continue;
            }

            if (string.IsNullOrWhiteSpace(w.Id) || !usedIds.Add(w.Id))
            {
                while (!usedIds.Add($"w{nextId}")) nextId++;
                w.Id = $"w{nextId}";
            }

            w.Settings ??= new JsonObject();
            w.Style ??= new JsonObject();
            result.Add(w);
        }

        return result;
    }

    /// <summary>Finds a widget by id on any page.</summary>
    public WidgetConfig? FindWidget(string? id) =>
        id is null ? null : Pages.SelectMany(p => p.Widgets).FirstOrDefault(w => w.Id == id);
}

public static class DisplayModes
{
    public const string Panel = "panel";
    public const string Desktop = "desktop";
}

/// <summary>Grid geometry: every page is 4 columns x 2 rows.</summary>
public static class GridSize
{
    public const int Cols = 4;
    public const int Rows = 2;

    public static string Normalize(string? size) => size?.Trim().ToUpperInvariant() switch
    {
        "W" => "W",
        "M" => "M",
        "L" => "L",
        "XL" => "XL",
        _ => "S",
    };

    public static (int Cols, int Rows) Span(string size) => size switch
    {
        "W" => (2, 1),
        "M" => (1, 2),
        "L" => (2, 2),
        "XL" => (4, 2),
        _ => (1, 1),
    };

    public static bool TryOccupy(bool[,] grid, int col, int row, int cols, int rows)
    {
        for (var c = col; c < col + cols; c++)
            for (var r = row; r < row + rows; r++)
                if (grid[c, r]) return false;

        for (var c = col; c < col + cols; c++)
            for (var r = row; r < row + rows; r++)
                grid[c, r] = true;
        return true;
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

/// <summary>Global hotkeys, e.g. "Ctrl+Alt+Right". An empty string disables the hotkey.</summary>
public sealed class HotkeyConfig
{
    public string NextPage { get; set; } = "Ctrl+Alt+Right";
    public string PrevPage { get; set; } = "Ctrl+Alt+Left";
    public string ToggleMode { get; set; } = "Ctrl+Alt+E";

    public void Normalize()
    {
        NextPage = NextPage?.Trim() ?? "";
        PrevPage = PrevPage?.Trim() ?? "";
        ToggleMode = ToggleMode?.Trim() ?? "";
    }
}

public sealed class ThemeConfig
{
    public string Background { get; set; } = "#000000";

    /// <summary>File name inside the media folder, "" = none.</summary>
    public string BackgroundImage { get; set; } = "";

    public string TextColor { get; set; } = "#e8edf3";
    public string AccentColor { get; set; } = "#2bd4e0";
    public string WidgetBackground { get; set; } = "#11151b";
    public double WidgetOpacity { get; set; } = 0.85;
    public double Radius { get; set; } = 18;

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }

    public void Normalize()
    {
        Background ??= "#000000";
        BackgroundImage ??= "";
        TextColor ??= "#e8edf3";
        AccentColor ??= "#2bd4e0";
        WidgetBackground ??= "#11151b";
        WidgetOpacity = double.IsFinite(WidgetOpacity) ? Math.Clamp(WidgetOpacity, 0, 1) : 0.85;
        Radius = double.IsFinite(Radius) ? Math.Clamp(Radius, 0, 100) : 18;
    }
}

public sealed class PageConfig
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";

    /// <summary>Only used when <see cref="AppConfig.ThemePerPage"/> is on.</summary>
    public ThemeConfig? Theme { get; set; }

    public List<WidgetConfig> Widgets { get; set; } = new();

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

public sealed class WidgetConfig
{
    /// <summary>Unique across all pages; the panel addresses launch/deck actions by it.</summary>
    public string Id { get; set; } = "";

    /// <summary>Catalog type (wwwroot/widgets/catalog.js).</summary>
    public string Type { get; set; } = "";

    public int Col { get; set; }
    public int Row { get; set; }

    /// <summary>S, W, M, L or XL.</summary>
    public string Size { get; set; } = "S";

    /// <summary>Type-specific settings; missing fields fall back to the catalog defaults on the web side.</summary>
    public JsonObject? Settings { get; set; } = new();

    public JsonObject? Style { get; set; } = new();

    [JsonExtensionData]
    public Dictionary<string, JsonElement>? Extra { get; set; }
}

/// <summary>v0.2 shortcut shape, read only for migration.</summary>
public sealed class LegacyShortcut
{
    public string Label { get; set; } = "";
    public string Target { get; set; } = "";
    public string? Arguments { get; set; }
}
