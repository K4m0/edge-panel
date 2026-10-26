using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace EdgePanel.Tray;

/// <summary>
/// Dark, rounded tray menu that matches the settings window (WinForms' default menu looks out of place).
/// Icons are drawn from the Segoe Fluent Icons / MDL2 font, so they follow the system look and scale cleanly.
/// </summary>
public sealed class TrayMenuRenderer : ToolStripProfessionalRenderer
{
    public static readonly Color Background = Color.FromArgb(24, 28, 36);
    public static readonly Color Hover = Color.FromArgb(40, 47, 59);
    public static readonly Color Border = Color.FromArgb(52, 60, 74);
    public static readonly Color Text = Color.FromArgb(232, 237, 243);
    public static readonly Color Muted = Color.FromArgb(138, 148, 163);
    public static readonly Color Accent = Color.FromArgb(242, 201, 76);
    public static readonly Color Danger = Color.FromArgb(235, 87, 87);

    private static readonly string IconFont = FontExists("Segoe Fluent Icons") ? "Segoe Fluent Icons" : "Segoe MDL2 Assets";

    public TrayMenuRenderer() : base(new DarkColors()) => RoundedEdges = false;

    /// <summary>Applies the renderer, font, spacing and Windows 11 rounded corners to a menu.</summary>
    public static void Style(ContextMenuStrip menu)
    {
        menu.Renderer = new TrayMenuRenderer();
        menu.BackColor = Background;
        menu.ForeColor = Text;
        menu.Font = new Font("Segoe UI", 10f);
        menu.ShowImageMargin = true;
        menu.ShowCheckMargin = false;
        menu.Padding = new Padding(4, 6, 4, 6);
        menu.Opening += (_, _) =>
        {
            RoundCorners(menu.Handle);
            RenderGlyphs(menu);
        };
    }

    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<ToolStripItem, GlyphInfo> Glyphs = new();

    private sealed class GlyphInfo
    {
        public char Glyph;
        public int Dpi;
    }

    /// <summary>Menu item with an icon; checkable items get room on the right for the switch.</summary>
    public static ToolStripMenuItem Item(string text, char glyph, EventHandler? onClick = null, bool checkable = false)
    {
        var item = new ToolStripMenuItem(text, null, onClick)
        {
            CheckOnClick = checkable,
            Padding = new Padding(0, 5, 8, 5),
        };
        Glyphs.Add(item, new GlyphInfo { Glyph = glyph });
        return item;
    }

    /// <summary>(Re)draws icons at the menu's current DPI so they stay crisp at 125%/150% scaling.</summary>
    private static void RenderGlyphs(ContextMenuStrip menu)
    {
        var dpi = menu.DeviceDpi;
        int S(int px) => (int)Math.Round(px * dpi / 96.0);
        var size = S(20);
        menu.ImageScalingSize = new Size(size, size);

        // WinForms doesn't count item padding when sizing a dropdown at non-100% DPI, so size the
        // menu from the measured labels: icon column + longest label + room for the switch.
        var text = 0;
        foreach (ToolStripItem item in menu.Items)
            if (item is ToolStripMenuItem)
                text = Math.Max(text, TextRenderer.MeasureText(item.Text, item.Font).Width);
        menu.MinimumSize = new Size(size + S(18) + text + S(24) + S(32) + S(20), 0);
        foreach (ToolStripItem item in menu.Items)
        {
            if (!Glyphs.TryGetValue(item, out var info) || info.Dpi == dpi) continue;
            item.Image?.Dispose();
            item.Image = Glyph(info.Glyph, null, size);
            info.Dpi = dpi;
        }
    }

    /// <summary>Renders a glyph from the system icon font as a menu image.</summary>
    public static Bitmap Glyph(char glyph, Color? color = null, int size = 18)
    {
        var bmp = new Bitmap(size, size);
        using var g = Graphics.FromImage(bmp);
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        using var font = new Font(IconFont, size * 0.8f, GraphicsUnit.Pixel);
        using var brush = new SolidBrush(color ?? Text);
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString(glyph.ToString(), font, brush, new RectangleF(0, 0, size, size), format);
        return bmp;
    }

    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e) => e.Graphics.Clear(Background);

    protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
    {
        using var pen = new Pen(Border);
        e.Graphics.DrawRectangle(pen, 0, 0, e.AffectedBounds.Width - 1, e.AffectedBounds.Height - 1);
    }

    protected override void OnRenderImageMargin(ToolStripRenderEventArgs e) { }

    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        if (e.Item.Selected && e.Item.Enabled)
        {
            var r = new Rectangle(2, 1, e.Item.Width - 4, e.Item.Height - 2);
            using var path = RoundedRect(r, Scale(e.Item, 6));
            using var brush = new SolidBrush(Hover);
            g.FillPath(brush, path);
        }
        // Drawn here (full item bounds); the image callback is clipped to the icon box.
        if (e.Item is ToolStripMenuItem { CheckOnClick: true } item) DrawSwitch(g, item);
    }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = !e.Item.Enabled ? Muted : e.Item.Tag as string == "danger" && e.Item.Selected ? Danger : Text;
        base.OnRenderItemText(e);
    }

    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
    {
        // Checkable items show a toggle switch on the right instead of a boxed check mark (see DrawSwitch).
    }

    protected override void OnRenderItemImage(ToolStripItemImageRenderEventArgs e)
    {
        // Draw the glyph at its own pixel size: the default path stretches it into the
        // checked-state box and blurs it.
        if (e.Image is null) return;
        var r = e.ImageRectangle;
        var x = r.X + (r.Width - e.Image.Width) / 2;
        var y = r.Y + (r.Height - e.Image.Height) / 2;
        e.Graphics.DrawImage(e.Image, x, y, e.Image.Width, e.Image.Height);
    }

    /// <summary>A small toggle switch at the right edge for checkable items.</summary>
    private static void DrawSwitch(Graphics g, ToolStripMenuItem item)
    {
        int w = Scale(item, 32), h = Scale(item, 18), pad = Scale(item, 3);
        // At non-100% DPI the item can be laid out wider than the visible menu; anchor to what is shown.
        var right = item.Owner is { } owner ? Math.Min(item.Width, owner.ClientSize.Width - item.Bounds.X - Scale(item, 6)) : item.Width;
        var x = right - w - Scale(item, 10);
        var y = (item.Height - h) / 2;
        using var track = RoundedRect(new Rectangle(x, y, w, h), h / 2);
        using var trackBrush = new SolidBrush(item.Checked ? Accent : Border);
        g.FillPath(trackBrush, track);
        var d = h - pad * 2;
        var knob = item.Checked ? x + w - d - pad : x + pad;
        using var knobBrush = new SolidBrush(item.Checked ? Background : Text);
        g.FillEllipse(knobBrush, knob, y + pad, d, d);
    }

    private static int Scale(ToolStripItem item, int px) => (int)Math.Round(px * (item.Owner?.DeviceDpi ?? 96) / 96.0);

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        var y = e.Item.Height / 2;
        using var pen = new Pen(Border);
        e.Graphics.DrawLine(pen, 10, y, e.Item.Width - 10, y);
    }

    private static GraphicsPath RoundedRect(Rectangle r, int radius)
    {
        var d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static bool FontExists(string name)
    {
        using var font = new Font(name, 10f);
        return font.Name.Equals(name, StringComparison.OrdinalIgnoreCase);
    }

    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_ROUND = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    private static void RoundCorners(IntPtr hwnd)
    {
        var pref = DWMWCP_ROUND;
        DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, sizeof(int)); // no-op before Windows 11
    }

    private sealed class DarkColors : ProfessionalColorTable
    {
        public override Color ToolStripDropDownBackground => Background;
        public override Color MenuBorder => Border;
        public override Color MenuItemBorder => Color.Transparent;
        public override Color MenuItemSelected => Hover;
        public override Color ImageMarginGradientBegin => Background;
        public override Color ImageMarginGradientMiddle => Background;
        public override Color ImageMarginGradientEnd => Background;
        public override Color SeparatorDark => Border;
        public override Color SeparatorLight => Border;
        // No highlighted box behind the icon of checked items; the switch shows the state.
        public override Color CheckBackground => Background;
        public override Color CheckSelectedBackground => Hover;
        public override Color CheckPressedBackground => Hover;
        public override Color ButtonSelectedBorder => Color.Transparent;
    }
}
