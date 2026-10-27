using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using EdgePanel.Audio;
using EdgePanel.Display;
using EdgePanel.Input;
using EdgePanel.Native;
using EdgePanel.Shell;
using EdgePanel.Telemetry;
using Microsoft.Web.WebView2.Core;
using static EdgePanel.Native.NativeMethods;

namespace EdgePanel;

/// <summary>
/// The full-screen panel on the Edge: pins itself to the monitor, hosts index.html, runs
/// telemetry (sensors, media, audio) and executes the actions the panel sends.
/// </summary>
public partial class MainWindow : Window
{
    /// <summary>Telemetry keeps nulls: a sensor with <c>value: null</c> means "unavailable".</summary>
    private static readonly JsonSerializerOptions TelemetryJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private AppConfig _config;
    private readonly MouseGuard _mouseGuard;
    private readonly MediaReader _media = new();
    private readonly StreamDeckDock _streamDeck = new();

    /// <summary>The user changed page on the Edge (swipe, dot or hotkey).</summary>
    public event Action<int>? PageChanged;
    private readonly AudioService _audio = new();
    private readonly DisplayControl _display = new();
    private readonly DispatcherTimer _watchdog;
    private readonly DispatcherTimer _repositionDebounce;
    private readonly CancellationTokenSource _cts = new();
    private readonly uint _processId = (uint)Environment.ProcessId;

    private IntPtr _hwnd;
    private HotkeyService? _hotkeys;
    private MonitorInfo? _edge;
    private MonitorInfo? _mainMonitor;
    private volatile SensorReader? _sensors;
    private volatile bool _webReady;
    private int _currentPage;

    // Payload trimming for the panel (it runs 24/7): only the sensors its widgets use, and each
    // mixer app's icon only once per page load. The settings window still gets everything.
    private AppConfig? _sensorsFor;
    private HashSet<string> _neededSensors = new(StringComparer.Ordinal);
    private readonly HashSet<uint> _iconsSent = new();
    private int _volumeFeedbackPending;

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

    /// <summary>
    /// Telemetry and icon messages (already serialized) that the settings window also wants for
    /// its live preview. Raised on background threads.
    /// </summary>
    public event Action<string>? Mirror;

    /// <summary>Raised when a hotkey or the tray switched panel/desktop mode, so the config gets saved.</summary>
    public event Action? DisplayModeChanged;

    public bool MouseGuardEnabled
    {
        get => _mouseGuard.Enabled;
        set => _mouseGuard.Enabled = value;
    }

    public bool EvictWindowsEnabled { get; set; }

    public bool DesktopMode => _config.DisplayMode == DisplayModes.Desktop;

    /// <summary>Sensor list for the settings editor (empty until the first reading).</summary>
    public IReadOnlyList<SensorInfo> SensorCatalog => _sensors?.Catalog ?? Array.Empty<SensorInfo>();

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _hwnd = new WindowInteropHelper(this).Handle;

        ApplyWindowStyles();
        HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);

        _hotkeys = new HotkeyService(_hwnd);
        _hotkeys.Register(_config.Hotkeys);

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

    /// <summary>Applies settings saved from the settings window without restarting. Returns hotkey problems.</summary>
    public List<string> ApplyConfig(AppConfig config)
    {
        _config = config;
        _mouseGuard.Enabled = config.MouseGuard;
        EvictWindowsEnabled = config.EvictWindows;
        if (_hwnd != IntPtr.Zero) ApplyWindowStyles();
        var errors = _hotkeys?.Register(config.Hotkeys) ?? new List<string>();
        if (_webReady) PostConfig();
        Reposition("settings");
        return errors;
    }

    // ---------------------------------------------------------------- display mode

    public void ToggleDisplayMode() => SetDisplayMode(DesktopMode ? DisplayModes.Panel : DisplayModes.Desktop);

    /// <summary>Desktop mode hides the panel and releases the Edge (no mouse guard, no evictor).</summary>
    public void SetDisplayMode(string mode)
    {
        if (_config.DisplayMode == mode) return;
        _config.DisplayMode = mode;
        Log.Info($"Display mode: {mode}");
        Reposition("display mode");
        DisplayModeChanged?.Invoke();
    }

    // ---------------------------------------------------------------- window placement

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WM_DISPLAYCHANGE) ScheduleReposition();
        else if (msg == HotkeyService.WM_HOTKEY && _hotkeys?.ActionFor(wParam) is { } action)
        {
            handled = true;
            switch (action)
            {
                case HotkeyAction.NextPage: Post(new { type = "nav", dir = 1 }); break;
                case HotkeyAction.PrevPage: Post(new { type = "nav", dir = -1 }); break;
                case HotkeyAction.ToggleMode: ToggleDisplayMode(); break;
            }
        }
        return IntPtr.Zero;
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e) => Dispatcher.BeginInvoke(ScheduleReposition);

    private void ScheduleReposition()
    {
        _repositionDebounce.Stop();
        _repositionDebounce.Start();
    }

    /// <summary>Finds the Edge by name and pins the panel to it. Hides the panel while the Edge is gone or in desktop mode.</summary>
    public void Reposition(string reason)
    {
        var monitors = MonitorLocator.GetMonitors();
        var edge = MonitorLocator.FindEdge(monitors, _config.Monitor);
        Log.Info($"Reposition ({reason}): {string.Join(" | ", monitors)} -> edge: {edge?.GdiName ?? "not found"}{(DesktopMode ? " (desktop mode)" : "")}");

        _edge = edge;
        _mainMonitor = monitors.Where(m => m != edge).OrderByDescending(m => m.IsPrimary).FirstOrDefault();

        // Take charge of the Virtual Stream Deck from startup when a Stream Deck widget exists (Stream Deck
        // reopens it where it was last docked, on the Edge); give it back when the widget or panel goes away.
        var manageDeck = edge is not null && !DesktopMode &&
                         _config.Pages.Any(p => p.Widgets.Any(w => w.Type == "streamDeck"));
        if (_streamDeck.Managed && !manageDeck) _streamDeck.Release(edge?.Bounds, _mainMonitor?.WorkArea);
        _streamDeck.Managed = manageDeck;
        if (manageDeck) _streamDeck.Apply();

        if (edge is null || DesktopMode)
        {
            _mouseGuard.SetZone(null, default);
            if (IsVisible) { Hide(); SetPanelActive(false); }
            return;
        }

        // With the Edge as the only display (main monitor off), guarding it would leave the mouse nowhere.
        if (_mainMonitor is null)
            _mouseGuard.SetZone(null, default);
        else
            _mouseGuard.SetZone(edge.Bounds, Center(_mainMonitor.WorkArea));

        if (!IsVisible) { Show(); SetPanelActive(true); }
        PinToEdge();
        // WPF may resize the window when it crosses a DPI boundary; enforce the bounds again afterwards.
        Dispatcher.BeginInvoke(PinToEdge, DispatcherPriority.Background);
    }

    /// <summary>
    /// While hidden (desktop mode, Edge unplugged) the page stops its embeds (YouTube would keep playing)
    /// and the WebView is suspended, so a hidden panel costs nothing.
    /// </summary>
    private async void SetPanelActive(bool active)
    {
        try
        {
            if (Web.CoreWebView2 is not { } core) return;
            if (active)
            {
                core.Resume();
                Post(new { type = "visibility", visible = true });
            }
            else
            {
                Post(new { type = "visibility", visible = false });
                await Task.Delay(500); // let the page unload its embeds first
                if (!IsVisible) await core.TrySuspendAsync();
            }
        }
        catch (Exception ex)
        {
            Log.Error("Changing panel activity failed", ex);
        }
    }

    private void PinToEdge()
    {
        if (_edge is not { } edge || _hwnd == IntPtr.Zero || DesktopMode) return;
        var b = edge.Bounds;
        SetWindowPos(_hwnd, HWND_TOPMOST, b.Left, b.Top, b.Width, b.Height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        _streamDeck.Apply(restack: true); // the panel just became the top-most window; put the deck back above it
    }

    /// <summary>
    /// The Stream Deck widget reports its box in CSS pixels ({x,y,w,h,dpr}) or rect:null when hidden.
    /// CSS pixels × devicePixelRatio = physical pixels, offset by the Edge's position.
    /// </summary>
    private void DockStreamDeck(JsonElement root)
    {
        if (_edge is not { } edge || DesktopMode
            || !root.TryGetProperty("rect", out var r) || r.ValueKind != JsonValueKind.Object)
        {
            _streamDeck.SetTarget(null);
            return;
        }

        var dpr = r.TryGetProperty("dpr", out var d) && d.TryGetDouble(out var v) && v > 0 ? v : 1;
        int Px(string key) => (int)Math.Round(r.GetProperty(key).GetDouble() * dpr);
        var b = edge.Bounds;
        var fit = root.TryGetProperty("fit", out var f) && f.ValueKind == JsonValueKind.True;
        var showEmpty = !root.TryGetProperty("showEmptyKeys", out var se) || se.ValueKind != JsonValueKind.False;
        var found = _streamDeck.SetTarget(new RECT
        {
            Left = b.Left + Px("x"),
            Top = b.Top + Px("y"),
            Right = b.Left + Px("x") + Px("w"),
            Bottom = b.Top + Px("y") + Px("h"),
        }, fit, showEmpty);
        // Lets the widget hide its setup hint once the real deck covers it.
        Post(new { type = "dockState", widgetId = Str(root, "widgetId"), found });
    }

    private void Watchdog()
    {
        _streamDeck.Apply(); // Stream Deck may recreate or move its window; also keeps it above the panel
        // Catch topology changes Windows did not announce, and drift caused by other apps.
        var monitors = MonitorLocator.GetMonitors();
        var edge = MonitorLocator.FindEdge(monitors, _config.Monitor);
        if (edge?.GdiName != _edge?.GdiName || !Equals(edge?.Bounds, _edge?.Bounds) || monitors.Count == 1 != (_mainMonitor is null))
        {
            Reposition("watchdog");
            return;
        }

        if (_edge is null || DesktopMode) return;

        if (GetWindowRect(_hwnd, out var rect) && !Equals(rect, _edge.Bounds)) PinToEdge();

        if (EvictWindowsEnabled && _mainMonitor is not null)
            WindowEvictor.Run(_edge, _mainMonitor, _processId);
    }

    // ---------------------------------------------------------------- web page

    private async Task InitWebViewAsync()
    {
        try
        {
            Web.DefaultBackgroundColor = System.Drawing.Color.Black;
            Web.CoreWebView2InitializationCompleted += (_, _) =>
            {
                Web.CoreWebView2.WebMessageReceived += OnWebMessage;
                // A reloaded page must say "ready" again before it gets messages.
                Web.CoreWebView2.NavigationStarting += (_, _) => _webReady = false;
            };
            await WebHost.InitAsync(Web, "index.html", _config.DevTools);
        }
        catch (Exception ex)
        {
            Log.Error("WebView2 init failed (is the WebView2 runtime installed?)", ex);
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!WebHost.IsFrom(e, "index.html")) return; // only our own page may drive the host

        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString();

            switch (type)
            {
                case "ready":
                    _webReady = true;
                    lock (_iconsSent) _iconsSent.Clear(); // new page: it has no icons cached yet
                    PostConfig();
                    PushLiveState(PostJson, includeIcons: false, panel: true); // PostConfig already sends them
                    break;
                case "media" when Str(root, "action") is { } action:
                    _ = _media.CommandAsync(action);
                    break;
                case "volume":
                    var volume = root.Clone();
                    _ = Task.Run(() =>
                    {
                        _audio.Handle(volume);
                        // Instant feedback, but coalesced: a dragged slider sends a message every few ms.
                        if (Interlocked.Exchange(ref _volumeFeedbackPending, 1) == 1) return;
                        Thread.Sleep(120);
                        Interlocked.Exchange(ref _volumeFeedbackPending, 0);
                        if (_audio.Read() is { } state) BroadcastAudio(state);
                    });
                    break;
                case "launch":
                    LaunchApp(Str(root, "widgetId"), Int(root, "index"));
                    break;
                case "deck":
                    RunDeckButton(Str(root, "widgetId"), Int(root, "index"));
                    break;
                case "key":
                    PressKey(root);
                    break;
                case "text" when Str(root, "text") is { Length: > 0 } text:
                    InputSimulator.Type(text);
                    break;
                case "pointer":
                    Pointer(root);
                    break;
                case "page" when Int(root, "index") is { } page:
                    _currentPage = page;
                    PageChanged?.Invoke(page);
                    break;
                case "dock":
                    DockStreamDeck(root);
                    break;
            }
        }
        catch (Exception ex)
        {
            Log.Error("Bad web message", ex);
        }
    }

    /// <summary>Shows a page on the Edge (settings preview, deck "page" buttons).</summary>
    public void Goto(int index)
    {
        _currentPage = Math.Clamp(index, 0, Math.Max(0, _config.Pages.Count - 1));
        Post(new { type = "goto", index = _currentPage });
    }

    private void PostConfig()
    {
        Post(new
        {
            type = "config",
            data = new { pages = _config.Pages, theme = _config.Theme, themePerPage = _config.ThemePerPage, mediaBase = WebHost.MediaBase },
        }, AppConfig.JsonOptions);

        var config = _config;
        _ = Task.Run(() => Broadcast("appIcons", AppIcons(config)));
    }

    /// <summary>
    /// Sends the current media (with art), sensors, audio and app icons to a page that just
    /// connected: the panel on "ready", or the settings window for its preview.
    /// </summary>
    public void PushLiveState(Action<string> post, bool includeIcons = true, bool panel = false)
    {
        post(Serialize("media", _media.Snapshot()));
        if (_sensors is { } sensors) post(Serialize("sensors", panel ? PanelSensors(sensors.Last) : sensors.Last));
        var config = _config;
        _ = Task.Run(() =>
        {
            if (_audio.Read() is { } audio) { if (panel) BroadcastAudio(audio); else post(Serialize("audio", audio)); }
            if (includeIcons) post(Serialize("appIcons", AppIcons(config)));
        });
    }

    /// <summary>Icons for launcher apps and deck "launch" buttons, keyed "widgetId:index".</summary>
    private static Dictionary<string, string> AppIcons(AppConfig config)
    {
        var icons = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var widget in config.Pages.SelectMany(p => p.Widgets))
        {
            try
            {
                if (widget.Type == "launcher")
                {
                    var apps = DefaultLayout.AppsOf(widget);
                    for (var i = 0; i < apps.Count; i++)
                        if (AppIconService.Get(Str(apps[i]?["target"])) is { } icon) icons[$"{widget.Id}:{i}"] = icon;
                }
                else if (widget.Type == "deck")
                {
                    var buttons = DefaultLayout.ButtonsOf(widget);
                    for (var i = 0; i < buttons.Count; i++)
                    {
                        var action = buttons[i]?["action"];
                        if (Str(action?["kind"]) == "launch" && AppIconService.Get(Str(action?["target"])) is { } icon)
                            icons[$"{widget.Id}:{i}"] = icon;
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error($"App icons for widget {widget.Id} failed", ex);
            }
        }
        return icons;
    }

    // ---------------------------------------------------------------- actions

    private void LaunchApp(string? widgetId, int? index)
    {
        // Only targets from the config are launchable; the page never sends a raw path.
        var widget = _config.FindWidget(widgetId);
        if (widget?.Type != "launcher" || index is not { } i) return;
        var apps = DefaultLayout.AppsOf(widget);
        if (i < 0 || i >= apps.Count) return;
        Launch(Str(apps[i]?["target"]), Str(apps[i]?["args"]), Str(apps[i]?["label"]));
    }

    private void RunDeckButton(string? widgetId, int? index)
    {
        var widget = _config.FindWidget(widgetId);
        if (widget?.Type != "deck" || index is not { } i) return;
        var buttons = DefaultLayout.ButtonsOf(widget);
        if (i < 0 || i >= buttons.Count || buttons[i]?["action"] is not JsonObject action) return;

        var value = Str(action["value"]);
        switch (Str(action["kind"]))
        {
            case "launch":
                Launch(Str(action["target"]), Str(action["args"]), Str(buttons[i]?["label"]));
                break;
            case "keys":
                PressCombo(value);
                break;
            case "media":
                switch (value)
                {
                    case "volup": TapKey(VK_VOLUME_UP); break;
                    case "voldown": TapKey(VK_VOLUME_DOWN); break;
                    case "mute": TapKey(VK_VOLUME_MUTE); break;
                    case { } media: _ = _media.CommandAsync(media); break;
                }
                break;
            case "url":
                Launch(value, null, Str(buttons[i]?["label"]));
                break;
            case "text" when !string.IsNullOrEmpty(value):
                InputSimulator.Type(value);
                break;
            case "page" when int.TryParse(value, out var page):
                Goto(page);
                break;
        }
    }

    private static void Launch(string? target, string? args, string? label)
    {
        if (string.IsNullOrWhiteSpace(target)) return;
        try
        {
            var file = Environment.ExpandEnvironmentVariables(target.Trim());
            // Many apps expect to start in their own folder (games, portable tools).
            var dir = Path.IsPathRooted(file) && File.Exists(file) ? Path.GetDirectoryName(file) : null;
            // Never with Edge Panel's admin rights (see ShellLauncher).
            ShellLauncher.Open(file, args, dir);
        }
        catch (Exception ex)
        {
            Log.Error($"Launch '{label ?? target}' failed", ex);
        }
    }

    private static void PressKey(JsonElement root)
    {
        if (Str(root, "keys") is { Length: > 0 } keys)
        {
            PressCombo(keys);
            return;
        }
        if (Int(root, "vk") is not { } vk || vk <= 0 || vk > 0xFE) return;

        var mods = KeyMods.None;
        if (root.TryGetProperty("mods", out var list) && list.ValueKind == JsonValueKind.Array)
            foreach (var m in list.EnumerateArray())
                if (m.ValueKind == JsonValueKind.String) mods |= KeyParser.ParseMod(m.GetString()!);
        InputSimulator.Press(new KeyCombo((ushort)vk, mods));
    }

    private static void PressCombo(string? keys)
    {
        // Win+L is a secure key sequence that SendInput cannot trigger.
        if (KeyParser.TryParse(keys, out var combo) && combo is { Vk: 'L', Mods: KeyMods.Win })
        {
            LockWorkStation();
            return;
        }
        if (!string.IsNullOrWhiteSpace(keys)) InputSimulator.Press(keys);
    }

    private void Pointer(JsonElement root)
    {
        // A touch on the touchpad widget parks the cursor on the Edge; move it back first.
        _mouseGuard.ReturnCursor();

        var dx = Num(root, "dx") ?? 0;
        var dy = Num(root, "dy") ?? 0;
        if (dx != 0 || dy != 0) InputSimulator.MoveBy((int)Math.Round(dx), (int)Math.Round(dy));
        if (Str(root, "click") is { } click) InputSimulator.Button(click, null);
        if (Str(root, "down") is { } down) InputSimulator.Button(down, true);
        if (Str(root, "up") is { } up) InputSimulator.Button(up, false);
        if (Num(root, "scroll") is { } scroll) InputSimulator.Scroll(scroll, Num(root, "scrollX") ?? 0);
    }

    // ---------------------------------------------------------------- DDC/CI

    public Task<DeviceState> GetDeviceAsync() => _display.GetAsync(_edge?.Handle ?? IntPtr.Zero);

    public void SetDevice(string key, double value) => _display.Set(_edge?.Handle ?? IntPtr.Zero, key, value);

    public Task<DeviceState> RestoreDeviceAsync() => _display.RestoreAsync(_edge?.Handle ?? IntPtr.Zero);

    // ---------------------------------------------------------------- telemetry

    private async Task TelemetryLoopAsync(CancellationToken token)
    {
        try { _sensors = new SensorReader(); }
        catch (Exception ex) { Log.Error("Sensor init failed", ex); }

        try
        {
            while (!token.IsCancellationRequested)
            {
                var panelLive = _webReady && _edge is not null && !DesktopMode;
                if (panelLive || Mirror is not null)
                {
                    try
                    {
                        if (_sensors is { } sensors)
                        {
                            var all = sensors.Read();
                            if (_webReady) PostJson(Serialize("sensors", PanelSensors(all)));
                            Mirror?.Invoke(Serialize("sensors", all)); // the settings sensor picker shows every sensor
                        }
                        Broadcast("media", await _media.ReadAsync());
                        if (_audio.Read() is { } audio) BroadcastAudio(audio);
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
            _sensors?.Dispose();
        }
    }

    /// <summary>Only the sensors referenced by the panel's widgets (any "sensor" value in their settings).</summary>
    private Dictionary<string, SensorValue> PanelSensors(IReadOnlyDictionary<string, SensorValue> all)
    {
        var config = _config;
        if (!ReferenceEquals(config, _sensorsFor))
        {
            var needed = new HashSet<string>(StringComparer.Ordinal);
            foreach (var widget in config.Pages.SelectMany(p => p.Widgets)) CollectSensorIds(widget.Settings, needed);
            // Widgets with empty settings use catalog defaults, which only reference aliases.
            foreach (var alias in new[] { "cpu.load", "cpu.temp", "gpu.load", "gpu.temp", "gpu.hotspot", "ram.load" }) needed.Add(alias);
            _neededSensors = needed;
            _sensorsFor = config;
        }
        var result = new Dictionary<string, SensorValue>(_neededSensors.Count, StringComparer.Ordinal);
        foreach (var id in _neededSensors)
            if (all.TryGetValue(id, out var value)) result[id] = value;
        return result;
    }

    private static void CollectSensorIds(System.Text.Json.Nodes.JsonNode? node, HashSet<string> ids)
    {
        switch (node)
        {
            case System.Text.Json.Nodes.JsonObject obj:
                foreach (var (key, value) in obj)
                {
                    if (key == "sensor" && value is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<string>(out var id)) ids.Add(id);
                    else CollectSensorIds(value, ids);
                }
                break;
            case System.Text.Json.Nodes.JsonArray arr:
                foreach (var item in arr) CollectSensorIds(item, ids);
                break;
        }
    }

    /// <summary>Audio to the panel without icons it already has; the settings preview gets the full state.</summary>
    private void BroadcastAudio(AudioState audio)
    {
        Mirror?.Invoke(Serialize("audio", audio));
        if (!_webReady) return;
        AudioState trimmed;
        lock (_iconsSent)
        {
            trimmed = audio with
            {
                Sessions = audio.Sessions.Select(s => s.Icon is null || _iconsSent.Add(s.Pid) ? s : s with { Icon = null }).ToList(),
            };
        }
        PostJson(Serialize("audio", trimmed));
    }

    /// <summary>Sends a <c>{type, data}</c> message to the panel and the settings window.</summary>
    private void Broadcast(string type, object? data)
    {
        var json = Serialize(type, data);
        if (_webReady) PostJson(json);
        Mirror?.Invoke(json);
    }

    private static string Serialize(string type, object? data) =>
        JsonSerializer.Serialize(new { type, data }, TelemetryJson);

    private void Post(object message, JsonSerializerOptions? options = null) =>
        PostJson(JsonSerializer.Serialize(message, options ?? TelemetryJson));

    /// <summary>Thread-safe: marshals to the UI thread, where CoreWebView2 lives.</summary>
    private void PostJson(string json) => Dispatcher.BeginInvoke(() =>
    {
        try { Web.CoreWebView2?.PostWebMessageAsJson(json); }
        catch (Exception ex) { Log.Error("Post to panel failed", ex); }
    });

    // ---------------------------------------------------------------- helpers

    private static string? Str(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? Num(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    private static int? Int(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i
        : root.TryGetProperty(name, out v) && v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out i) ? i
        : null;

    /// <summary>A JSON string, number or bool as text; null for objects/arrays/missing.</summary>
    private static string? Str(JsonNode? node) => node is JsonValue value
        ? value.TryGetValue<string>(out var s) ? s : value.ToJsonString().Trim('"')
        : null;

    private static POINT Center(RECT r) => new() { X = r.Left + r.Width / 2, Y = r.Top + r.Height / 2 };

    [DllImport("user32.dll")]
    private static extern bool LockWorkStation();

    protected override void OnClosed(EventArgs e)
    {
        if (_streamDeck.Managed) _streamDeck.Release(_edge?.Bounds, _mainMonitor?.WorkArea);
        _cts.Cancel();
        _watchdog.Stop();
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        _hotkeys?.Dispose();
        _mouseGuard.Dispose();
        base.OnClosed(e);
    }
}
