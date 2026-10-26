using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace EdgePanel.Input;

/// <summary>
/// Synthesizes keyboard and mouse input with SendInput for the virtual keyboard, touchpad and
/// deck buttons. Input goes to whatever window has focus, which is why the panel window is
/// WS_EX_NOACTIVATE: touching it must not take focus away from the target app.
/// </summary>
public static class InputSimulator
{
    /// <summary>Marks our own events, so they can be told apart from real input if ever needed.</summary>
    public static readonly UIntPtr ExtraInfo = new(0x45444745); // "EDGE"

    /// <summary>Presses and releases a combo: modifiers down, key down/up, modifiers up.</summary>
    public static void Press(KeyCombo combo)
    {
        var inputs = new List<INPUT>();
        var mods = ModifierKeys(combo.Mods);
        foreach (var vk in mods) inputs.Add(Key(vk, up: false));
        inputs.Add(Key(combo.Vk, up: false));
        inputs.Add(Key(combo.Vk, up: true));
        for (var i = mods.Count - 1; i >= 0; i--) inputs.Add(Key(mods[i], up: true));
        Send(inputs);
    }

    public static bool Press(string keys)
    {
        if (!KeyParser.TryParse(keys, out var combo))
        {
            Log.Info($"Unknown key combination '{keys}'");
            return false;
        }
        Press(combo);
        return true;
    }

    /// <summary>Types text as Unicode characters, independent of the keyboard layout.</summary>
    public static void Type(string text)
    {
        var inputs = new List<INPUT>();
        foreach (var c in text)
        {
            switch (c)
            {
                case '\r':
                    continue;
                case '\n':
                    inputs.Add(Key(0x0D, up: false));
                    inputs.Add(Key(0x0D, up: true));
                    continue;
                case '\t':
                    inputs.Add(Key(0x09, up: false));
                    inputs.Add(Key(0x09, up: true));
                    continue;
            }
            inputs.Add(Unicode(c, up: false));
            inputs.Add(Unicode(c, up: true));
        }
        Send(inputs);
    }

    public static void MoveBy(int dx, int dy) =>
        Send(new List<INPUT> { Mouse(MOUSEEVENTF_MOVE, dx, dy, 0) });

    public static void Button(string button, bool? down)
    {
        var (downFlag, upFlag) = button switch
        {
            "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
            _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        };
        var inputs = new List<INPUT>();
        if (down != false) inputs.Add(Mouse(downFlag, 0, 0, 0));
        if (down != true) inputs.Add(Mouse(upFlag, 0, 0, 0));
        Send(inputs);
    }

    /// <summary>
    /// Scrolls like a DOM wheel event: positive <paramref name="dy"/> scrolls down,
    /// about 100 units per notch (one notch = WHEEL_DELTA 120).
    /// </summary>
    public static void Scroll(double dy, double dx = 0)
    {
        var inputs = new List<INPUT>();
        var v = (int)Math.Round(-dy * 1.2);
        var h = (int)Math.Round(dx * 1.2);
        if (v != 0) inputs.Add(Mouse(MOUSEEVENTF_WHEEL, 0, 0, v));
        if (h != 0) inputs.Add(Mouse(MOUSEEVENTF_HWHEEL, 0, 0, h));
        Send(inputs);
    }

    private static List<ushort> ModifierKeys(KeyMods mods)
    {
        var list = new List<ushort>();
        if (mods.HasFlag(KeyMods.Ctrl)) list.Add(0xA2);  // VK_LCONTROL
        if (mods.HasFlag(KeyMods.Shift)) list.Add(0xA0); // VK_LSHIFT
        if (mods.HasFlag(KeyMods.Alt)) list.Add(0xA4);   // VK_LMENU
        if (mods.HasFlag(KeyMods.Win)) list.Add(0x5B);   // VK_LWIN
        return list;
    }

    private static INPUT Key(ushort vk, bool up)
    {
        var flags = up ? KEYEVENTF_KEYUP : 0;
        if (IsExtended(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
        return new INPUT
        {
            type = INPUT_KEYBOARD,
            u = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = vk,
                    // Games reading raw scan codes ignore events without one.
                    wScan = (ushort)MapVirtualKey(vk, MAPVK_VK_TO_VSC),
                    dwFlags = flags,
                    dwExtraInfo = ExtraInfo,
                },
            },
        };
    }

    private static INPUT Unicode(char c, bool up) => new()
    {
        type = INPUT_KEYBOARD,
        u = new InputUnion
        {
            ki = new KEYBDINPUT { wScan = c, dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0), dwExtraInfo = ExtraInfo },
        },
    };

    private static INPUT Mouse(uint flags, int dx, int dy, int data) => new()
    {
        type = INPUT_MOUSE,
        u = new InputUnion
        {
            mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = unchecked((uint)data), dwFlags = flags, dwExtraInfo = ExtraInfo },
        },
    };

    private static bool IsExtended(ushort vk) => vk is
        0x21 or 0x22 or 0x23 or 0x24 or 0x25 or 0x26 or 0x27 or 0x28 or // PgUp PgDn End Home arrows
        0x2C or 0x2D or 0x2E or // PrintScreen Insert Delete
        0x5B or 0x5C or 0x5D or // Win keys, Apps
        0x6F or 0x90 or // Divide, NumLock
        0xA3 or 0xA5 or // RCtrl, RAlt
        (>= 0xA6 and <= 0xB7); // browser, volume, media keys

    private static void Send(List<INPUT> inputs)
    {
        if (inputs.Count == 0) return;
        var array = inputs.ToArray();
        var sent = SendInput((uint)array.Length, array, Marshal.SizeOf<INPUT>());
        if (sent != array.Length)
            Log.Error($"SendInput sent {sent}/{array.Length} events (error {Marshal.GetLastWin32Error()}); blocked by UIPI?");
    }

    // ---- interop ----
    // INPUT is { DWORD type; union { MOUSEINPUT; KEYBDINPUT; HARDWAREINPUT } }. The union holds a
    // ULONG_PTR, so on x64 it is 8-byte aligned at offset 8 and INPUT is 40 bytes (28 on x86).
    // Declaring the union as its own struct lets the marshaller compute that padding correctly.

    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_HWHEEL = 0x1000;
    private const uint MAPVK_VK_TO_VSC = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, [In] INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern uint MapVirtualKey(uint uCode, uint uMapType);
}
