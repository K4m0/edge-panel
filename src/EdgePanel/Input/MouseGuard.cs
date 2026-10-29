using System;
using System.Runtime.InteropServices;
using System.Threading;
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

    private readonly LowLevelMouseProc _proc; // keep a reference so the GC never collects the callback
    private IntPtr _hook;
    private Thread? _thread;
    private uint _threadId;

    // Written from the UI thread, read by the hook thread.
    private volatile Zone? _zone;
    private POINT _lastOutside;
    private POINT _fallback;
    private volatile bool _returnPending;

    // Consecutive attempts to send the cursor back that left it on the Edge. After display sleep, a lock
    // screen or a topology change, SetCursorPos can fail or land on the Edge again; past a few failures
    // the guard lets the mouse through so the cursor is never trapped.
    private const int MaxFailedReturns = 3;
    private volatile int _failedReturns;

    public volatile bool Enabled = true;

    public MouseGuard(Dispatcher dispatcher) => _proc = HookCallback;

    /// <summary>
    /// The hook runs on its own thread with its own message loop. A low-level hook is called on the
    /// thread that installed it; on the UI thread any stall (WebView2 work, a dialog, a slow call)
    /// would freeze the mouse system-wide, and Windows silently removes hooks that time out.
    /// </summary>
    public void Start()
    {
        if (_thread is not null) return;
        _thread = new Thread(() =>
        {
            _threadId = GetCurrentThreadId();
            _hook = SetWindowsHookEx(WH_MOUSE_LL, _proc, GetModuleHandle(null), 0);
            if (_hook == IntPtr.Zero)
            {
                Log.Error($"SetWindowsHookEx failed: {Marshal.GetLastWin32Error()}");
                return;
            }
            Log.Info("Mouse guard hook installed");
            while (GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0) { /* keep the thread pumping for the hook */ }
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        })
        {
            IsBackground = true,
            Name = "MouseGuard",
            Priority = ThreadPriority.AboveNormal,
        };
        _thread.Start();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    private const uint WM_QUIT = 0x0012;

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    /// <summary>Area to protect, or null to disable (e.g. when the Edge is the only display).</summary>
    public void SetZone(RECT? bounds, POINT fallbackPoint)
    {
        _zone = bounds is { } b ? new Zone(b) : null;
        _lastOutside = fallbackPoint;
        _fallback = fallbackPoint;
        _failedReturns = 0;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);
    private const uint MONITOR_DEFAULTTONULL = 0;

    /// <summary>Where to send the cursor: the last spot outside the Edge, if it is still on a live display.</summary>
    private POINT ReturnTarget(Zone zone)
    {
        var p = _lastOutside;
        if (!zone.Bounds.Contains(p) && MonitorFromPoint(p, MONITOR_DEFAULTTONULL) != IntPtr.Zero) return p;
        return _fallback;
    }

    private void SendCursorBack(Zone zone)
    {
        var target = ReturnTarget(zone);
        var moved = SetCursorPos(target.X, target.Y) && GetCursorPos(out var now) && !zone.Bounds.Contains(now);
        if (moved) _failedReturns = 0;
        else if (++_failedReturns == MaxFailedReturns)
            Log.Info("Mouse guard: cursor could not leave the Edge; letting the mouse through until it does");
    }

    /// <summary>
    /// Moves the cursor back to where the mouse last was outside the Edge. A touch on the Edge
    /// parks the cursor there, so injected touchpad input would otherwise act on the panel itself.
    /// </summary>
    public void ReturnCursor()
    {
        var zone = _zone;
        if (zone is null) return;
        if (GetCursorPos(out var current) && zone.Bounds.Contains(current))
            SendCursorBack(zone);
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
                        _failedReturns = 0;
                        return CallNextHookEx(_hook, nCode, wParam, lParam);
                    }

                    var cursorInside = GetCursorPos(out var current) && zone.Bounds.Contains(current);

                    // Sending it back keeps failing: let the mouse move so the user can walk it out.
                    if (cursorInside && _failedReturns >= MaxFailedReturns)
                        return CallNextHookEx(_hook, nCode, wParam, lParam);

                    // A touch on the Edge parks the cursor there. When the real mouse moves
                    // again, send the cursor back to where the user last had it.
                    if (cursorInside && !_returnPending)
                    {
                        _returnPending = true;
                        // Outside the hook callback: it must return quickly.
                        ThreadPool.QueueUserWorkItem(_ =>
                        {
                            SendCursorBack(zone);
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
        if (_threadId != 0) PostThreadMessage(_threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        _thread?.Join(1000);
        _thread = null;
    }

    private sealed record Zone(RECT Bounds);
}
