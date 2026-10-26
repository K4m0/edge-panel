using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using EdgePanel.Display;
using EdgePanel.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace EdgePanel;

/// <summary>Settings editor (wwwroot/settings.html) shown on the main display, with a live preview of the panel.</summary>
public partial class SettingsWindow : Window
{
    private static readonly string[] ImageExtensions = { "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.bmp", "*.svg", "*.avif" };
    private static readonly string[] VideoExtensions = { "*.mp4", "*.webm", "*.mkv", "*.mov", "*.m4v", "*.ogv" };

    private readonly MainWindow _panel;
    private readonly Func<AppConfig> _getConfig;
    private readonly Func<AppConfig, List<string>> _apply;
    private bool _webReady;

    /// <param name="apply">Applies a saved config to the app and returns hotkey problems to report.</param>
    public SettingsWindow(MainWindow panel, Func<AppConfig> getConfig, Func<AppConfig, List<string>> apply)
    {
        _panel = panel;
        _getConfig = getConfig;
        _apply = apply;
        InitializeComponent();
        Icon = App.WindowIcon;
        FitToWorkArea();

        Loaded += async (_, _) =>
        {
            try
            {
                Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(11, 14, 19);
                Web.CoreWebView2InitializationCompleted += (_, _) =>
                {
                    Web.CoreWebView2.WebMessageReceived += OnWebMessage;
                    Web.CoreWebView2.NavigationStarting += (_, _) => _webReady = false;
                };
                await WebHost.InitAsync(Web, "settings.html", _getConfig().DevTools);
            }
            catch (Exception ex)
            {
                Log.Error("Settings WebView2 init failed", ex);
            }
        };
    }

    /// <summary>The editor wants a big window, but never larger than the screen it opens on.</summary>
    private void FitToWorkArea()
    {
        var area = SystemParameters.WorkArea;
        Width = Math.Min(Width, area.Width * 0.95);
        Height = Math.Min(Height, area.Height * 0.95);
        MinWidth = Math.Min(MinWidth, Width);
        MinHeight = Math.Min(MinHeight, Height);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // Dark title bar to match the page (Windows 10 20H1+).
        var hwnd = new WindowInteropHelper(this).Handle;
        var dark = 1;
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
    }

    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    /// <summary>Forwards a panel message (sensors, media, audio, appIcons) for the live preview. Thread-safe.</summary>
    public void Mirror(string json)
    {
        if (_webReady) PostJson(json);
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;

            switch (root.GetProperty("type").GetString())
            {
                case "ready":
                    SendState();
                    _webReady = true;
                    _panel.PushLiveState(PostJson);
                    break;

                case "save":
                    Save(root);
                    break;

                case "browse":
                    Browse(root);
                    break;

                case "previewPage":
                    if (root.TryGetProperty("index", out var page) && page.TryGetInt32(out var index)) _panel.Goto(index);
                    break;

                case "redetect":
                    _panel.Reposition("settings");
                    break;

                case "getDevice":
                    _ = SendDeviceAsync(_panel.GetDeviceAsync());
                    break;

                case "setDevice":
                    var key = root.GetProperty("key").GetString();
                    if (key is not null && root.TryGetProperty("value", out var value) && value.ValueKind == JsonValueKind.Number)
                        _panel.SetDevice(key, value.GetDouble());
                    break;

                case "restoreDevice":
                    _ = SendDeviceAsync(_panel.RestoreDeviceAsync());
                    break;

                case "openConfigFolder":
                    Process.Start(new ProcessStartInfo(Log.Directory) { UseShellExecute = true });
                    break;

                case "close":
                    Close();
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Error("Bad settings message", ex);
            Post(new { type = "error", message = ex.Message });
        }
    }

    private void Save(JsonElement root)
    {
        var config = root.GetProperty("config").Deserialize<AppConfig>(AppConfig.JsonOptions) ?? new AppConfig();
        config.Normalize();
        config.Save();
        var startWithWindows = root.TryGetProperty("startWithWindows", out var startup) && startup.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? startup.GetBoolean()
            : WindowsStartup.IsEnabled();
        // Only touch startup when something changed: admin mode may need a UAC prompt.
        if (startWithWindows != WindowsStartup.IsEnabled() || config.RunAsAdmin != _getConfig().RunAsAdmin)
            WindowsStartup.Apply(startWithWindows, config.RunAsAdmin);

        var problems = _apply(config);
        Post(new { type = "saved" });
        SendState();
        if (problems.Count > 0) Post(new { type = "error", message = string.Join("\n", problems) });
    }

    private async Task SendDeviceAsync(Task<DeviceState> read)
    {
        try
        {
            Post(new { type = "device", data = await read });
        }
        catch (Exception ex)
        {
            Log.Error("DDC/CI read failed", ex);
            Post(new { type = "device", data = new DeviceState(false, null, null, null, null, null) });
        }
    }

    private void SendState() => Post(new
    {
        type = "state",
        config = _getConfig(),
        startWithWindows = WindowsStartup.IsEnabled(),
        configPath = AppConfig.UserPath,
        version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3),
        sensorCatalog = _panel.SensorCatalog,
        mediaBase = WebHost.MediaBase,
    });

    // ---------------------------------------------------------------- file picking

    private void Browse(JsonElement root)
    {
        var requestId = root.TryGetProperty("requestId", out var r) ? r.Clone() : (JsonElement?)null;
        var kind = root.TryGetProperty("kind", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString() : "app";

        var images = string.Join(";", ImageExtensions);
        var videos = string.Join(";", VideoExtensions);
        var (title, filter) = kind switch
        {
            "image" => ("Choose an image", $"Images|{images}|All files|*.*"),
            "video" => ("Choose a video", $"Videos|{videos}|All files|*.*"),
            "media" => ("Choose an image or video", $"Images and videos|{images};{videos}|Images|{images}|Videos|{videos}|All files|*.*"),
            "any" => ("Choose a file", "All files|*.*"),
            _ => ("Choose an app or file", "Programs and shortcuts|*.exe;*.lnk;*.url;*.bat;*.cmd|All files|*.*"),
        };

        var dialog = new OpenFileDialog { Title = title, Filter = filter };
        if (dialog.ShowDialog(this) != true)
        {
            Post(new { type = "picked", requestId, cancelled = true });
            return;
        }

        var source = dialog.FileName;
        if (kind is "image" or "video" or "media")
        {
            // Copying a large video can take a while; keep the UI responsive.
            _ = Task.Run(() =>
            {
                try
                {
                    var media = ImportMedia(source);
                    Post(new { type = "picked", requestId, media, name = Path.GetFileName(source) });
                }
                catch (Exception ex)
                {
                    Log.Error($"Import of '{source}' failed", ex);
                    Post(new { type = "error", message = $"Could not copy the file: {ex.Message}" });
                    Post(new { type = "picked", requestId, cancelled = true });
                }
            });
            return;
        }

        _ = Task.Run(() =>
        {
            var icon = AppIconService.Get(source);
            Post(new { type = "picked", requestId, path = source, name = DisplayName(source), icon });
        });
    }

    /// <summary>Copies a file into the media folder under a unique, URL-safe name and returns that name.</summary>
    private static string ImportMedia(string source)
    {
        Directory.CreateDirectory(WebHost.MediaFolder);
        var full = Path.GetFullPath(source);
        if (string.Equals(Path.GetDirectoryName(full), Path.GetFullPath(WebHost.MediaFolder), StringComparison.OrdinalIgnoreCase))
            return Path.GetFileName(full); // already in the media folder

        var stem = SafeName(Path.GetFileNameWithoutExtension(source));
        var ext = SafeName(Path.GetExtension(source).TrimStart('.')).ToLowerInvariant();
        if (stem.Length == 0) stem = "file";
        if (stem.Length > 60) stem = stem[..60];
        var suffix = ext.Length > 0 ? "." + ext : "";

        var name = stem + suffix;
        for (var n = 2; File.Exists(Path.Combine(WebHost.MediaFolder, name)); n++) name = $"{stem}-{n}{suffix}";

        File.Copy(source, Path.Combine(WebHost.MediaFolder, name));
        Log.Info($"Imported media '{source}' as '{name}'");
        return name;
    }

    private static string SafeName(string text)
    {
        var sb = new StringBuilder(text.Length);
        foreach (var c in text.Normalize(NormalizationForm.FormD))
        {
            if (c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '-' or '_') sb.Append(c);
            else if (c is ' ' or '.' or '(' or ')' or '[' or ']') sb.Append('-');
            // other characters (accents after FormD, symbols) are dropped
        }
        return string.Join("-", sb.ToString().Split('-', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>"Spotify" for Spotify.exe (file description), else the file name without extension.</summary>
    private static string DisplayName(string path)
    {
        if (path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var description = FileVersionInfo.GetVersionInfo(path).FileDescription;
                if (!string.IsNullOrWhiteSpace(description)) return description.Trim();
            }
            catch { }
        }
        return Path.GetFileNameWithoutExtension(path);
    }

    // ---------------------------------------------------------------- posting

    private void Post(object message) => PostJson(JsonSerializer.Serialize(message, AppConfig.JsonOptions));

    /// <summary>Thread-safe: marshals to the UI thread, where CoreWebView2 lives.</summary>
    private void PostJson(string json) => Dispatcher.BeginInvoke(() =>
    {
        try { Web.CoreWebView2?.PostWebMessageAsJson(json); }
        catch (Exception ex) { Log.Error("Post to settings failed", ex); }
    });
}
