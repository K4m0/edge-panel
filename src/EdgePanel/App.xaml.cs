using System;
using System.Diagnostics;
using System.Threading;
using System.Windows;
using Forms = System.Windows.Forms;

namespace EdgePanel;

public partial class App : System.Windows.Application
{
    private Mutex? _singleInstance;
    private Forms.NotifyIcon? _tray;
    private MainWindow? _panel;

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

        var config = AppConfig.Load();
        _panel = new MainWindow(config);
        _panel.Show();

        _tray = BuildTray(_panel);
        Log.Info("Edge Panel started");
    }

    private Forms.NotifyIcon BuildTray(MainWindow panel)
    {
        var menu = new Forms.ContextMenuStrip();

        var guard = new Forms.ToolStripMenuItem("Block mouse on Edge") { Checked = panel.MouseGuardEnabled, CheckOnClick = true };
        guard.CheckedChanged += (_, _) => panel.MouseGuardEnabled = guard.Checked;

        var evict = new Forms.ToolStripMenuItem("Keep other windows off Edge") { Checked = panel.EvictWindowsEnabled, CheckOnClick = true };
        evict.CheckedChanged += (_, _) => panel.EvictWindowsEnabled = evict.Checked;

        menu.Items.Add(guard);
        menu.Items.Add(evict);
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Re-detect Edge", null, (_, _) => panel.Reposition("tray"));
        menu.Items.Add("Open log", null, (_, _) => Process.Start(new ProcessStartInfo(Log.FilePath) { UseShellExecute = true }));
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => Shutdown());

        return new Forms.NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Text = "Edge Panel",
            ContextMenuStrip = menu,
            Visible = true,
        };
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_tray is not null)
        {
            _tray.Visible = false;
            _tray.Dispose();
        }
        _panel?.Close();
        _singleInstance?.Dispose();
        base.OnExit(e);
    }
}
