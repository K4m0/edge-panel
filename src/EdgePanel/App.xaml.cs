using System;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using EdgePanel.Tray;
using Forms = System.Windows.Forms;

namespace EdgePanel;

public partial class App : System.Windows.Application
{
    private const string IconResource = "EdgePanel.Assets.edge-panel.ico";

    private Mutex? _singleInstance;
    private Forms.NotifyIcon? _tray;
    private MainWindow? _panel;
    private SettingsWindow? _settings;
    private AppConfig _config = new();

    public static ImageSource? WindowIcon { get; private set; }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var config = AppConfig.Load();

        // Admin mode: hand over to an elevated copy (via the scheduled task, so no UAC prompt) before taking the mutex.
        if (config.RunAsAdmin && !WindowsStartup.IsElevated && WindowsStartup.StartElevatedCopy())
        {
            Shutdown();
            return;
        }

        _singleInstance = new Mutex(true, @"Local\EdgePanel.SingleInstance", out var isFirst);
        if (!isFirst && !WaitForPreviousInstance(_singleInstance))
        {
            Shutdown();
            return;
        }

        DispatcherUnhandledException += (_, args) =>
        {
            Log.Error("Unhandled UI exception", args.Exception);
            args.Handled = true;
        };

        WindowIcon = LoadWindowIcon();
        _config = config;
        Log.Info($"Elevated: {WindowsStartup.IsElevated}");
        _panel = new MainWindow(_config);
        _panel.DisplayModeChanged += SaveQuietly;
        _panel.Show();

        _tray = BuildTray(_panel);
        Log.Info("Edge Panel started");

        if (e.Args.Length > 0 && e.Args[0] == "--settings") OpenSettings();
    }

    /// <summary>
    /// A copy started by the elevated relaunch (or right after Exit) may race the old instance;
    /// give it a moment to exit instead of quitting immediately.
    /// </summary>
    private static bool WaitForPreviousInstance(Mutex mutex)
    {
        try { return mutex.WaitOne(TimeSpan.FromSeconds(6)); }
        catch (AbandonedMutexException) { return true; }
    }

    /// <summary>Restarts elevated after admin mode is turned on from a non-elevated instance.</summary>
    private void RelaunchElevatedIfNeeded()
    {
        if (!_config.RunAsAdmin || WindowsStartup.IsElevated) return;
        Dispatcher.BeginInvoke(() =>
        {
            if (WindowsStartup.StartElevatedCopy()) Shutdown();
        });
    }

    private Forms.NotifyIcon BuildTray(MainWindow panel)
    {
        var menu = new Forms.ContextMenuStrip();

        var guard = TrayMenuRenderer.Item("Block mouse on Edge", '\uE962', checkable: true);
        guard.CheckedChanged += (_, _) =>
        {
            if (panel.MouseGuardEnabled == guard.Checked) return; // refresh from menu.Opening, not a user click
            _config.MouseGuard = panel.MouseGuardEnabled = guard.Checked;
            SaveQuietly();
        };

        var evict = TrayMenuRenderer.Item("Keep windows off Edge", '\uE923', checkable: true);
        evict.CheckedChanged += (_, _) =>
        {
            if (panel.EvictWindowsEnabled == evict.Checked) return;
            _config.EvictWindows = panel.EvictWindowsEnabled = evict.Checked;
            SaveQuietly();
        };

        var desktop = TrayMenuRenderer.Item("Desktop mode", '\uE7F4', checkable: true);
        desktop.CheckedChanged += (_, _) =>
        {
            if (panel.DesktopMode == desktop.Checked) return;
            panel.SetDisplayMode(desktop.Checked ? DisplayModes.Desktop : DisplayModes.Panel); // saves via DisplayModeChanged
        };

        var startup = TrayMenuRenderer.Item("Start with Windows", '\uE768', checkable: true);
        startup.CheckedChanged += (_, _) =>
        {
            if (startup.Checked != WindowsStartup.IsEnabled()) WindowsStartup.Apply(startup.Checked, _config.RunAsAdmin);
        };

        // Refresh check marks every time the menu opens, since Settings can change them too.
        menu.Opening += (_, _) =>
        {
            guard.Checked = panel.MouseGuardEnabled;
            evict.Checked = panel.EvictWindowsEnabled;
            desktop.Checked = panel.DesktopMode;
            startup.Checked = WindowsStartup.IsEnabled();
        };

        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3);
        var header = new Forms.ToolStripLabel($"Edge Panel  ·  v{version}{(WindowsStartup.IsElevated ? "  ·  admin" : "")}")
        {
            ForeColor = TrayMenuRenderer.Muted,
            Font = new Font("Segoe UI", 8.5f),
            Padding = new Forms.Padding(2, 4, 0, 4),
        };

        var settings = TrayMenuRenderer.Item("Settings", '', (_, _) => OpenSettings());
        settings.Font = new Font("Segoe UI Semibold", 10f);
        var exit = TrayMenuRenderer.Item("Exit", '', (_, _) => Shutdown());
        exit.Tag = "danger";

        menu.Items.Add(header);
        menu.Items.Add(settings);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(desktop);
        menu.Items.Add(guard);
        menu.Items.Add(evict);
        menu.Items.Add(startup);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(TrayMenuRenderer.Item("Re-detect Edge", '', (_, _) => panel.Reposition("tray")));
        menu.Items.Add(TrayMenuRenderer.Item("Open log", '', (_, _) => Process.Start(new ProcessStartInfo(Log.FilePath) { UseShellExecute = true })));
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(exit);
        TrayMenuRenderer.Style(menu);

        var tray = new Forms.NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Text = "Edge Panel",
            ContextMenuStrip = menu,
            Visible = true,
        };
        tray.MouseClick += (_, args) => { if (args.Button == Forms.MouseButtons.Left) OpenSettings(); };
        return tray;
    }

    private void OpenSettings()
    {
        if (_settings is not null)
        {
            _settings.Activate();
            return;
        }

        if (_panel is null) return;

        var settings = new SettingsWindow(_panel, () => _config, config =>
        {
            _config = config;
            var problems = _panel.ApplyConfig(config);
            RelaunchElevatedIfNeeded();
            return problems;
        });
        // Live preview: the settings page gets the same sensors/media/audio/icons as the panel.
        Action<string> mirror = settings.Mirror;
        _panel.Mirror += mirror;
        settings.Closed += (_, _) =>
        {
            _panel.Mirror -= mirror;
            _settings = null;
        };
        _settings = settings;
        _settings.Show();
        _settings.Activate();
    }

    private void SaveQuietly()
    {
        try { _config.Save(); }
        catch (Exception ex) { Log.Error("Saving config failed", ex); }
    }

    private static Icon LoadTrayIcon()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(IconResource);
        return stream is null ? SystemIcons.Application : new Icon(stream, Forms.SystemInformation.SmallIconSize);
    }

    private static ImageSource? LoadWindowIcon()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(IconResource);
        return stream is null ? null : BitmapFrame.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_tray is not null)
        {
            _tray.Visible = false;
            _tray.Dispose();
        }
        _settings?.Close();
        _panel?.Close();
        _singleInstance?.Dispose();
        base.OnExit(e);
    }
}
