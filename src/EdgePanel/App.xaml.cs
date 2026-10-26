using System;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Threading;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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

        _singleInstance = new Mutex(true, @"Local\EdgePanel.SingleInstance", out var isFirst);
        if (!isFirst)
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
        _config = AppConfig.Load();
        _panel = new MainWindow(_config);
        _panel.Show();

        _tray = BuildTray(_panel);
        Log.Info("Edge Panel started");

        if (e.Args.Length > 0 && e.Args[0] == "--settings") OpenSettings();
    }

    private Forms.NotifyIcon BuildTray(MainWindow panel)
    {
        var menu = new Forms.ContextMenuStrip();

        var guard = new Forms.ToolStripMenuItem("Block mouse on Edge") { CheckOnClick = true };
        guard.CheckedChanged += (_, _) =>
        {
            if (panel.MouseGuardEnabled == guard.Checked) return; // refresh from menu.Opening, not a user click
            _config.MouseGuard = panel.MouseGuardEnabled = guard.Checked;
            SaveQuietly();
        };

        var evict = new Forms.ToolStripMenuItem("Keep other windows off Edge") { CheckOnClick = true };
        evict.CheckedChanged += (_, _) =>
        {
            if (panel.EvictWindowsEnabled == evict.Checked) return;
            _config.EvictWindows = panel.EvictWindowsEnabled = evict.Checked;
            SaveQuietly();
        };

        var startup = new Forms.ToolStripMenuItem("Start with Windows") { CheckOnClick = true };
        startup.CheckedChanged += (_, _) => { if (startup.Checked != WindowsStartup.IsEnabled()) WindowsStartup.SetEnabled(startup.Checked); };

        // Refresh check marks every time the menu opens, since Settings can change them too.
        menu.Opening += (_, _) =>
        {
            guard.Checked = panel.MouseGuardEnabled;
            evict.Checked = panel.EvictWindowsEnabled;
            startup.Checked = WindowsStartup.IsEnabled();
        };

        var settings = new Forms.ToolStripMenuItem("Settingsâ€¦", null, (_, _) => OpenSettings());
        settings.Font = new Font(settings.Font, System.Drawing.FontStyle.Bold);

        menu.Items.Add(settings);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add(guard);
        menu.Items.Add(evict);
        menu.Items.Add(startup);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Re-detect Edge", null, (_, _) => panel.Reposition("tray"));
        menu.Items.Add("Open log", null, (_, _) => Process.Start(new ProcessStartInfo(Log.FilePath) { UseShellExecute = true }));
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => Shutdown());

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

        _settings = new SettingsWindow(() => _config, config =>
        {
            _config = config;
            _panel?.ApplyConfig(config);
        });
        _settings.Closed += (_, _) => _settings = null;
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
