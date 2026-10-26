using System;
using System.Runtime.InteropServices;
using System.Windows.Threading;
using EdgePanel.Native;
using static EdgePanel.Native.NativeMethods;

namespace EdgePanel.Input;

/// <summary>
/// Global low-level mouse hook that keeps the physical mouse out of the Edge
/// while letting touch and pen through.
/// Windows tags mouse messages promoted from touch/pen with MI_WP_SIGNATURE
/// in dwExtraInfo, which is how the two are told apart.
/// </summary>
public sealed class MouseGuard : IDisposable
{
    private const ulong SignatureMask = 0xFFFFFF00;
    private const ulong MiWpSignature = 0xFF515700;

    private readonly Dispatcher _dispatcher;
    private readonly LowLevelMouseProc _proc; // keep a reference so the GC never collects the callback
    private IntPtr _hook;

    // Swapped atomically from the UI thread; read from the hook callback (same thread, but keep it simple).
    private volatile Zone? _zone;
    private POINT _lastOutside;
    private bool _returnPending;

    public bool Enabled { get; set; } = true;

    public MouseGuard(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher;
        _proc = HookCallback;
    }

    public void Start()
    {
        if (_hook != IntPtr.Zero) return;
        _hook = SetWindowsHookEx(WH_MOUSE_LL, _proc, GetModuleHandle(null), 0);
        if (_hook == IntPtr.Zero)
            Log.Error($"SetWindowsHookEx failed: {Marshal.GetLastWin32Error()}");
        else
            Log.Info("Mouse guard hook installed");
    }

    /// <summary>Area to protect, or null to disable (e.g. when the Edge is the only display).</summary>
    public void SetZone(RECT? bounds, POINT fallbackPoint)
    {
        _zone = bounds is { } b ? new Zone(b) : null;
        _lastOutside = fallbackPoint;
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        var zone = _zone;
        if (nCode >= 0 && Enabled && zone is not null)
        {
            var info = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
            var fromTouchOrPen = ((ulong)info.dwExtraInfo & SignatureMask) == MiWpSignature;

            if (!fromTouchOrPen)
            {
                var msg = (int)wParam;
                var inside = zone.Bounds.Contains(info.pt);

                if (msg == WM_MOUSEMOVE)
                {
                    if (!inside)
                    {
                        _lastOutside = info.pt;
                        return CallNextHookEx(_hook, nCode, wParam, lParam);
                    }

                    // A touch on the Edge parks the cursor there. When the real mouse moves
                    // again, send the cursor back to where the user last had it.
                    if (GetCursorPos(out var current) && zone.Bounds.Contains(current) && !_returnPending)
                    {
                        _returnPending = true;
                        var target = _lastOutside;
                        _dispatcher.BeginInvoke(() =>
                        {
                            SetCursorPos(target.X, target.Y);
                            _returnPending = false;
                        });
                    }
                    return new IntPtr(1);
                }

                if (inside && IsButtonOrWheel(msg))
                    return new IntPtr(1);
            }
        }

        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    private static bool IsButtonOrWheel(int msg) => msg is
        WM_LBUTTONDOWN or WM_LBUTTONUP or WM_RBUTTONDOWN or WM_RBUTTONUP or
        WM_MBUTTONDOWN or WM_MBUTTONUP or WM_XBUTTONDOWN or WM_XBUTTONUP or
        WM_MOUSEWHEEL or WM_MOUSEHWHEEL;

    public void Dispose()
    {
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }

    private sealed record Zone(RECT Bounds);
}
