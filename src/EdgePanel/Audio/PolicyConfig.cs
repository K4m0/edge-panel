using System;
using System.Runtime.InteropServices;

namespace EdgePanel.Audio;

/// <summary>
/// Undocumented IPolicyConfig (Windows 7 to 11), the only way for a desktop app to change the
/// default audio endpoint; it is what the Sound control panel uses. Only SetDefaultEndpoint is
/// called; the other slots exist to keep the vtable order.
/// </summary>
internal static class PolicyConfig
{
    private enum ERole
    {
        Console = 0,
        Multimedia = 1,
        Communications = 2,
    }

    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    private class CPolicyConfigClient
    {
    }

    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int defaultFormat, IntPtr format);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int defaultPeriod, IntPtr defaultPeriodOut, IntPtr minPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr period);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string deviceId, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int fxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int fxStore, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ERole role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int visible);
    }

    /// <summary>Makes the endpoint the default for every role, like "Set as Default Device" does.</summary>
    public static void SetDefaultEndpoint(string deviceId)
    {
        var client = new CPolicyConfigClient();
        try
        {
            var policy = (IPolicyConfig)client;
            foreach (var role in new[] { ERole.Console, ERole.Multimedia, ERole.Communications })
            {
                var hr = policy.SetDefaultEndpoint(deviceId, role);
                if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            }
        }
        finally
        {
            Marshal.ReleaseComObject(client);
        }
    }
}
