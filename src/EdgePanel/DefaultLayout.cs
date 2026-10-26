using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace EdgePanel;

/// <summary>
/// The default pages (mirrored in the bundled config.json) and the host-side copy of the
/// catalog defaults the host acts on. The web side merges catalog defaults into omitted
/// settings, so when a launcher/deck has no <c>apps</c>/<c>buttons</c> the host must use the
/// same defaults as wwwroot/widgets/catalog.js to launch what the user sees.
/// </summary>
public static class DefaultLayout
{
    public static List<PageConfig> Pages() => new()
    {
        new PageConfig
        {
            Id = "p1",
            Name = "Main",
            Widgets =
            {
                Widget("w1", "clock", 0, 0, "W"),
                Widget("w2", "sensorPair", 0, 1, "S"),
                Widget("w3", "sensorPair", 1, 1, "S", new JsonObject
                {
                    ["left"] = new JsonObject { ["sensor"] = "cpu.temp", ["mode"] = "value", ["name"] = "CPU Temp" },
                    ["right"] = new JsonObject { ["sensor"] = "gpu.temp", ["mode"] = "value", ["name"] = "GPU Temp" },
                }),
                Widget("w4", "media", 2, 0, "M"),
                Widget("w5", "volume", 3, 0, "M"),
            },
        },
        new PageConfig
        {
            Id = "p2",
            Name = "Apps",
            Widgets =
            {
                Widget("w6", "launcher", 0, 0, "M"),
                Widget("w7", "deck", 1, 0, "L"),
                Widget("w8", "sensorList", 3, 0, "M"),
            },
        },
        new PageConfig
        {
            Id = "p3",
            Name = "Tools",
            Widgets =
            {
                Widget("w9", "calendar", 0, 0, "S"),
                Widget("w10", "chronograph", 0, 1, "S"),
                Widget("w11", "sensorChart", 1, 0, "W"),
                Widget("w12", "coin", 1, 1, "S"),
                Widget("w13", "touchpad", 2, 1, "S"),
                Widget("w14", "gauge", 3, 0, "S", new JsonObject
                {
                    ["sensor"] = "gpu.hotspot", ["name"] = "GPU Hotspot",
                }),
                Widget("w15", "gauge", 3, 1, "S", new JsonObject
                {
                    ["sensor"] = "ram.load", ["name"] = "Memory",
                }),
            },
        },
    };

    /// <summary>Puts v0.2 shortcuts into the first launcher so nobody loses their app list.</summary>
    public static void CarryShortcuts(List<PageConfig> pages, List<LegacyShortcut> shortcuts)
    {
        var launcher = pages.SelectMany(p => p.Widgets).FirstOrDefault(w => w.Type == "launcher");
        if (launcher is null) return;

        var apps = new JsonArray();
        foreach (var s in shortcuts.Where(s => !string.IsNullOrWhiteSpace(s.Target)))
            apps.Add(new JsonObject { ["label"] = s.Label ?? "", ["target"] = s.Target, ["args"] = s.Arguments ?? "" });

        launcher.Settings ??= new JsonObject();
        launcher.Settings["apps"] = apps;
    }

    /// <summary>Same as <c>launcher.defaults.apps</c> in catalog.js.</summary>
    public static JsonArray LauncherApps() => new()
    {
        App("Spotify", "spotify:"),
        App("Discord", "discord:"),
        App("Steam", "steam://open/main"),
        App("Task Manager", "taskmgr.exe"),
    };

    /// <summary>Same as <c>deck.defaults.buttons</c> in catalog.js (only the actions matter here).</summary>
    public static JsonArray DeckButtons() => new()
    {
        Button("Mute", "media", "mute"),
        Button("Vol -", "media", "voldown"),
        Button("Vol +", "media", "volup"),
        Button("Screenshot", "keys", "Win+Shift+S"),
        Button("Desktop", "keys", "Win+D"),
        Button("Task Mgr", "keys", "Ctrl+Shift+Esc"),
        Button("Lock", "keys", "Win+L"),
        new JsonObject { ["label"] = "Next page", ["action"] = new JsonObject { ["kind"] = "page", ["value"] = 1 } },
    };

    /// <summary>Launcher apps of a widget, falling back to the catalog defaults.</summary>
    public static JsonArray AppsOf(WidgetConfig widget) =>
        widget.Settings?["apps"] as JsonArray ?? LauncherApps();

    /// <summary>Deck buttons of a widget, falling back to the catalog defaults.</summary>
    public static JsonArray ButtonsOf(WidgetConfig widget) =>
        widget.Settings?["buttons"] as JsonArray ?? DeckButtons();

    private static WidgetConfig Widget(string id, string type, int col, int row, string size, JsonObject? settings = null) =>
        new() { Id = id, Type = type, Col = col, Row = row, Size = size, Settings = settings ?? new JsonObject(), Style = new JsonObject() };

    private static JsonObject App(string label, string target) =>
        new() { ["label"] = label, ["target"] = target, ["args"] = "" };

    private static JsonObject Button(string label, string kind, string value) =>
        new() { ["label"] = label, ["action"] = new JsonObject { ["kind"] = kind, ["value"] = value } };
}
