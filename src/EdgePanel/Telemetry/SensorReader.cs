using System;
using System.Linq;
using LibreHardwareMonitor.Hardware;

namespace EdgePanel.Telemetry;

public sealed record SensorSnapshot(
    float? CpuLoad,
    float? CpuTemp,
    float? GpuLoad,
    float? GpuTemp,
    float? GpuMemUsedMb,
    float? GpuMemTotalMb,
    float? RamLoad,
    float? RamUsedGb,
    float? RamTotalGb,
    string? CpuName,
    string? GpuName);

/// <summary>
/// Reads CPU/GPU/RAM sensors through LibreHardwareMonitor.
/// Load and GPU values work as a normal user; CPU temperatures need admin.
/// </summary>
public sealed class SensorReader : IDisposable
{
    private readonly Computer _computer;

    public SensorReader()
    {
        _computer = new Computer { IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true };
        _computer.Open();
    }

    public SensorSnapshot Read()
    {
        foreach (var hw in _computer.Hardware)
        {
            hw.Update();
            foreach (var sub in hw.SubHardware) sub.Update();
        }

        var cpu = _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
        var gpu = _computer.Hardware.FirstOrDefault(h => h.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd)
                  ?? _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.GpuIntel);
        var mem = _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Memory);

        var ramUsed = Value(mem, SensorType.Data, "Memory Used");
        var ramFree = Value(mem, SensorType.Data, "Memory Available");

        return new SensorSnapshot(
            CpuLoad: Value(cpu, SensorType.Load, "CPU Total"),
            // Without admin the CPU temperature sensors exist but report 0.
            CpuTemp: ValidTemp(Value(cpu, SensorType.Temperature, "CPU Package", "Core (Tctl/Tdie)", "Core Average")
                     ?? FirstValue(cpu, SensorType.Temperature)),
            GpuLoad: Value(gpu, SensorType.Load, "GPU Core", "D3D 3D"),
            GpuTemp: Value(gpu, SensorType.Temperature, "GPU Core", "GPU Hot Spot")
                     ?? FirstValue(gpu, SensorType.Temperature),
            GpuMemUsedMb: Value(gpu, SensorType.SmallData, "GPU Memory Used", "D3D Dedicated Memory Used"),
            GpuMemTotalMb: Value(gpu, SensorType.SmallData, "GPU Memory Total"),
            RamLoad: Value(mem, SensorType.Load, "Memory"),
            RamUsedGb: ramUsed,
            RamTotalGb: ramUsed + ramFree,
            CpuName: cpu?.Name,
            GpuName: gpu?.Name);
    }

    private static float? Value(IHardware? hw, SensorType type, params string[] names)
    {
        if (hw is null) return null;
        foreach (var name in names)
        {
            var sensor = AllSensors(hw).FirstOrDefault(s => s.SensorType == type && s.Name == name && s.Value.HasValue);
            if (sensor is not null) return sensor.Value;
        }
        return null;
    }

    private static float? ValidTemp(float? value) => value > 0 ? value : null;

    private static float? FirstValue(IHardware? hw, SensorType type) =>
        hw is null ? null : AllSensors(hw).FirstOrDefault(s => s.SensorType == type && s.Value.HasValue)?.Value;

    private static System.Collections.Generic.IEnumerable<ISensor> AllSensors(IHardware hw) =>
        hw.Sensors.Concat(hw.SubHardware.SelectMany(s => s.Sensors));

    public void Dispose() => _computer.Close();
}
