using System;
using System.Collections.Generic;
using System.Linq;
using LibreHardwareMonitor.Hardware;

namespace EdgePanel.Telemetry;

/// <summary>One sensor reading as sent to the pages (<c>value</c> is null when unavailable).</summary>
public sealed record SensorValue(float? Value, string Name, string Hardware, string Type, string Unit);

/// <summary>A selectable sensor for the settings editor.</summary>
public sealed record SensorInfo(string Id, string Name, string Hardware, string Type, string Unit);

/// <summary>
/// Reads every LibreHardwareMonitor sensor, keyed by LHM's Identifier, plus stable aliases
/// (cpu.load, gpu.temp...) so default layouts work on any PC.
/// Load and GPU values work as a normal user; CPU temperatures (and some motherboard
/// sensors) need admin.
/// </summary>
public sealed class SensorReader : IDisposable
{
    private static readonly (string Id, string Name)[] Aliases =
    {
        ("cpu.load", "CPU Load"), ("cpu.temp", "CPU Temperature"), ("cpu.power", "CPU Power"), ("cpu.clock", "CPU Clock"),
        ("gpu.load", "GPU Load"), ("gpu.temp", "GPU Temperature"), ("gpu.hotspot", "GPU Hotspot"), ("gpu.power", "GPU Power"),
        ("gpu.vramUsed", "GPU Memory Used"), ("gpu.vramTotal", "GPU Memory Total"),
        ("ram.load", "Memory Load"), ("ram.used", "Memory Used"), ("ram.total", "Memory Total"),
    };

    private readonly Computer _computer;
    private volatile IReadOnlyList<SensorInfo> _catalog = Array.Empty<SensorInfo>();
    private volatile IReadOnlyDictionary<string, SensorValue> _last = new Dictionary<string, SensorValue>();

    public SensorReader()
    {
        _computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            IsMotherboardEnabled = true,
            IsStorageEnabled = true,
            IsNetworkEnabled = true,
            // Fan/AIO controllers such as Corsair Commander and iCUE coolers.
            IsControllerEnabled = true,
        };
        _computer.Open();
    }

    /// <summary>Catalog from the latest <see cref="Read"/>: aliases first, then by hardware and name.</summary>
    public IReadOnlyList<SensorInfo> Catalog => _catalog;

    /// <summary>Values from the latest <see cref="Read"/>, safe to read from any thread.</summary>
    public IReadOnlyDictionary<string, SensorValue> Last => _last;

    /// <summary>Updates all hardware and returns every sensor plus the aliases. Call from one thread only.</summary>
    public Dictionary<string, SensorValue> Read()
    {
        foreach (var hw in _computer.Hardware) UpdateRecursive(hw);

        var result = new Dictionary<string, SensorValue>(StringComparer.Ordinal);
        var all = new List<(IHardware Hw, ISensor Sensor)>();
        foreach (var hw in _computer.Hardware) Collect(hw, all);

        foreach (var (hw, s) in all)
            result[s.Identifier.ToString()] = new SensorValue(Clean(s.Value), s.Name, hw.Name, s.SensorType.ToString(), UnitOf(s.SensorType));

        AddAliases(result);

        var aliasIds = Aliases.Select(a => a.Id).ToHashSet(StringComparer.Ordinal);
        if (_catalog.Count != result.Count)
        {
            _catalog = result
                .Select(kv => new SensorInfo(kv.Key, kv.Value.Name, kv.Value.Hardware, kv.Value.Type, kv.Value.Unit))
                .OrderBy(s => aliasIds.Contains(s.Id) ? 0 : 1)
                .ThenBy(s => aliasIds.Contains(s.Id) ? Array.FindIndex(Aliases, a => a.Id == s.Id) : 0)
                .ThenBy(s => s.Hardware, StringComparer.OrdinalIgnoreCase)
                .ThenBy(s => s.Type, StringComparer.OrdinalIgnoreCase)
                .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        _last = result;
        return result;
    }

    private void AddAliases(Dictionary<string, SensorValue> result)
    {
        var cpu = _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
        var gpu = _computer.Hardware.FirstOrDefault(h => h.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd)
                  ?? _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.GpuIntel);
        var mem = _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Memory);

        var ramUsed = Value(mem, SensorType.Data, "Memory Used");
        var ramFree = Value(mem, SensorType.Data, "Memory Available");

        var coreClocks = cpu is null
            ? new List<float>()
            : AllSensors(cpu).Where(s => s.SensorType == SensorType.Clock && s.Name.StartsWith("Core #", StringComparison.Ordinal) && s.Value > 0)
                .Select(s => s.Value!.Value).ToList();

        void Add(string id, IHardware? hw, SensorType type, float? value)
        {
            var name = Aliases.First(a => a.Id == id).Name;
            result[id] = new SensorValue(Clean(value), name, hw?.Name ?? "", type.ToString(), UnitOf(type));
        }

        Add("cpu.load", cpu, SensorType.Load, Value(cpu, SensorType.Load, "CPU Total"));
        // Without admin the CPU temperature sensors exist but report 0.
        Add("cpu.temp", cpu, SensorType.Temperature, ValidTemp(
            Value(cpu, SensorType.Temperature, "CPU Package", "Core (Tctl/Tdie)", "Core Average", "Core (Tctl)")
            ?? FirstValue(cpu, SensorType.Temperature)));
        Add("cpu.power", cpu, SensorType.Power, Value(cpu, SensorType.Power, "Package", "CPU Package") ?? FirstValue(cpu, SensorType.Power));
        Add("cpu.clock", cpu, SensorType.Clock, coreClocks.Count > 0 ? coreClocks.Average() : null);

        Add("gpu.load", gpu, SensorType.Load, Value(gpu, SensorType.Load, "GPU Core", "D3D 3D"));
        Add("gpu.temp", gpu, SensorType.Temperature, Value(gpu, SensorType.Temperature, "GPU Core", "GPU Hot Spot") ?? FirstValue(gpu, SensorType.Temperature));
        Add("gpu.hotspot", gpu, SensorType.Temperature, Value(gpu, SensorType.Temperature, "GPU Hot Spot", "GPU Hotspot"));
        Add("gpu.power", gpu, SensorType.Power, Value(gpu, SensorType.Power, "GPU Package", "GPU Power", "GPU Core") ?? FirstValue(gpu, SensorType.Power));
        Add("gpu.vramUsed", gpu, SensorType.SmallData, Value(gpu, SensorType.SmallData, "GPU Memory Used", "D3D Dedicated Memory Used"));
        Add("gpu.vramTotal", gpu, SensorType.SmallData, Value(gpu, SensorType.SmallData, "GPU Memory Total", "D3D Dedicated Memory Total"));

        Add("ram.load", mem, SensorType.Load, Value(mem, SensorType.Load, "Memory"));
        Add("ram.used", mem, SensorType.Data, ramUsed);
        Add("ram.total", mem, SensorType.Data, ramUsed + ramFree);
    }

    /// <summary>Units by sensor type, as listed in docs/ARCHITECTURE.md.</summary>
    public static string UnitOf(SensorType type) => type switch
    {
        SensorType.Load or SensorType.Control or SensorType.Level => "%",
        SensorType.Temperature => "°C",
        SensorType.Clock => "MHz",
        SensorType.Power => "W",
        SensorType.Voltage => "V",
        SensorType.Fan => "RPM",
        SensorType.Data => "GB",
        SensorType.SmallData => "MB",
        SensorType.Throughput => "B/s",
        SensorType.Frequency => "Hz",
        SensorType.Flow => "L/h",
        _ => "",
    };

    /// <summary>LHM reports NaN for some sensors; JSON cannot carry it, so it becomes null.</summary>
    private static float? Clean(float? value) => value is { } v && float.IsFinite(v) ? v : null;

    private static void UpdateRecursive(IHardware hw)
    {
        try { hw.Update(); }
        catch (Exception ex) { Log.Error($"Sensor update failed for {hw.Name}", ex); }
        foreach (var sub in hw.SubHardware) UpdateRecursive(sub);
    }

    private static void Collect(IHardware hw, List<(IHardware, ISensor)> into)
    {
        foreach (var s in hw.Sensors) into.Add((hw, s));
        foreach (var sub in hw.SubHardware) Collect(sub, into);
    }

    private static float? Value(IHardware? hw, SensorType type, params string[] names)
    {
        if (hw is null) return null;
        foreach (var name in names)
        {
            var sensor = AllSensors(hw).FirstOrDefault(s => s.SensorType == type && s.Name == name && s.Value.HasValue && float.IsFinite(s.Value.Value));
            if (sensor is not null) return sensor.Value;
        }
        return null;
    }

    private static float? ValidTemp(float? value) => value > 0 ? value : null;

    private static float? FirstValue(IHardware? hw, SensorType type) =>
        hw is null ? null : AllSensors(hw).FirstOrDefault(s => s.SensorType == type && s.Value.HasValue && float.IsFinite(s.Value.Value))?.Value;

    private static IEnumerable<ISensor> AllSensors(IHardware hw) =>
        hw.Sensors.Concat(hw.SubHardware.SelectMany(AllSensors));

    public void Dispose() => _computer.Close();
}
