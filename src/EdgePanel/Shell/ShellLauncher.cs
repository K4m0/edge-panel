using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace EdgePanel.Shell;

/// <summary>
/// Opens apps, files and links WITHOUT Edge Panel's admin rights. When the app runs elevated (for CPU
/// temperatures), a plain Process.Start would hand admin to whatever the launcher, a deck button or a
/// link opens. Instead this asks the desktop shell (Explorer, unelevated) to do the ShellExecute.
/// </summary>
public static class ShellLauncher
{
    public static void Open(string target, string? arguments = null, string? workingDirectory = null)
    {
        if (!WindowsStartup.IsElevated)
        {
            Process.Start(new ProcessStartInfo(target) { Arguments = arguments ?? "", WorkingDirectory = workingDirectory ?? "", UseShellExecute = true });
            return;
        }

        try
        {
            ShellExecuteViaDesktop(target, arguments ?? "", workingDirectory ?? "");
        }
        catch (Exception ex)
        {
            // Explorer also launches unelevated, but cannot pass arguments.
            Log.Error("Desktop shell launch failed, falling back to explorer.exe", ex);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{target}\"") { UseShellExecute = false });
        }
    }

    private static readonly Guid CLSID_ShellWindows = new("9BA05972-F6A8-11CF-A442-00A0C90A8F39");
    private static readonly Guid SID_STopLevelBrowser = new("4C96BE40-915C-11CF-99D3-00AA004AE837");
    private static readonly Guid IID_IShellBrowser = new("000214E2-0000-0000-C000-000000000046");
    private static readonly Guid IID_IDispatch = new("00020400-0000-0000-C000-000000000046");
    private const int SWC_DESKTOP = 8;
    private const int SWFO_NEEDDISPATCH = 1;
    private const uint SVGIO_BACKGROUND = 0;
    private const int SW_SHOWNORMAL = 1;

    /// <summary>The documented "launch unelevated from an elevated process" route (desktop folder view → IShellDispatch2).</summary>
    private static void ShellExecuteViaDesktop(string file, string args, string dir)
    {
        dynamic shellWindows = Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_ShellWindows)!)!;
        object loc = null!, root = null!;
        object desktop = shellWindows.FindWindowSW(ref loc, ref root, SWC_DESKTOP, out int _, SWFO_NEEDDISPATCH);

        var sp = (IServiceProvider)desktop;
        var sid = SID_STopLevelBrowser;
        var iid = IID_IShellBrowser;
        Marshal.ThrowExceptionForHR(sp.QueryService(ref sid, ref iid, out var browserObj));
        var browser = (IShellBrowser)browserObj;
        browser.QueryActiveShellView(out var view);

        var dispId = IID_IDispatch;
        view.GetItemObject(SVGIO_BACKGROUND, ref dispId, out var folderView);
        dynamic shell = ((dynamic)folderView).Application;
        shell.ShellExecute(file, args, dir, "open", SW_SHOWNORMAL);
    }

    [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IServiceProvider
    {
        [PreserveSig]
        int QueryService(ref Guid guidService, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppvObject);
    }

    // Only QueryActiveShellView is called; the other slots keep the vtable order.
    [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellBrowser
    {
        void GetWindow(out IntPtr phwnd);
        void ContextSensitiveHelp(bool fEnterMode);
        void InsertMenusSB(IntPtr hmenuShared, IntPtr lpMenuWidths);
        void SetMenuSB(IntPtr hmenuShared, IntPtr holemenuRes, IntPtr hwndActiveObject);
        void RemoveMenusSB(IntPtr hmenuShared);
        void SetStatusTextSB(IntPtr pszStatusText);
        void EnableModelessSB(bool fEnable);
        void TranslateAcceleratorSB(IntPtr pmsg, ushort wID);
        void BrowseObject(IntPtr pidl, uint wFlags);
        void GetViewStateStream(uint grfMode, out IntPtr ppStrm);
        void GetControlWindow(uint id, out IntPtr phwnd);
        void SendControlMsg(uint id, uint uMsg, IntPtr wParam, IntPtr lParam, out IntPtr pret);
        void QueryActiveShellView(out IShellView ppshv);
    }

    // Only GetItemObject is called; the other slots keep the vtable order.
    [ComImport, Guid("000214E3-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellView
    {
        void GetWindow(out IntPtr phwnd);
        void ContextSensitiveHelp(bool fEnterMode);
        void TranslateAccelerator(IntPtr pmsg);
        void EnableModeless(bool fEnable);
        void UIActivate(uint uState);
        void Refresh();
        void CreateViewWindow(IntPtr psvPrevious, IntPtr pfs, IntPtr psb, IntPtr prcView, out IntPtr phWnd);
        void DestroyViewWindow();
        void GetCurrentInfo(IntPtr pfs);
        void AddPropertySheetPages(uint dwReserved, IntPtr pfn, IntPtr lparam);
        void SaveViewState();
        void SelectItem(IntPtr pidlItem, uint uFlags);
        void GetItemObject(uint uItem, ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }
}
