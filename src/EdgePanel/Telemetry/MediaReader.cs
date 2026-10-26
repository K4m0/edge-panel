using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;
using EdgePanel.Native;

namespace EdgePanel.Telemetry;

/// <summary>
/// Now-playing info, album art and transport controls via Windows' System Media Transport
/// Controls (works with Spotify, browsers, most players). Falls back to media keys.
/// </summary>
public sealed class MediaReader
{
    /// <summary>Art bigger than this is skipped: it is re-sent over the WebView bridge as base64.</summary>
    private const int MaxArtBytes = 3 * 1024 * 1024;

    /// <summary>Players often publish the thumbnail a moment after the title, so retry a few ticks.</summary>
    private const int ArtAttempts = 5;

    private GlobalSystemMediaTransportControlsSessionManager? _manager;
    private string? _trackKey;
    private string? _art;
    private int _artTries;
    private Dictionary<string, object?> _lastData = Empty();

    /// <summary>
    /// Reads the current session. The returned <c>data</c> only contains <c>art</c> when it changed
    /// (or <paramref name="forceArt"/> is set), as the panel keeps the last art otherwise.
    /// </summary>
    public async Task<Dictionary<string, object?>> ReadAsync(bool forceArt = false)
    {
        var artChanged = false;
        Dictionary<string, object?> data;
        try
        {
            _manager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var session = _manager.GetCurrentSession();
            if (session is null)
            {
                data = Empty();
                artChanged = SetTrack(null, null);
            }
            else
            {
                var props = await session.TryGetMediaPropertiesAsync();
                var playback = session.GetPlaybackInfo();
                var app = session.SourceAppUserModelId;
                data = new Dictionary<string, object?>
                {
                    ["title"] = props?.Title,
                    ["artist"] = props?.Artist,
                    ["album"] = props?.AlbumTitle,
                    ["isPlaying"] = playback?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
                    ["app"] = app,
                };

                var key = $"{app}\u0001{props?.Title}\u0001{props?.Artist}\u0001{props?.AlbumTitle}";
                artChanged = SetTrack(key, null);
                if (_art is null && _artTries < ArtAttempts && props?.Thumbnail is { } thumb)
                {
                    _artTries++;
                    var art = await ReadArtAsync(thumb);
                    if (art is not null)
                    {
                        _art = art;
                        artChanged = true;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Log.Error("Media read failed", ex);
            data = Empty();
            artChanged = SetTrack(null, null);
        }

        _lastData = data;
        if (artChanged || forceArt) data = new Dictionary<string, object?>(data) { ["art"] = _art };
        return data;
    }

    /// <summary>Last read data with the current art, for a page that just connected.</summary>
    public Dictionary<string, object?> Snapshot() => new(_lastData) { ["art"] = _art };

    /// <summary>Returns true when the art was cleared by a track change (so null must be sent).</summary>
    private bool SetTrack(string? key, string? art)
    {
        if (key == _trackKey) return false;
        var hadArt = _art is not null;
        _trackKey = key;
        _art = art;
        _artTries = 0;
        return hadArt || key is null;
    }

    private static async Task<string?> ReadArtAsync(IRandomAccessStreamReference thumb)
    {
        try
        {
            using var stream = await thumb.OpenReadAsync();
            if (stream.Size == 0 || stream.Size > MaxArtBytes) return null;

            var bytes = new byte[stream.Size];
            using (var input = stream.AsStreamForRead())
            {
                var read = 0;
                while (read < bytes.Length)
                {
                    var n = await input.ReadAsync(bytes.AsMemory(read));
                    if (n == 0) break;
                    read += n;
                }
                if (read == 0) return null;
                if (read < bytes.Length) Array.Resize(ref bytes, read);
            }

            var mime = string.IsNullOrEmpty(stream.ContentType) || !stream.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                ? Sniff(bytes)
                : stream.ContentType;
            return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        }
        catch (Exception ex)
        {
            Log.Error("Album art read failed", ex);
            return null;
        }
    }

    private static string Sniff(byte[] b) =>
        b.Length > 4 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 ? "image/png" :
        b.Length > 3 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46 ? "image/gif" :
        b.Length > 12 && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50 ? "image/webp" :
        b.Length > 2 && b[0] == 0x42 && b[1] == 0x4D ? "image/bmp" :
        "image/jpeg";

    private static Dictionary<string, object?> Empty() => new()
    {
        ["title"] = null,
        ["artist"] = null,
        ["album"] = null,
        ["isPlaying"] = false,
        ["app"] = null,
    };

    public async Task CommandAsync(string action)
    {
        var handled = false;
        try
        {
            _manager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var session = _manager.GetCurrentSession();
            if (session is not null)
            {
                handled = action switch
                {
                    "toggle" => await session.TryTogglePlayPauseAsync(),
                    "next" => await session.TrySkipNextAsync(),
                    "prev" => await session.TrySkipPreviousAsync(),
                    _ => false,
                };
            }
        }
        catch (Exception ex)
        {
            Log.Error($"Media command '{action}' failed", ex);
        }

        if (handled) return;

        switch (action)
        {
            case "toggle": NativeMethods.TapKey(NativeMethods.VK_MEDIA_PLAY_PAUSE); break;
            case "next": NativeMethods.TapKey(NativeMethods.VK_MEDIA_NEXT_TRACK); break;
            case "prev": NativeMethods.TapKey(NativeMethods.VK_MEDIA_PREV_TRACK); break;
        }
    }
}
