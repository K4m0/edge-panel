using System;
using System.Collections.Generic;

namespace EdgePanel.Input;

[Flags]
public enum KeyMods
{
    None = 0,
    Alt = 1,     // same bits as RegisterHotKey's MOD_ALT/MOD_CONTROL/MOD_SHIFT/MOD_WIN
    Ctrl = 2,
    Shift = 4,
    Win = 8,
}

/// <summary>A key plus modifiers, parsed from strings such as "Ctrl+Shift+Esc", "Win+D" or "F13".</summary>
public readonly record struct KeyCombo(ushort Vk, KeyMods Mods)
{
    public override string ToString() => $"{Mods}+0x{Vk:X2}";
}

/// <summary>
/// Parses key combination strings shared by deck buttons, the keyboard widget and hotkeys.
/// Names are case-insensitive; a single character maps to its key on the US layout.
/// </summary>
public static class KeyParser
{
    private static readonly Dictionary<string, ushort> Named = new(StringComparer.OrdinalIgnoreCase)
    {
        ["enter"] = 0x0D, ["return"] = 0x0D, ["esc"] = 0x1B, ["escape"] = 0x1B, ["tab"] = 0x09,
        ["space"] = 0x20, ["spacebar"] = 0x20, ["backspace"] = 0x08, ["bksp"] = 0x08,
        ["delete"] = 0x2E, ["del"] = 0x2E, ["insert"] = 0x2D, ["ins"] = 0x2D,
        ["home"] = 0x24, ["end"] = 0x23, ["pageup"] = 0x21, ["pgup"] = 0x21, ["pagedown"] = 0x22, ["pgdn"] = 0x22,
        ["left"] = 0x25, ["up"] = 0x26, ["right"] = 0x27, ["down"] = 0x28,
        ["printscreen"] = 0x2C, ["prtsc"] = 0x2C, ["prtscn"] = 0x2C, ["print"] = 0x2C,
        ["pause"] = 0x13, ["break"] = 0x13, ["capslock"] = 0x14, ["numlock"] = 0x90, ["scrolllock"] = 0x91,
        ["menu"] = 0x5D, ["apps"] = 0x5D, ["contextmenu"] = 0x5D,
        ["volumeup"] = 0xAF, ["volup"] = 0xAF, ["volumedown"] = 0xAE, ["voldown"] = 0xAE,
        ["volumemute"] = 0xAD, ["mute"] = 0xAD,
        ["medianext"] = 0xB0, ["nexttrack"] = 0xB0, ["mediaprev"] = 0xB1, ["prevtrack"] = 0xB1,
        ["mediastop"] = 0xB2, ["playpause"] = 0xB3, ["mediaplaypause"] = 0xB3,
        ["browserback"] = 0xA6, ["browserforward"] = 0xA7, ["browserrefresh"] = 0xA8, ["browserhome"] = 0xAC,
        ["multiply"] = 0x6A, ["add"] = 0x6B, ["subtract"] = 0x6D, ["decimal"] = 0x6E, ["divide"] = 0x6F,
        ["plus"] = 0xBB, ["minus"] = 0xBD, ["comma"] = 0xBC, ["period"] = 0xBE,
        ["lwin"] = 0x5B, ["rwin"] = 0x5C, ["lctrl"] = 0xA2, ["rctrl"] = 0xA3, ["lshift"] = 0xA0, ["rshift"] = 0xA1,
        ["lalt"] = 0xA4, ["ralt"] = 0xA5,
        // Names written by the settings editor's key recorder.
        ["equal"] = 0xBB, ["semicolon"] = 0xBA, ["slash"] = 0xBF, ["backtick"] = 0xC0, ["quote"] = 0xDE,
        ["lbracket"] = 0xDB, ["backslash"] = 0xDC, ["rbracket"] = 0xDD,
        ["numadd"] = 0x6B, ["numsubtract"] = 0x6D, ["nummultiply"] = 0x6A, ["numdivide"] = 0x6F, ["numdecimal"] = 0x6E,
    };

    private static readonly Dictionary<char, ushort> Punctuation = new()
    {
        [';'] = 0xBA, ['='] = 0xBB, [','] = 0xBC, ['-'] = 0xBD, ['.'] = 0xBE, ['/'] = 0xBF, ['`'] = 0xC0,
        ['['] = 0xDB, ['\\'] = 0xDC, [']'] = 0xDD, ['\''] = 0xDE,
    };

    public static bool TryParse(string? text, out KeyCombo combo)
    {
        combo = default;
        if (string.IsNullOrWhiteSpace(text)) return false;

        // "Ctrl++" means Ctrl and the plus key, so a trailing "+" is a key, not a separator.
        var raw = text.Trim();
        var parts = new List<string>(raw.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries));
        if (raw.EndsWith("++", StringComparison.Ordinal) || raw == "+") parts.Add("plus");

        var mods = KeyMods.None;
        ushort vk = 0;
        foreach (var part in parts)
        {
            var mod = ParseMod(part);
            if (mod != KeyMods.None)
            {
                mods |= mod;
                continue;
            }
            if (vk != 0 || !TryParseKey(part, out vk)) return false;
        }

        // A bare modifier ("Win") is still a valid press.
        if (vk == 0)
        {
            vk = mods switch
            {
                KeyMods.Win => 0x5B,
                KeyMods.Ctrl => 0x11,
                KeyMods.Shift => 0x10,
                KeyMods.Alt => 0x12,
                _ => (ushort)0,
            };
            if (vk == 0) return false;
            mods = KeyMods.None;
        }

        combo = new KeyCombo(vk, mods);
        return true;
    }

    public static KeyMods ParseMod(string name) => name.ToLowerInvariant() switch
    {
        "ctrl" or "control" or "ctl" => KeyMods.Ctrl,
        "shift" => KeyMods.Shift,
        "alt" or "option" => KeyMods.Alt,
        "win" or "windows" or "meta" or "super" or "cmd" => KeyMods.Win,
        _ => KeyMods.None,
    };

    public static bool TryParseKey(string name, out ushort vk)
    {
        vk = 0;
        if (Named.TryGetValue(name, out vk)) return true;

        if (name.Length == 1)
        {
            var c = char.ToUpperInvariant(name[0]);
            if (c is >= 'A' and <= 'Z' or >= '0' and <= '9')
            {
                vk = c;
                return true;
            }
            return Punctuation.TryGetValue(c, out vk);
        }

        var lower = name.ToLowerInvariant();
        if (lower[0] == 'f' && int.TryParse(lower[1..], out var f) && f is >= 1 and <= 24)
        {
            vk = (ushort)(0x70 + f - 1);
            return true;
        }
        foreach (var prefix in new[] { "numpad", "num" })
        {
            if (lower.StartsWith(prefix, StringComparison.Ordinal) && int.TryParse(lower[prefix.Length..], out var n) && n is >= 0 and <= 9)
            {
                vk = (ushort)(0x60 + n);
                return true;
            }
        }
        return false;
    }
}
