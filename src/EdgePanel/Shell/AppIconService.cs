using System;
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace EdgePanel.Shell;

/// <summary>
/// Turns launch targets (exe, lnk, any file, or a URI such as spotify: / steam:// / https://)
/// into PNG data URLs for the panel. Shell icon extraction is done on one dedicated STA
/// thread, because some shell extensions misbehave on MTA thread-pool threads.
/// </summary>
public static class AppIconService
{
    public const int IconSize = 96;

    private static readonly ConcurrentDictionary<string, string?> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly BlockingCollection<Action> Queue = new();
    private static readonly Lazy<Thread> Worker = new(StartWorker);

    /// <summary>Icon for a launch target, or null. Blocks up to a few seconds on a cache miss.</summary>
    public static string? Get(string? target)
    {
        if (string.IsNullOrWhiteSpace(target)) return null;
        target = Environment.ExpandEnvironmentVariables(target.Trim().Trim('"'));
        if (Cache.TryGetValue(target, out var cached)) return cached;

        string? result = null;
        try
        {
            var path = ResolveFile(target);
            if (path is not null) result = RunOnSta(() => Extract(path));
        }
        catch (Exception ex)
        {
            Log.Error($"Icon for '{target}' failed", ex);
        }

        Cache[target] = result;
        return result;
    }

    /// <summary>Maps a launch target to a file whose icon represents it.</summary>
    private static string? ResolveFile(string target)
    {
        if (IsUri(target, out var scheme))
        {
            var exe = AssocExecutable(scheme);
            return exe is not null && File.Exists(exe) ? exe : null;
        }

        if (Path.IsPathRooted(target))
            return File.Exists(target) || Directory.Exists(target) ? target : null;

        return FindOnPath(target);
    }

    /// <summary>"spotify:", "steam://open/main", "https://x" but not "C:\x" or "notepad.exe".</summary>
    private static bool IsUri(string target, out string scheme)
    {
        scheme = "";
        var colon = target.IndexOf(':');
        if (colon < 2) return false; // "C:" drive letters have the colon at index 1
        var candidate = target[..colon];
        if (!candidate.All(c => char.IsLetterOrDigit(c) || c is '+' or '-' or '.') || !char.IsLetter(candidate[0])) return false;
        scheme = candidate;
        return true;
    }

    /// <summary>Finds "taskmgr.exe"-style names the way ShellExecute does: App Paths, then PATH.</summary>
    public static string? FindOnPath(string name)
    {
        var withExt = Path.HasExtension(name) ? name : name + ".exe";

        foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using var key = root.OpenSubKey($@"Software\Microsoft\Windows\CurrentVersion\App Paths\{withExt}");
            if (key?.GetValue(null) is string appPath)
            {
                appPath = Environment.ExpandEnvironmentVariables(appPath.Trim('"'));
                if (File.Exists(appPath)) return appPath;
            }
        }

        var dirs = new[] { Environment.SystemDirectory, Environment.GetFolderPath(Environment.SpecialFolder.Windows) }
            .Concat((Environment.GetEnvironmentVariable("PATH") ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries));
        foreach (var dir in dirs)
        {
            try
            {
                var candidate = Path.Combine(Environment.ExpandEnvironmentVariables(dir.Trim().Trim('"')), withExt);
                if (File.Exists(candidate)) return candidate;
            }
            catch (ArgumentException) { }
        }
        return null;
    }

    private static string? AssocExecutable(string scheme)
    {
        uint size = 1024;
        var buffer = new StringBuilder((int)size);
        var hr = AssocQueryString(ASSOCF_IS_PROTOCOL | ASSOCF_NOTRUNCATE, ASSOCSTR_EXECUTABLE, scheme, null, buffer, ref size);
        if (hr != 0) return null;
        var exe = Environment.ExpandEnvironmentVariables(buffer.ToString().Trim('"'));
        return string.IsNullOrWhiteSpace(exe) ? null : exe;
    }

    private static string? Extract(string path)
    {
        try
        {
            if (SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out var item) == 0 && item is not null)
            {
                try
                {
                    var ext = Path.GetExtension(path).ToLowerInvariant();
                    // Executables and shortcuts: the icon. Other files: a thumbnail when one exists.
                    var flags = ext is ".exe" or ".lnk" or ".url" or ".bat" or ".cmd" ? SIIGBF_ICONONLY : SIIGBF_RESIZETOFIT;
                    if (item.GetImage(new SIZE { cx = IconSize, cy = IconSize }, flags, out var hbitmap) == 0 && hbitmap != IntPtr.Zero)
                    {
                        try { return HBitmapToPng(hbitmap); }
                        finally { DeleteObject(hbitmap); }
                    }
                }
                finally
                {
                    Marshal.ReleaseComObject(item);
                }
            }
        }
        catch (Exception ex)
        {
            Log.Error($"Shell image for '{path}' failed", ex);
        }

        // Fallback: the classic associated icon (32x32, but better than nothing).
        try
        {
            if (!File.Exists(path)) return null;
            using var icon = Icon.ExtractAssociatedIcon(path);
            if (icon is null) return null;
            using var bmp = icon.ToBitmap();
            return ToDataUrl(bmp);
        }
        catch (Exception ex)
        {
            Log.Error($"Associated icon for '{path}' failed", ex);
            return null;
        }
    }

    /// <summary>Copies a 32bpp HBITMAP pixel by pixel, because Image.FromHbitmap drops the alpha channel.</summary>
    private static string? HBitmapToPng(IntPtr hbitmap)
    {
        if (GetObject(hbitmap, Marshal.SizeOf<BITMAP>(), out var info) == 0 || info.bmWidth <= 0 || info.bmHeight == 0) return null;
        var width = info.bmWidth;
        var height = Math.Abs(info.bmHeight);

        var header = new BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            biWidth = width,
            biHeight = -height, // top-down rows
            biPlanes = 1,
            biBitCount = 32,
        };
        var pixels = new byte[width * height * 4];
        var hdc = GetDC(IntPtr.Zero);
        try
        {
            if (GetDIBits(hdc, hbitmap, 0, (uint)height, pixels, ref header, 0) == 0) return null;
        }
        finally
        {
            ReleaseDC(IntPtr.Zero, hdc);
        }

        // Icons without an alpha channel come back fully transparent; make them opaque instead.
        var hasAlpha = false;
        for (var i = 3; i < pixels.Length; i += 4)
            if (pixels[i] != 0) { hasAlpha = true; break; }
        if (!hasAlpha)
            for (var i = 3; i < pixels.Length; i += 4) pixels[i] = 255;

        using var bmp = new Bitmap(width, height, hasAlpha ? PixelFormat.Format32bppPArgb : PixelFormat.Format32bppArgb);
        var data = bmp.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, bmp.PixelFormat);
        try
        {
            for (var y = 0; y < height; y++)
                Marshal.Copy(pixels, y * width * 4, data.Scan0 + y * data.Stride, width * 4);
        }
        finally
        {
            bmp.UnlockBits(data);
        }
        return ToDataUrl(bmp);
    }

    private static string ToDataUrl(Bitmap bmp)
    {
        using var ms = new MemoryStream();
        // Re-draw into a straight-alpha bitmap so the PNG encoder writes correct transparency.
        using (var straight = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(straight)) g.DrawImage(bmp, 0, 0, bmp.Width, bmp.Height);
            straight.Save(ms, ImageFormat.Png);
        }
        return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
    }

    private static T? RunOnSta<T>(Func<T> work)
    {
        _ = Worker.Value;
        var tcs = new TaskCompletionSource<T?>(TaskCreationOptions.RunContinuationsAsynchronously);
        Queue.Add(() =>
        {
            try { tcs.SetResult(work()); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        // A hung shell extension must not freeze telemetry forever.
        return tcs.Task.Wait(TimeSpan.FromSeconds(5)) ? tcs.Task.Result : default;
    }

    private static Thread StartWorker()
    {
        var thread = new Thread(() =>
        {
            foreach (var job in Queue.GetConsumingEnumerable()) job();
        })
        {
            IsBackground = true,
            Name = "EdgePanel icons",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return thread;
    }

    // ---- interop ----

    private const uint ASSOCF_NOTRUNCATE = 0x20;
    private const uint ASSOCF_IS_PROTOCOL = 0x1000;
    private const int ASSOCSTR_EXECUTABLE = 2;
    private const int SIIGBF_RESIZETOFIT = 0x0;
    private const int SIIGBF_ICONONLY = 0x4;

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE
    {
        public int cx;
        public int cy;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAP
    {
        public int bmType;
        public int bmWidth;
        public int bmHeight;
        public int bmWidthBytes;
        public ushort bmPlanes;
        public ushort bmBitsPixel;
        public IntPtr bmBits;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER
    {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig]
        int GetImage(SIZE size, int flags, out IntPtr phbm);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory? item);

    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
    private static extern int AssocQueryString(uint flags, int str, string pszAssoc, string? pszExtra, StringBuilder pszOut, ref uint pcchOut);

    [DllImport("gdi32.dll")]
    private static extern int GetObject(IntPtr hgdiobj, int cbBuffer, out BITMAP lpvObject);

    [DllImport("gdi32.dll")]
    private static extern int GetDIBits(IntPtr hdc, IntPtr hbmp, uint start, uint lines, [Out] byte[] bits, ref BITMAPINFOHEADER bmi, uint usage);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
}
