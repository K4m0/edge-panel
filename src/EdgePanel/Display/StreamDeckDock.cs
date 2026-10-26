using System;
using System.Diagnostics;
using System.Linq;
using System.Text;
using EdgePanel.Native;
using static EdgePanel.Native.NativeMethods;

namespace EdgePanel.Display;

/// <summary>
/// Docks Elgato's Virtual Stream Deck window (Stream Deck 7+, "Add Virtual Device") into the
/// Stream Deck widget's area on the Edge, so the user's real Stream Deck profile runs there.
/// The window keeps the size chosen in Stream Deck; it is centered in the widget, kept above
/// the panel, and parked off-screen while its page is not shown.
/// </summary>
public sealed class StreamDeckDock
{
    private const long WS_EX_LAYERED = 0x00080000;
    private const int ParkedX = -32000;

    private IntPtr _window;
    private RECT? _target;
    private RECT? _originalBounds;

    /// <summary>Area (physical pixels) to center the deck in, or null to park it. Returns whether the deck window exists.</summary>
    public bool SetTarget(RECT? target)
    {
        _target = target;
        Apply();
        return FindWindow() != IntPtr.Zero;
    }

    /// <summary>Re-applies the position; call after the panel re-pins itself or periodically.</summary>
    public void Apply()
    {
        if (_target is null && _window == IntPtr.Zero) return; // nothing docked, don't go looking

        var hwnd = FindWindow();
        if (hwnd == IntPtr.Zero) return;
        if (!GetWindowRect(hwnd, out var current)) return;

        if (_originalBounds is null && current.Left > ParkedX + 1000) _originalBounds = current;

        if (_target is not { } t)
        {
            if (current.Left != ParkedX) SetWindowPos(hwnd, IntPtr.Zero, ParkedX, ParkedX, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            return;
        }

        var x = t.Left + Math.Max(0, (t.Width - current.Width) / 2);
        var y = t.Top + Math.Max(0, (t.Height - current.Height) / 2);
        // Always re-assert TOPMOST: the panel is topmost too, and the last one set wins.
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }

    /// <summary>Puts the deck back where it was before Edge Panel docked it (on exit or desktop mode).</summary>
    public void Release()
    {
        _target = null;
        var hwnd = FindWindow();
        if (hwnd != IntPtr.Zero && _originalBounds is { } o)
            SetWindowPos(hwnd, IntPtr.Zero, o.Left, o.Top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    /// <summary>
    /// The Virtual Stream Deck is a Qt tool window of StreamDeck.exe that is topmost, layered and
    /// non-activating. The main window and menus/tooltips don't match all of those.
    /// </summary>
    private IntPtr FindWindow()
    {
        if (_window != IntPtr.Zero && IsWindowVisible(_window)) return _window;
        _window = IntPtr.Zero;

        var pids = Process.GetProcessesByName("StreamDeck").Select(p => (uint)p.Id).ToHashSet();
        if (pids.Count == 0) return IntPtr.Zero;

        var title = new StringBuilder(64);
        EnumWindows((hwnd, _) =>
        {
            GetWindowThreadProcessId(hwnd, out var pid);
            if (!pids.Contains(pid) || !IsWindowVisible(hwnd)) return true;

            var ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
            const long required = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_LAYERED;
            if ((ex & required) != required) return true;

            title.Clear();
            GetWindowText(hwnd, title, title.Capacity);
            if (!title.ToString().Contains("Stream Deck", StringComparison.OrdinalIgnoreCase)) return true;

            if (!GetWindowRect(hwnd, out var r) || r.Width < 80 || r.Height < 60) return true;

            _window = hwnd;
            return false;
        }, IntPtr.Zero);

        if (_window != IntPtr.Zero) Log.Info("Virtual Stream Deck window found");
        return _window;
    }
}
