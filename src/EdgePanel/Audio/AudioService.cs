using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using EdgePanel.Shell;
using NAudio.CoreAudioApi;

namespace EdgePanel.Audio;

public sealed record AudioDevice(string Id, string Name);

public sealed record AudioDeviceItem(string Id, string Name, bool IsDefault);

public sealed record AudioSession(uint Pid, string Name, string? Icon, float Volume, bool Muted);

/// <summary>Payload of the <c>audio</c> message (see docs/ARCHITECTURE.md).</summary>
public sealed record AudioState(
    float Volume,
    bool Muted,
    AudioDevice? Device,
    IReadOnlyList<AudioDeviceItem> Devices,
    float MicVolume,
    bool MicMuted,
    AudioDevice? Mic,
    IReadOnlyList<AudioDeviceItem> Mics,
    IReadOnlyList<AudioSession> Sessions);

/// <summary>
/// Core Audio through NAudio: master and microphone volume, default devices and the per-app
/// mixer. A fresh enumerator is used per call so device changes (headset plugged in, default
/// switched in Windows) are always picked up. Call from thread-pool (MTA) threads only.
/// </summary>
public sealed class AudioService
{
    private readonly object _gate = new();
    private readonly Dictionary<uint, ProcessInfo?> _processes = new();

    public AudioState? Read()
    {
        lock (_gate)
        {
            try
            {
                using var enumerator = new MMDeviceEnumerator();
                using var render = DefaultDevice(enumerator, DataFlow.Render);
                using var capture = DefaultDevice(enumerator, DataFlow.Capture);

                return new AudioState(
                    Volume: render?.AudioEndpointVolume.MasterVolumeLevelScalar ?? 0,
                    Muted: render?.AudioEndpointVolume.Mute ?? false,
                    Device: render is null ? null : new AudioDevice(render.ID, render.FriendlyName),
                    Devices: List(enumerator, DataFlow.Render, render?.ID),
                    MicVolume: capture?.AudioEndpointVolume.MasterVolumeLevelScalar ?? 0,
                    MicMuted: capture?.AudioEndpointVolume.Mute ?? false,
                    Mic: capture is null ? null : new AudioDevice(capture.ID, capture.FriendlyName),
                    Mics: List(enumerator, DataFlow.Capture, capture?.ID),
                    Sessions: render is null ? Array.Empty<AudioSession>() : Sessions(render));
            }
            catch (Exception ex)
            {
                Log.Error("Audio read failed", ex);
                return null;
            }
        }
    }

    /// <summary>Handles a <c>volume</c> message from the panel.</summary>
    public void Handle(JsonElement msg)
    {
        var action = msg.TryGetProperty("action", out var a) ? a.GetString() : null;
        lock (_gate)
        {
            try
            {
                using var enumerator = new MMDeviceEnumerator();
                switch (action)
                {
                    case "set":
                        WithDefault(enumerator, DataFlow.Render, d => d.AudioEndpointVolume.MasterVolumeLevelScalar = Level(msg));
                        break;
                    case "mute":
                        WithDefault(enumerator, DataFlow.Render, d => d.AudioEndpointVolume.Mute = MuteValue(msg, d.AudioEndpointVolume.Mute));
                        break;
                    case "setMic":
                        WithDefault(enumerator, DataFlow.Capture, d => d.AudioEndpointVolume.MasterVolumeLevelScalar = Level(msg));
                        break;
                    case "muteMic":
                        WithDefault(enumerator, DataFlow.Capture, d => d.AudioEndpointVolume.Mute = MuteValue(msg, d.AudioEndpointVolume.Mute));
                        break;
                    case "setApp":
                        ForApp(enumerator, msg, (s, _) => s.SimpleAudioVolume.Volume = Level(msg));
                        break;
                    case "muteApp":
                        ForApp(enumerator, msg, (s, first) => s.SimpleAudioVolume.Mute = MuteValue(msg, first));
                        break;
                    case "setDefault":
                        var id = msg.GetProperty("deviceId").GetString();
                        if (!string.IsNullOrEmpty(id))
                        {
                            PolicyConfig.SetDefaultEndpoint(id);
                            Log.Info($"Default audio device set to {id}");
                        }
                        break;
                    // v0.2 panel buttons, kept so an old page still works.
                    case "up": Native.NativeMethods.TapKey(Native.NativeMethods.VK_VOLUME_UP); break;
                    case "down": Native.NativeMethods.TapKey(Native.NativeMethods.VK_VOLUME_DOWN); break;
                }
            }
            catch (Exception ex)
            {
                Log.Error($"Volume action '{action}' failed", ex);
            }
        }
    }

    private static float Level(JsonElement msg) =>
        msg.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.Number ? Math.Clamp((float)v.GetDouble(), 0f, 1f) : 0f;

    /// <summary>"mute" toggles, unless the page sends an explicit <c>value: true|false</c>.</summary>
    private static bool MuteValue(JsonElement msg, bool current) =>
        msg.TryGetProperty("value", out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : !current;

    private static MMDevice? DefaultDevice(MMDeviceEnumerator enumerator, DataFlow flow)
    {
        try
        {
            return enumerator.HasDefaultAudioEndpoint(flow, Role.Multimedia)
                ? enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia)
                : null;
        }
        catch (COMException)
        {
            return null; // no device of this kind
        }
    }

    private static void WithDefault(MMDeviceEnumerator enumerator, DataFlow flow, Action<MMDevice> action)
    {
        using var device = DefaultDevice(enumerator, flow);
        if (device is not null) action(device);
    }

    private static List<AudioDeviceItem> List(MMDeviceEnumerator enumerator, DataFlow flow, string? defaultId)
    {
        var result = new List<AudioDeviceItem>();
        foreach (var device in enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active))
        {
            using (device)
                result.Add(new AudioDeviceItem(device.ID, device.FriendlyName, device.ID == defaultId));
        }
        return result.OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    private List<AudioSession> Sessions(MMDevice render)
    {
        var manager = render.AudioSessionManager;
        manager.RefreshSessions();
        var sessions = manager.Sessions;

        var byPid = new Dictionary<uint, AudioSession>();
        for (var i = 0; i < sessions.Count; i++)
        {
            using var session = sessions[i];
            try
            {
                if (session.State == NAudio.CoreAudioApi.Interfaces.AudioSessionState.AudioSessionStateExpired) continue;
                var pid = session.GetProcessID;
                if (byPid.ContainsKey(pid)) continue; // browsers open several sessions; the first one stands for the app

                var system = session.IsSystemSoundsSession;
                var info = system ? new ProcessInfo("System sounds", null) : Process(pid);
                if (info is null) continue;

                var name = !system && !string.IsNullOrWhiteSpace(session.DisplayName) && !session.DisplayName.StartsWith('@')
                    ? session.DisplayName
                    : info.Name;
                byPid[pid] = new AudioSession(pid, name, info.Path is null ? null : AppIconService.Get(info.Path),
                    session.SimpleAudioVolume.Volume, session.SimpleAudioVolume.Mute);
            }
            catch (Exception ex)
            {
                Log.Error("Audio session read failed", ex);
            }
        }

        foreach (var stale in _processes.Keys.Where(pid => !byPid.ContainsKey(pid)).ToList()) _processes.Remove(stale);
        return byPid.Values.OrderBy(s => s.Pid == 0 ? 1 : 0).ThenBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    private void ForApp(MMDeviceEnumerator enumerator, JsonElement msg, Action<AudioSessionControl, bool> action)
    {
        var pid = msg.GetProperty("pid").GetUInt32();
        using var device = DefaultDevice(enumerator, DataFlow.Render);
        if (device is null) return;

        var manager = device.AudioSessionManager;
        manager.RefreshSessions();
        var sessions = manager.Sessions;
        bool? firstMuted = null;
        for (var i = 0; i < sessions.Count; i++)
        {
            using var session = sessions[i];
            if (session.GetProcessID != pid) continue;
            // All sessions of the app follow the first one, so a toggle never leaves them split.
            firstMuted ??= session.SimpleAudioVolume.Mute;
            action(session, firstMuted.Value);
        }
    }

    /// <summary>Friendly name (file description) and exe path of a process, cached by pid.</summary>
    private ProcessInfo? Process(uint pid)
    {
        if (_processes.TryGetValue(pid, out var cached)) return cached;
        ProcessInfo? info = null;
        try
        {
            var path = ImagePath(pid);
            string? name = null;
            if (path is not null)
            {
                try { name = FileVersionInfo.GetVersionInfo(path).FileDescription; } catch { }
            }
            if (string.IsNullOrWhiteSpace(name))
            {
                try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
                catch { name = path is null ? null : Path.GetFileNameWithoutExtension(path); }
            }
            if (name is not null) info = new ProcessInfo(name.Trim(), path);
        }
        catch (Exception ex)
        {
            Log.Error($"Process info for {pid} failed", ex);
        }
        _processes[pid] = info;
        return info;
    }

    /// <summary>Exe path via QueryFullProcessImageName, which also works for elevated processes.</summary>
    private static string? ImagePath(uint pid)
    {
        var handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (handle == IntPtr.Zero) return null;
        try
        {
            var buffer = new StringBuilder(1024);
            var size = buffer.Capacity;
            return QueryFullProcessImageName(handle, 0, buffer, ref size) ? buffer.ToString() : null;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    private sealed record ProcessInfo(string Name, string? Path);

    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
