using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace EdgePanel.Tray;

/// <summary>
/// Dark, rounded tray menu that matches the settings window (WinForms' default menu looks out of place).
/// Rows are owner-drawn at a fixed, measured width: WinForms' own layout at 125%/150% scaling sizes
/// rows narrower than the menu and clips anything drawn past them, which cut off right-aligned marks.
/// Icons come from the Segoe Fluent Icons / MDL2 font, so they follow the system look and scale cleanly.
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

    private const char CheckGlyph = '';

    private static readonly string IconFont = FontExists("Segoe Fluent Icons") ? "Segoe Fluent Icons" : "Segoe MDL2 Assets";
    private static readonly ConditionalWeakTable<ToolStripItem, RowInfo> Rows = new();

    private sealed class RowInfo
    {
        public char Glyph;
        public int Dpi;
        public Bitmap? Icon;
    }

    public TrayMenuRenderer() : base(new DarkColors()) => RoundedEdges = false;

    /// <summary>Applies the renderer, font, layout and Windows 11 rounded corners to a menu.</summary>
    public static void Style(ContextMenuStrip menu)
    {
        menu.Renderer = new TrayMenuRenderer();
        menu.BackColor = Background;
        menu.ForeColor = Text;
        menu.Font = new Font("Segoe UI", 10f);
        menu.ShowImageMargin = false; // icons are drawn by the renderer
        menu.ShowCheckMargin = false;
        menu.Padding = new Padding(4, 6, 4, 6);

        // Toggling an option keeps the menu open, so several can be changed in a row.
        var keepOpen = false;
        menu.ItemClicked += (_, e) => keepOpen = e.ClickedItem is ToolStripMenuItem { CheckOnClick: true };
        menu.Closing += (_, e) =>
        {
            if (e.CloseReason == ToolStripDropDownCloseReason.ItemClicked && keepOpen) e.Cancel = true;
            keepOpen = false;
        };

        menu.Opening += (_, _) =>
        {
            menu.AutoSize = true; // re-measure on every open (DPI or labels may have changed)
            RoundCorners(menu.Handle);
            Layout(menu);
        };
        // The dropdown ends up a bit wider than the rows (WinForms reserves extra room on the right);
        // stretch the rows to the real inner width so margins are even on both sides.
        menu.Opened += (_, _) =>
        {
            // WinForms lays rows (and separators) out ~30 px narrower than the window it opens,
            // leaving a gap on the right. Freeze the window size and stretch every row to it.
            menu.AutoSize = false;
            var inner = menu.ClientSize.Width - menu.Padding.Horizontal;
            menu.SuspendLayout();
            foreach (ToolStripItem item in menu.Items)
            {
                item.AutoSize = false;
                item.Width = inner;
            }
            menu.ResumeLayout(true);
            menu.Invalidate();
        };
    }

    /// <summary>Menu row with an icon. Checkable rows show a round check mark on the right.</summary>
    public static ToolStripMenuItem Item(string text, char glyph, EventHandler? onClick = null, bool checkable = false)
    {
        var item = new ToolStripMenuItem(text, null, onClick) { CheckOnClick = checkable };
        Rows.Add(item, new RowInfo { Glyph = glyph });
        return item;
    }

    private static int S(ToolStrip strip, int px) => (int)Math.Round(px * strip.DeviceDpi / 96.0);
    private static int S(ToolStripItem item, int px) => (int)Math.Round(px * (item.Owner?.DeviceDpi ?? 96) / 96.0);

    private static int IconSize(ToolStripItem item) => S(item, 20);
    private static int LeftPad(ToolStripItem item) => S(item, 14);
    private static int TextX(ToolStripItem item) => LeftPad(item) + IconSize(item) + S(item, 14);
    private static int CheckSize(ToolStripItem item) => S(item, 18);
    private static int RightPad(ToolStripItem item) => S(item, 14);

    /// <summary>Gives every row the same measured width and height, and (re)renders icons at the menu's DPI.</summary>
    private static void Layout(ContextMenuStrip menu)
    {
        var dpi = menu.DeviceDpi;
        var text = 0;
        foreach (ToolStripItem item in menu.Items)
            if (item is ToolStripMenuItem or ToolStripLabel)
                text = Math.Max(text, TextRenderer.MeasureText(item.Text, item.Font).Width);

        var width = S(menu, 14) + S(menu, 20) + S(menu, 14) + text + S(menu, 24) + S(menu, 18) + S(menu, 14);
        foreach (ToolStripItem item in menu.Items)
        {
            if (item is ToolStripSeparator) continue;
            item.AutoSize = false;
            item.Size = new Size(width, item is ToolStripLabel ? S(menu, 30) : S(menu, 36));

            if (Rows.TryGetValue(item, out var row) && row.Dpi != dpi)
            {
                row.Icon?.Dispose();
                row.Icon = Glyph(row.Glyph, Text, S(menu, 20));
                row.Dpi = dpi;
            }
        }
    }

    /// <summary>Renders a glyph from the system icon font.</summary>
    public static Bitmap Glyph(char glyph, Color color, int size)
    {
        var bmp = new Bitmap(size, size);
        using var g = Graphics.FromImage(bmp);
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        using var font = new Font(IconFont, size * 0.8f, GraphicsUnit.Pixel);
        using var brush = new SolidBrush(color);
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
    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e) { }
    protected override void OnRenderItemImage(ToolStripItemImageRenderEventArgs e) { }

    /// <summary>Whole row: hover, icon, label and check mark, all inside the row's own bounds.</summary>
    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
    {
        if (e.Item is not ToolStripMenuItem item) return;
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

        if (item.Selected && item.Enabled)
        {
            using var path = RoundedRect(new Rectangle(S(item, 4), 1, item.Width - S(item, 8), item.Height - 2), S(item, 6));
            using var brush = new SolidBrush(Hover);
            g.FillPath(brush, path);
        }

        if (Rows.TryGetValue(item, out var row) && row.Icon is { } icon)
            g.DrawImage(icon, LeftPad(item), (item.Height - icon.Height) / 2, icon.Width, icon.Height);

        var danger = item.Tag as string == "danger" && item.Selected;
        var textRect = new Rectangle(TextX(item), 0, item.Width - TextX(item) - CheckSize(item) - RightPad(item), item.Height);
        TextRenderer.DrawText(g, item.Text, item.Font, textRect, !item.Enabled ? Muted : danger ? Danger : Text,
            TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);

        if (item.CheckOnClick) DrawCheck(g, item);
    }

    // Menu rows draw their own text (above); labels such as the header use the default path.
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        if (e.Item is ToolStripMenuItem) return;
        e.TextColor = Muted;
        e.TextFormat = TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter;
        e.TextRectangle = new Rectangle(0, 0, e.Item.Width, e.Item.Height);
        base.OnRenderItemText(e);
    }

    /// <summary>Round check: filled accent with a check when on, a thin ring when off.</summary>
    private static void DrawCheck(Graphics g, ToolStripMenuItem item)
    {
        var d = CheckSize(item);
        var rect = new Rectangle(item.Width - RightPad(item) - d, (item.Height - d) / 2, d, d);
        if (item.Checked)
        {
            using var fill = new SolidBrush(Accent);
            g.FillEllipse(fill, rect);
            using var check = Glyph(CheckGlyph, Background, d);
            g.DrawImage(check, rect.X, rect.Y, d, d);
        }
        else
        {
            using var ring = new Pen(Border, Math.Max(1.5f, S(item, 2)));
            g.DrawEllipse(ring, rect.X + 1, rect.Y + 1, d - 2, d - 2);
        }
    }

    protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
    {
        var y = e.Item.Height / 2;
        var inset = S(e.Item, 12);
        using var pen = new Pen(Border);
        e.Graphics.DrawLine(pen, inset, y, e.Item.Width - inset, y);
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
        public override Color CheckBackground => Background;
        public override Color CheckSelectedBackground => Hover;
        public override Color CheckPressedBackground => Hover;
        public override Color ButtonSelectedBorder => Color.Transparent;
    }
}
