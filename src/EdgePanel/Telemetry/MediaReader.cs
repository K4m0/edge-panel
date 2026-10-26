using System;
using System.Threading.Tasks;
using Windows.Media.Control;
using EdgePanel.Native;

namespace EdgePanel.Telemetry;

public sealed record MediaSnapshot(string? Title, string? Artist, string? App, bool IsPlaying);

/// <summary>
/// Now-playing info and transport controls via Windows' System Media Transport Controls
/// (works with Spotify, browsers, most players). Falls back to media keys.
/// </summary>
public sealed class MediaReader
{
    private GlobalSystemMediaTransportControlsSessionManager? _manager;

    public async Task<MediaSnapshot?> ReadAsync()
    {
        try
        {
            _manager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var session = _manager.GetCurrentSession();
            if (session is null) return null;

            var props = await session.TryGetMediaPropertiesAsync();
            var playback = session.GetPlaybackInfo();
            return new MediaSnapshot(
                props?.Title,
                props?.Artist,
                session.SourceAppUserModelId,
                playback?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing);
        }
        catch (Exception ex)
        {
            Log.Error("Media read failed", ex);
            return null;
        }
    }

    public async Task CommandAsync(string action)
    {
        var session = _manager?.GetCurrentSession();
        var handled = false;
        try
        {
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
