using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace EdgePanel;

/// <summary>Settings UI (wwwroot/settings.html) shown on the main display.</summary>
public partial class SettingsWindow : Window
{
    private readonly Func<AppConfig> _getConfig;
    private readonly Action<AppConfig> _apply;

    public SettingsWindow(Func<AppConfig> getConfig, Action<AppConfig> apply)
    {
        _getConfig = getConfig;
        _apply = apply;
        InitializeComponent();
        Icon = App.WindowIcon;
        Loaded += async (_, _) =>
        {
            try
            {
                Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(11, 14, 19);
                Web.CoreWebView2InitializationCompleted += (_, _) => Web.CoreWebView2.WebMessageReceived += OnWebMessage;
                await WebHost.InitAsync(Web, "settings.html", _getConfig().DevTools);
            }
            catch (Exception ex)
            {
                Log.Error("Settings WebView2 init failed", ex);
            }
        };
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
                    break;

                case "save":
                    var config = root.GetProperty("config").Deserialize<AppConfig>(AppConfig.JsonOptions) ?? new AppConfig();
                    config.Normalize();
                    config.Save();
                    WindowsStartup.SetEnabled(root.GetProperty("startWithWindows").GetBoolean());
                    _apply(config);
                    Post(new { type = "saved" });
                    SendState();
                    break;

                case "browse":
                    var index = root.GetProperty("index").GetInt32();
                    var dialog = new OpenFileDialog
                    {
                        Title = "Choose an app or file",
                        Filter = "Programs and shortcuts|*.exe;*.lnk;*.bat;*.cmd|All files|*.*",
                    };
                    if (dialog.ShowDialog(this) == true)
                        Post(new { type = "picked", index, path = dialog.FileName });
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

    private void SendState() => Post(new
    {
        type = "state",
        config = _getConfig(),
        startWithWindows = WindowsStartup.IsEnabled(),
        configPath = AppConfig.UserPath,
        version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3),
    });

    private void Post(object message) =>
        Web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, AppConfig.JsonOptions));
}
