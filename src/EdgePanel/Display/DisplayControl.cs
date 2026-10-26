using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace EdgePanel.Display;

public sealed record VcpValue(uint Value, uint Min, uint Max);

/// <summary>Payload of the <c>device</c> message; a control the monitor does not answer is null.</summary>
public sealed record DeviceState(bool Supported, VcpValue? Brightness, VcpValue? Contrast, VcpValue? Red, VcpValue? Green, VcpValue? Blue);

/// <summary>
/// Brightness, contrast and RGB gain of the Edge over DDC/CI (dxva2 monitor configuration API).
/// DDC/CI is slow (tens of ms per VCP call, more on some scalers) and must not run concurrently,
/// so every call goes through one serialized background worker, and slider spam is coalesced
/// to the latest value per control.
/// </summary>
public sealed class DisplayControl
{
    private static readonly Dictionary<string, byte> Codes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["brightness"] = 0x10,
        ["contrast"] = 0x12,
        ["red"] = 0x16,
        ["green"] = 0x18,
        ["blue"] = 0x1A,
    };

    private const byte VcpRestoreColorDefaults = 0x08;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<byte, uint> _pending = new();
    private bool _draining;

    public Task<DeviceState> GetAsync(IntPtr hmonitor) => RunAsync(() => Read(hmonitor));

    /// <summary>Queues a value; only the latest value per control is actually written.</summary>
    public void Set(IntPtr hmonitor, string key, double value)
    {
        if (!Codes.TryGetValue(key, out var code)) return;
        lock (_pending)
        {
            _pending[code] = (uint)Math.Max(0, Math.Round(value));
            if (_draining) return;
            _draining = true;
        }

        _ = RunAsync(() =>
        {
            while (true)
            {
                KeyValuePair<byte, uint>[] batch;
                lock (_pending)
                {
                    if (_pending.Count == 0)
                    {
                        _draining = false;
                        return true;
                    }
                    batch = new KeyValuePair<byte, uint>[_pending.Count];
                    ((ICollection<KeyValuePair<byte, uint>>)_pending).CopyTo(batch, 0);
                    _pending.Clear();
                }
                WithMonitor(hmonitor, handle =>
                {
                    foreach (var (c, v) in batch)
                        if (!SetVCPFeature(handle, c, v)) Log.Error($"DDC/CI set 0x{c:X2}={v} failed: {Marshal.GetLastWin32Error()}");
                    return true;
                });
            }
        });
    }

    /// <summary>Restores factory color defaults, then reads the new values back.</summary>
    public Task<DeviceState> RestoreAsync(IntPtr hmonitor) => RunAsync(() =>
    {
        WithMonitor(hmonitor, handle => SetVCPFeature(handle, VcpRestoreColorDefaults, 1));
        Thread.Sleep(600); // the scaler needs a moment before it reports the new values
        return Read(hmonitor);
    });

    private static DeviceState Read(IntPtr hmonitor)
    {
        DeviceState? state = WithMonitor(hmonitor, handle =>
        {
            var brightness = Get(handle, 0x10);
            var contrast = Get(handle, 0x12);
            var red = Get(handle, 0x16);
            var green = Get(handle, 0x18);
            var blue = Get(handle, 0x1A);
            var any = brightness is not null || contrast is not null || red is not null || green is not null || blue is not null;
            return new DeviceState(any, brightness, contrast, red, green, blue);
        });
        return state ?? new DeviceState(false, null, null, null, null, null);
    }

    private static VcpValue? Get(IntPtr handle, byte code) =>
        GetVCPFeatureAndVCPFeatureReply(handle, code, IntPtr.Zero, out var current, out var max) && max > 0
            ? new VcpValue(current, 0, max)
            : null;

    private async Task<T> RunAsync<T>(Func<T> work)
    {
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            return await Task.Run(work).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Opens the physical monitor(s) behind an HMONITOR, runs the action on the first one, closes them.</summary>
    private static T? WithMonitor<T>(IntPtr hmonitor, Func<IntPtr, T> action)
    {
        if (hmonitor == IntPtr.Zero) return default;
        try
        {
            if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hmonitor, out var count) || count == 0) return default;
            var monitors = new PHYSICAL_MONITOR[count];
            if (!GetPhysicalMonitorsFromHMONITOR(hmonitor, count, monitors)) return default;
            try
            {
                return action(monitors[0].hPhysicalMonitor);
            }
            finally
            {
                DestroyPhysicalMonitors(count, monitors);
            }
        }
        catch (Exception ex)
        {
            Log.Error("DDC/CI failed", ex);
            return default;
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PHYSICAL_MONITOR
    {
        public IntPtr hPhysicalMonitor;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szPhysicalMonitorDescription;
    }

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint count);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint count, [Out] PHYSICAL_MONITOR[] monitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool DestroyPhysicalMonitors(uint count, PHYSICAL_MONITOR[] monitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr monitor, byte code, IntPtr type, out uint current, out uint max);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool SetVCPFeature(IntPtr monitor, byte code, uint value);
}
