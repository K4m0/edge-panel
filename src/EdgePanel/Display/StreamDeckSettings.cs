using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace EdgePanel.Display;

/// <summary>
/// Changes the Virtual Stream Deck key size so the deck fills the Stream Deck widget.
/// Stream Deck has no API for this; the size lives in its Qt settings (HKCU\...\StreamDeck\Devices),
/// a QVariantMap where each device has a "UiSDConfiguration" JSON string with "keySize".
/// Stream Deck must be closed while the value is rewritten (it saves its settings on exit), so this
/// stops it, patches the value, and starts it again unelevated through Explorer.
/// </summary>
public static class StreamDeckSettings
{
    private const string KeyPath = @"Software\Elgato Systems GmbH\StreamDeck";
    private const string ValueName = "Devices";
    private const string ConfigKey = "UiSDConfiguration";
    private const uint QStringType = 10; // QMetaType::QString

    public const int MinKeySize = 40;
    public const int MaxKeySize = 200;

    /// <summary>Current key size of the first Virtual Stream Deck, or null if it can't be read.</summary>
    public static int? ReadKeySize()
    {
        var (json, _, _) = ReadConfig();
        return json?["keySize"]?.GetValue<int>();
    }

    /// <summary>Whether empty keys are hidden (the deck then shrinks to the used columns).</summary>
    public static bool? ReadHideEmptyKeys()
    {
        var (json, _, _) = ReadConfig();
        return json?["hideEmptyKeys"]?.GetValue<bool>();
    }

    /// <summary>
    /// Sets the key size and whether empty keys show, restarting Stream Deck.
    /// Returns false if nothing was changed.
    /// </summary>
    public static bool Apply(int keySize, bool showEmptyKeys)
    {
        keySize = Math.Clamp(keySize, MinKeySize, MaxKeySize);

        var exe = Process.GetProcessesByName("StreamDeck").Select(TryPath).FirstOrDefault(p => p is not null)
                  ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Elgato", "StreamDeck", "StreamDeck.exe");

        // Kill (not close): a normal exit would save the old settings over ours.
        foreach (var p in Process.GetProcessesByName("StreamDeck"))
        {
            try { p.Kill(); p.WaitForExit(5000); } catch (Exception ex) { Log.Error("Stopping Stream Deck failed", ex); }
        }

        var (json, raw, span) = ReadConfig();
        if (json is null || raw is null)
        {
            Restart(exe);
            return false;
        }

        if (json["keySize"]?.GetValue<int>() == keySize && json["hideEmptyKeys"]?.GetValue<bool>() == !showEmptyKeys)
        {
            Restart(exe);
            return false;
        }

        Backup(raw);
        json["keySize"] = keySize;
        json["hideEmptyKeys"] = !showEmptyKeys;
        Write(raw, span, json.ToJsonString());
        Log.Info($"Virtual Stream Deck key size set to {keySize}, empty keys {(showEmptyKeys ? "shown" : "hidden")}");
        Restart(exe);
        return true;
    }

    private static string? TryPath(Process p)
    {
        try { return p.MainModule?.FileName; }
        catch { return null; }
    }

    /// <summary>Starts Stream Deck through Explorer so it runs unelevated even when Edge Panel is elevated.</summary>
    private static void Restart(string exe)
    {
        if (!File.Exists(exe)) return;
        try { Process.Start(new ProcessStartInfo("explorer.exe", $"\"{exe}\"") { UseShellExecute = false }); }
        catch (Exception ex) { Log.Error("Restarting Stream Deck failed", ex); }
    }

    private static void Backup(byte[] raw)
    {
        try { File.WriteAllBytes(Path.Combine(Log.Directory, $"streamdeck-devices-{DateTime.Now:yyyyMMdd-HHmmss}.bak"), raw); }
        catch (Exception ex) { Log.Error("Backing up Stream Deck settings failed", ex); }
    }

    /// <summary>
    /// QSettings on Windows stores a QVariant as REG_BINARY holding the UTF-16LE text "@Variant(...)",
    /// where every byte of the QDataStream is one char. Inside, QStrings are a big-endian byte length
    /// followed by UTF-16BE data. Returns the JSON, the raw value and the (start, length) of the
    /// length-prefixed string within the decoded char data.
    /// </summary>
    private static (JsonObject? Json, byte[]? Raw, (int Start, int Length) Span) ReadConfig()
    {
        using var key = Registry.CurrentUser.OpenSubKey(KeyPath);
        if (key?.GetValue(ValueName) is not byte[] raw) return (null, null, default);

        var data = Encoding.Unicode.GetString(raw); // one char per QDataStream byte
        var marker = Utf16Be(ConfigKey);
        var at = data.IndexOf(marker, StringComparison.Ordinal);
        if (at < 0) return (null, raw, default);

        // After the key: QVariant = quint32 type, then (depending on the stream version) a quint8
        // isNull flag, then the QString (quint32 length + data). Stream Deck 7.6 writes no flag;
        // accept either layout by checking that the text starts with '{'.
        var pos = at + marker.Length;
        if (pos + 9 > data.Length || ReadUInt32(data, pos) != QStringType) return (null, raw, default);
        var lengthAt = -1;
        foreach (var candidate in new[] { pos + 4, pos + 5 })
        {
            var len = (int)ReadUInt32(data, candidate);
            if (len > 0 && candidate + 4 + len <= data.Length && data[candidate + 4] == '\0' && data[candidate + 5] == '{')
            {
                lengthAt = candidate;
                break;
            }
        }
        if (lengthAt < 0) return (null, raw, default);
        var byteLength = (int)ReadUInt32(data, lengthAt);
        var textAt = lengthAt + 4;

        var text = FromUtf16Be(data.Substring(textAt, byteLength));
        try
        {
            return (JsonNode.Parse(text) as JsonObject, raw, (lengthAt, 4 + byteLength));
        }
        catch (Exception ex)
        {
            Log.Error("Unexpected Virtual Stream Deck settings format", ex);
            return (null, raw, default);
        }
    }

    private static void Write(byte[] raw, (int Start, int Length) span, string json)
    {
        var data = Encoding.Unicode.GetString(raw);
        var encoded = Utf16Be(json);
        var replacement = WriteUInt32((uint)encoded.Length) + encoded;
        var patched = data[..span.Start] + replacement + data[(span.Start + span.Length)..];

        using var key = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true);
        key?.SetValue(ValueName, Encoding.Unicode.GetBytes(patched), RegistryValueKind.Binary);
    }

    private static string Utf16Be(string s)
    {
        var sb = new StringBuilder(s.Length * 2);
        foreach (var c in s)
        {
            sb.Append((char)(c >> 8));
            sb.Append((char)(c & 0xFF));
        }
        return sb.ToString();
    }

    private static string FromUtf16Be(string bytes)
    {
        var sb = new StringBuilder(bytes.Length / 2);
        for (var i = 0; i + 1 < bytes.Length; i += 2) sb.Append((char)((bytes[i] << 8) | bytes[i + 1]));
        return sb.ToString();
    }

    private static uint ReadUInt32(string data, int at) =>
        ((uint)data[at] << 24) | ((uint)data[at + 1] << 16) | ((uint)data[at + 2] << 8) | data[at + 3];

    private static string WriteUInt32(uint v) =>
        new(new[] { (char)(v >> 24), (char)((v >> 16) & 0xFF), (char)((v >> 8) & 0xFF), (char)(v & 0xFF) });
}
