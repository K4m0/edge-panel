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

    /// <summary>User media (backgrounds, images, videos) is served from AppData, outside the app folder.</summary>
    public const string MediaHost = "media.edge.panel";

    public const string MediaBase = "https://" + MediaHost + "/";

    public static string MediaFolder { get; } = Path.Combine(Log.Directory, "media");

    private static Task<CoreWebView2Environment>? _environment;

    public static async Task InitAsync(WebView2 view, string page, bool devTools)
    {
        _environment ??= CoreWebView2Environment.CreateAsync(null, Path.Combine(Log.Directory, "WebView2"));
        await view.EnsureCoreWebView2Async(await _environment);

        var s = view.CoreWebView2.Settings;
        s.AreDefaultContextMenusEnabled = devTools;
        s.AreDevToolsEnabled = devTools;
        s.AreBrowserAcceleratorKeysEnabled = devTools;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsStatusBarEnabled = false;

        view.CoreWebView2.SetVirtualHostNameToFolderMapping(VirtualHost,
            Path.Combine(AppContext.BaseDirectory, "wwwroot"), CoreWebView2HostResourceAccessKind.DenyCors);

        // Allow (not DenyCors) so the pages can also fetch/canvas-read media, e.g. for slideshows.
        Directory.CreateDirectory(MediaFolder);
        view.CoreWebView2.SetVirtualHostNameToFolderMapping(MediaHost, MediaFolder, CoreWebView2HostResourceAccessKind.Allow);

        // The pages are served from a fixed virtual host, so after an update WebView2's HTTP cache can keep
        // serving old scripts/styles. They are local files; drop the cache on every start.
        await view.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache | CoreWebView2BrowsingDataKinds.CacheStorage);

        view.CoreWebView2.Navigate($"https://{VirtualHost}/{page}");
    }
}
