using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace EdgePanel.Input;

public enum HotkeyAction
{
    NextPage = 1,
    PrevPage = 2,
    ToggleMode = 3,
}

/// <summary>
/// System-wide hotkeys registered on the panel window. RegisterHotKey works even while the
/// panel is hidden (desktop mode), and needs no keyboard hook.
/// </summary>
public sealed class HotkeyService : IDisposable
{
    public const int WM_HOTKEY = 0x0312;

    private const uint MOD_NOREPEAT = 0x4000;

    private readonly IntPtr _hwnd;
    private readonly HashSet<int> _registered = new();

    public HotkeyService(IntPtr hwnd) => _hwnd = hwnd;

    /// <summary>Replaces all hotkeys. Returns a message per hotkey that could not be registered.</summary>
    public List<string> Register(HotkeyConfig config)
    {
        Unregister();
        var errors = new List<string>();
        Add(HotkeyAction.NextPage, config.NextPage, "Next page", errors);
        Add(HotkeyAction.PrevPage, config.PrevPage, "Previous page", errors);
        Add(HotkeyAction.ToggleMode, config.ToggleMode, "Toggle panel/desktop", errors);
        return errors;
    }

    /// <summary>Maps a WM_HOTKEY wParam to its action, or null when it is not ours.</summary>
    public HotkeyAction? ActionFor(IntPtr wParam)
    {
        var id = wParam.ToInt32();
        return _registered.Contains(id) ? (HotkeyAction)id : null;
    }

    private void Add(HotkeyAction action, string keys, string label, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(keys)) return;
        if (!KeyParser.TryParse(keys, out var combo))
        {
            errors.Add($"{label} hotkey '{keys}' is not a valid key combination");
            return;
        }

        var id = (int)action;
        if (RegisterHotKey(_hwnd, id, (uint)combo.Mods | MOD_NOREPEAT, combo.Vk))
        {
            _registered.Add(id);
            Log.Info($"Hotkey {action} = {keys}");
        }
        else
        {
            var error = Marshal.GetLastWin32Error();
            Log.Error($"RegisterHotKey {action} '{keys}' failed: {error}");
            errors.Add($"{label} hotkey '{keys}' is already used by another app");
        }
    }

    private void Unregister()
    {
        foreach (var id in _registered) UnregisterHotKey(_hwnd, id);
        _registered.Clear();
    }

    public void Dispose() => Unregister();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
