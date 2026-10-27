using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace EdgePanel;

/// <summary>Shared WebView2 setup for the panel and the settings window.</summary>
public static class WebHost
{
    public const string VirtualHost = "edge.panel";
    public const string Origin = "https://" + VirtualHost + "/";

    /// <summary>User media (backgrounds, images, videos) is served from AppData, outside the app folder.</summary>
    public const string MediaHost = "media.edge.panel";

    public const string MediaBase = "https://" + MediaHost + "/";

    public static string MediaFolder { get; } = Path.Combine(Log.Directory, "media");

    private static Task<CoreWebView2Environment>? _environment;

    public static async Task InitAsync(WebView2 view, string page, bool devTools)
    {
        _environment ??= CoreWebView2Environment.CreateAsync(null, Path.Combine(Log.Directory, "WebView2"));
        await view.EnsureCoreWebView2Async(await _environment);

        var core = view.CoreWebView2;
        var s = core.Settings;
        s.AreDefaultContextMenusEnabled = devTools;
        s.AreDevToolsEnabled = devTools;
        s.AreBrowserAcceleratorKeysEnabled = devTools;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;

        // The pages can embed third-party content (YouTube, Twitch, any web page). Only our own pages may
        // ever be the top-level document, because the top-level document can talk to the host
        // (keystrokes, launching apps). A framed site that tries `top.location = ...` is stopped here.
        core.NavigationStarting += (_, e) =>
        {
            if (e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase)) return;
            e.Cancel = true;
            Log.Info($"Blocked top-level navigation to {e.Uri}");
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true; // no pop-up windows from embedded content
            Log.Info($"Blocked new window for {e.Uri}");
        };
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;

        core.SetVirtualHostNameToFolderMapping(VirtualHost,
            Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.DenyCors);

        // DenyCors: our pages can show the files (img/video), but embedded sites can't read them.
        Directory.CreateDirectory(MediaFolder);
        core.SetVirtualHostNameToFolderMapping(MediaHost, MediaFolder, CoreWebView2HostResourceAccessKind.DenyCors);

        // The pages are served from a fixed virtual host, so after an update WebView2's HTTP cache can keep
        // serving old scripts/styles. They are local files; drop the cache on every start.
        await core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache | CoreWebView2BrowsingDataKinds.CacheStorage);

        core.Navigate(Origin + page);
    }

    /// <summary>True when a web message really comes from our own top-level page (not from any other document).</summary>
    public static bool IsFrom(CoreWebView2WebMessageReceivedEventArgs e, string page) =>
        e.Source.StartsWith(Origin + page, StringComparison.OrdinalIgnoreCase);
}
