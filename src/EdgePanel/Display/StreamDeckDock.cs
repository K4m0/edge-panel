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

    private const int MaxFitAttempts = 4;

    private bool _fit;
    private bool _showEmptyKeys;
    private RECT? _fittedFor;
    private int _fitAttempts;
    private DateTime _lastFit = DateTime.MinValue;
    private volatile bool _fitting;

    /// <summary>
    /// Area (physical pixels) to center the deck in, or null to park it. With <paramref name="fit"/>,
    /// the key size is changed in Stream Deck so the deck fills the area. Returns whether the deck window exists.
    /// </summary>
    public bool SetTarget(RECT? target, bool fit = false, bool showEmptyKeys = true)
    {
        if (!Equals(target, _fittedFor) || fit != _fit || showEmptyKeys != _showEmptyKeys) _fitAttempts = 0; // new goal
        _target = target;
        _fit = fit;
        _showEmptyKeys = showEmptyKeys;
        Apply();
        return FindWindow() != IntPtr.Zero;
    }

    /// <summary>
    /// The window grows linearly with the key size, so scale the key size by how much the window
    /// must grow to fill the target. Each change restarts Stream Deck and the new window size is
    /// only known afterwards (e.g. after showing empty keys), so this re-checks on later Apply()
    /// calls until the deck fits or a few attempts are used up.
    /// </summary>
    private void FitKeys(RECT target, RECT current)
    {
        if (_fitting || _fitAttempts >= MaxFitAttempts || DateTime.Now - _lastFit < TimeSpan.FromSeconds(12)) return;
        if (current.Width <= 0 || current.Height <= 0) return;

        var scale = Math.Min((double)target.Width / current.Width, (double)target.Height / current.Height) * 0.96;
        var hideEmpty = StreamDeckSettings.ReadHideEmptyKeys();
        var emptyKeysWrong = hideEmpty is { } h && h == _showEmptyKeys;
        if (!emptyKeysWrong && Math.Abs(scale - 1) < 0.08)
        {
            _fitAttempts = MaxFitAttempts; // fits; stop checking until the goal changes
            _fittedFor = target;
            return;
        }

        _fitting = true;
        _fitAttempts++;
        _lastFit = DateTime.Now;
        _fittedFor = target;
        System.Threading.Tasks.Task.Run(() =>
        {
            try
            {
                if (StreamDeckSettings.ReadKeySize() is not { } keySize) return;
                // When only the empty-keys setting changes, keep the size: the next pass measures the new shape.
                var wanted = emptyKeysWrong ? keySize : (int)Math.Round(keySize * scale);
                Log.Info($"Fitting Virtual Stream Deck (pass {_fitAttempts}): window {current.Width}x{current.Height}, slot {target.Width}x{target.Height}, key size {keySize} -> {wanted}, show empty keys {_showEmptyKeys}");
                if (StreamDeckSettings.Apply(wanted, _showEmptyKeys)) _window = IntPtr.Zero; // Stream Deck recreates its window
            }
            catch (Exception ex)
            {
                Log.Error("Fitting the Virtual Stream Deck failed", ex);
            }
            finally
            {
                _fitting = false;
            }
        });
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

        if (_fit) FitKeys(t, current);
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
