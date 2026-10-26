using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using EdgePanel.Display;
using EdgePanel.Input;
using EdgePanel.Native;
using EdgePanel.Telemetry;
using Microsoft.Web.WebView2.Core;
using static EdgePanel.Native.NativeMethods;

namespace EdgePanel;

public partial class MainWindow : Window
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private AppConfig _config;
    private readonly MouseGuard _mouseGuard;
    private readonly MediaReader _media = new();
    private readonly DispatcherTimer _watchdog;
    private readonly DispatcherTimer _repositionDebounce;
    private readonly CancellationTokenSource _cts = new();
    private readonly uint _processId = (uint)Environment.ProcessId;

    private IntPtr _hwnd;
    private MonitorInfo? _edge;
    private MonitorInfo? _mainMonitor;
    private bool _webReady;

    public MainWindow(AppConfig config)
    {
        _config = config;
        InitializeComponent();

        _mouseGuard = new MouseGuard(Dispatcher) { Enabled = config.MouseGuard };

        // Display topology changes arrive in bursts (monitor off -> several WM_DISPLAYCHANGE);
        // wait for it to settle before re-locating the Edge.
        _repositionDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(750) };
        _repositionDebounce.Tick += (_, _) => { _repositionDebounce.Stop(); Reposition("display change"); };

        _watchdog = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _watchdog.Tick += (_, _) => Watchdog();

        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
    }

    public bool MouseGuardEnabled
    {
        get => _mouseGuard.Enabled;
        set => _mouseGuard.Enabled = value;
    }

    public bool EvictWindowsEnabled { get; set; }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _hwnd = new WindowInteropHelper(this).Handle;

        ApplyWindowStyles();
        HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);

        EvictWindowsEnabled = _config.EvictWindows;
        _mouseGuard.Start();
        Reposition("startup");
        _watchdog.Start();

        _ = InitWebViewAsync();
        _ = Task.Run(() => TelemetryLoopAsync(_cts.Token));
    }

    private void ApplyWindowStyles()
    {
        var ex = GetWindowLongPtr(_hwnd, GWL_EXSTYLE).ToInt64() | WS_EX_TOOLWINDOW;
        ex = _config.NoActivate ? ex | WS_EX_NOACTIVATE : ex & ~WS_EX_NOACTIVATE;
        SetWindowLongPtr(_hwnd, GWL_EXSTYLE, new IntPtr(ex));
    }

    /// <summary>Applies settings saved from the settings window without restarting.</summary>
    public void ApplyConfig(AppConfig config)
    {
        _config = config;
        _mouseGuard.Enabled = config.MouseGuard;
        EvictWindowsEnabled = config.EvictWindows;
        if (_hwnd != IntPtr.Zero) ApplyWindowStyles();
        if (_webReady) PostLayout();
        Reposition("settings");
    }

    private void PostLayout() => Post("config", new
    {
        widgets = _config.Widgets.Where(w => w.Enabled).Select(w => new { w.Type, w.Size }),
        _config.ShortcutColumns,
        shortcuts = _config.Shortcuts.Select((s, i) => new { id = i, s.Label, s.Icon }),
    });

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_DISPLAYCHANGE) ScheduleReposition();
        return IntPtr.Zero;
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e) => Dispatcher.BeginInvoke(ScheduleReposition);

    private void ScheduleReposition()
    {
        _repositionDebounce.Stop();
        _repositionDebounce.Start();
    }

    /// <summary>Finds the Edge by name and pins the panel to it. Hides the panel while the Edge is gone.</summary>
    public void Reposition(string reason)
    {
        var monitors = MonitorLocator.GetMonitors();
        var edge = MonitorLocator.FindEdge(monitors, _config.Monitor);
        Log.Info($"Reposition ({reason}): {string.Join(" | ", monitors)} -> edge: {edge?.GdiName ?? "not found"}");

        _edge = edge;
        _mainMonitor = monitors.Where(m => m != edge).OrderByDescending(m => m.IsPrimary).FirstOrDefault();

        if (edge is null)
        {
            _mouseGuard.SetZone(null, default);
            if (IsVisible) Hide();
            return;
        }

        // With the Edge as the only display (main monitor off), guarding it would leave the mouse nowhere.
        if (_mainMonitor is null)
            _mouseGuard.SetZone(null, default);
        else
            _mouseGuard.SetZone(edge.Bounds, Center(_mainMonitor.WorkArea));

        if (!IsVisible) Show();
        PinToEdge();
        // WPF may resize the window when it crosses a DPI boundary; enforce the bounds again afterwards.
        Dispatcher.BeginInvoke(PinToEdge, DispatcherPriority.Background);
    }

    private void PinToEdge()
    {
        if (_edge is not { } edge || _hwnd == IntPtr.Zero) return;
        var b = edge.Bounds;
        SetWindowPos(_hwnd, HWND_TOPMOST, b.Left, b.Top, b.Width, b.Height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }

    private void Watchdog()
    {
        // Catch topology changes Windows did not announce, and drift caused by other apps.
        var monitors = MonitorLocator.GetMonitors();
        var edge = MonitorLocator.FindEdge(monitors, _config.Monitor);
        if (edge?.GdiName != _edge?.GdiName || !Equals(edge?.Bounds, _edge?.Bounds) || monitors.Count == 1 != (_mainMonitor is null))
        {
            Reposition("watchdog");
            return;
        }

        if (_edge is null) return;

        if (GetWindowRect(_hwnd, out var rect) && !Equals(rect, _edge.Bounds)) PinToEdge();

        if (EvictWindowsEnabled && _mainMonitor is not null)
            WindowEvictor.Run(_edge, _mainMonitor, _processId);
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            Web.DefaultBackgroundColor = System.Drawing.Color.Black;
            Web.CoreWebView2InitializationCompleted += (_, _) => Web.CoreWebView2.WebMessageReceived += OnWebMessage;
            await WebHost.InitAsync(Web, "index.html", _config.DevTools);
        }
        catch (Exception ex)
        {
            Log.Error("WebView2 init failed (is the WebView2 runtime installed?)", ex);
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();
            var action = root.TryGetProperty("action", out var a) ? a.GetString() : null;

            switch (type)
            {
                case "ready":
                    _webReady = true;
                    PostLayout();
                    break;
                case "media" when action is not null:
                    _ = _media.CommandAsync(action);
                    break;
                case "volume":
                    var vk = action switch { "up" => VK_VOLUME_UP, "down" => VK_VOLUME_DOWN, "mute" => VK_VOLUME_MUTE, _ => (byte)0 };
                    if (vk != 0) TapKey(vk);
                    break;
                case "launch":
                    // Only ids from config.json are launchable; the page never sends a raw path.
                    var id = root.GetProperty("id").GetInt32();
                    if (id >= 0 && id < _config.Shortcuts.Count) Launch(_config.Shortcuts[id]);
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Error("Bad web message", ex);
        }
    }

    private static void Launch(Shortcut shortcut)
    {
        try
        {
            Process.Start(new ProcessStartInfo(shortcut.Target)
            {
                Arguments = shortcut.Arguments ?? "",
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            Log.Error($"Launch '{shortcut.Label}' failed", ex);
        }
    }

    private async Task TelemetryLoopAsync(CancellationToken token)
    {
        SensorReader? sensors = null;
        try { sensors = new SensorReader(); }
        catch (Exception ex) { Log.Error("Sensor init failed", ex); }

        try
        {
            while (!token.IsCancellationRequested)
            {
                if (_webReady && _edge is not null)
                {
                    try
                    {
                        if (sensors is not null) Post("sensors", sensors.Read());
                        Post("media", await _media.ReadAsync());
                    }
                    catch (Exception ex)
                    {
                        Log.Error("Telemetry tick failed", ex);
                    }
                }
                await Task.Delay(Math.Max(250, _config.SensorIntervalMs), token);
            }
        }
        catch (OperationCanceledException) { }
        finally
        {
            sensors?.Dispose();
        }
    }

    private void Post(string type, object? data)
    {
        var json = JsonSerializer.Serialize(new { type, data }, Json);
        Dispatcher.BeginInvoke(() =>
        {
            if (Web.CoreWebView2 is not null) Web.CoreWebView2.PostWebMessageAsJson(json);
        });
    }

    private static POINT Center(RECT r) => new() { X = r.Left + r.Width / 2, Y = r.Top + r.Height / 2 };

    protected override void OnClosed(EventArgs e)
    {
        _cts.Cancel();
        _watchdog.Stop();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        _mouseGuard.Dispose();
        base.OnClosed(e);
    }
}
