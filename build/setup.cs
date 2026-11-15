// Recto's setup window. Wraps the normal installer (embedded as payload.exe), runs it silently,
// and shows a small paper card while it works. Built by build/setup.js with Windows' own csc.exe.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Recto Setup")]
[assembly: AssemblyProduct("Recto")]

class Setup : Form
{
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, int w, int l);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);

    Color page, line, text, muted, ink;
    float scale;
    string title = "Setting up Recto…", note = "It'll open when it's done.";
    double shown, target;
    bool running = true, failed;
    long total;
    string appDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "recto");
    System.Windows.Forms.Timer tick = new System.Windows.Forms.Timer();
    int frames;

    Setup()
    {
        bool dark = false;
        try { object v = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1); dark = v is int && (int)v == 0; } catch { }
        // Recto's warm tone, light (Paper) and dark (Ink).
        page = dark ? Hex("151413") : Hex("f5f2eb");
        line = dark ? Hex("2b2925") : Hex("e2ddd2");
        text = dark ? Hex("ece7de") : Hex("1c1b19");
        muted = dark ? Hex("8f897e") : Hex("6f6a60");
        ink = dark ? Hex("e8876b") : Hex("b8452d");

        using (Graphics g = CreateGraphics()) scale = g.DpiX / 96f;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(S(420), S(260));
        BackColor = page;
        DoubleBuffered = true;
        Text = "Recto Setup";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        string size = Read("size.txt");
        long.TryParse(size == null ? "" : size.Trim(), out total);

        tick.Interval = 30;
        tick.Tick += delegate { Step(); };
        MouseDown += delegate { if (failed) Close(); else { ReleaseCapture(); SendMessage(Handle, 0xA1, 2, 0); } };
        FormClosing += (s, e) => { if (running) e.Cancel = true; };
        Shown += delegate { tick.Start(); new Thread(Install) { IsBackground = true }.Start(); };
    }

    protected override CreateParams CreateParams
    {
        get { CreateParams p = base.CreateParams; p.ClassStyle |= 0x20000; return p; } // drop shadow
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int round = 2; // Windows 11 rounded corners; older Windows ignores it
        try { DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch { }
    }

    void Install()
    {
        string tmp = Path.Combine(Path.GetTempPath(), "recto-setup-" + Guid.NewGuid().ToString("N") + ".exe");
        int code = -1;
        try
        {
            using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.exe"))
            using (FileStream dst = File.Create(tmp)) src.CopyTo(dst);
            using (Process p = Process.Start(new ProcessStartInfo(tmp, "/S") { UseShellExecute = false }))
            {
                p.WaitForExit();
                code = p.ExitCode;
            }
        }
        catch { }
        try { File.Delete(tmp); } catch { }
        BeginInvoke(new Action(() => Done(code == 0)));
    }

    void Done(bool ok)
    {
        if (!ok)
        {
            running = false; failed = true;
            title = "That didn't work.";
            note = "Try running the installer again. Click to close.";
            Invalidate();
            return;
        }
#if PREVIEW
        Snap("running.png");
#endif
        target = 1;
        title = "All done.";
        note = "Opening Recto…";
        System.Windows.Forms.Timer wait = new System.Windows.Forms.Timer { Interval = 700 };
        wait.Tick += delegate
        {
            wait.Stop();
            string exe = Path.Combine(appDir, "Recto.exe");
#if PREVIEW
            shown = 1; Snap("done.png");
#else
            try { if (File.Exists(exe)) Process.Start(exe); } catch { }
#endif
            running = false;
            Close();
        };
        wait.Start();
    }

    void Step()
    {
        // ponytail: progress = installed bytes / unpacked size, read every ~300 ms; on an update the old
        // files are removed first, so the bar waits until the new copy overtakes them.
        if (running && target < 1 && total > 0 && frames++ % 10 == 0)
            target = Math.Max(target, Math.Min(0.96, Folder(appDir) / (double)total));
        shown += (target - shown) * 0.12;
        Invalidate();
    }

    static long Folder(string dir)
    {
        long n = 0;
        try { foreach (FileInfo f in new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories)) n += f.Length; } catch { }
        return n;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        int w = ClientSize.Width, h = ClientSize.Height;
        using (Pen p = new Pen(line)) g.DrawRectangle(p, 0, 0, w - 1, h - 1);

        // The nib, from the same 100-unit path as the app.
        float n = S(52), nx = (w - n) / 2f, ny = S(34);
        GraphicsState st = g.Save();
        g.TranslateTransform(nx, ny);
        g.ScaleTransform(n / 100f, n / 100f);
        using (GraphicsPath nib = new GraphicsPath())
        using (Brush b = new SolidBrush(text))
        using (Brush cut = new SolidBrush(page))
        using (Pen slit = new Pen(page, 4))
        {
            nib.AddLine(50, 88, 35, 50);
            nib.AddBezier(35, 50, 33, 44, 33, 36, 36, 30);
            nib.AddLine(36, 30, 40, 14);
            nib.AddLine(40, 14, 60, 14);
            nib.AddLine(60, 14, 64, 30);
            nib.AddBezier(64, 30, 67, 36, 67, 44, 65, 50);
            nib.CloseFigure();
            g.FillPath(b, nib);
            g.DrawLine(slit, 50, 50, 50, 92);
            g.FillEllipse(cut, 45, 41, 10, 10);
        }
        g.Restore(st);

        StringFormat c = new StringFormat { Alignment = StringAlignment.Center };
        using (Font f = new Font("Georgia", 22f * scale, GraphicsUnit.Pixel))
        using (Brush b = new SolidBrush(text))
            g.DrawString(title, f, b, new RectangleF(0, S(96), w, S(34)), c);

        float bx = S(70), by = S(150), bw = w - 2 * bx, bh = Math.Max(2, S(3));
        if (!failed)
        {
            using (Brush b = new SolidBrush(line)) g.FillRectangle(b, bx, by, bw, bh);
            using (Brush b = new SolidBrush(ink)) g.FillRectangle(b, bx, by, (float)(bw * shown), bh);
        }

        using (Font f = new Font("Segoe UI", 13f * scale, GraphicsUnit.Pixel))
        using (Brush b = new SolidBrush(muted))
            g.DrawString(note, f, b, new RectangleF(0, S(170), w, S(24)), c);
    }

#if PREVIEW
    void Snap(string file)
    {
        using (Bitmap b = new Bitmap(ClientSize.Width, ClientSize.Height))
        {
            DrawToBitmap(b, new Rectangle(Point.Empty, ClientSize));
            b.Save(Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), file));
        }
    }
#endif

    int S(float v) { return (int)Math.Round(v * scale); }
    static Color Hex(string s) { return ColorTranslator.FromHtml("#" + s); }

    static string Read(string name)
    {
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            return s == null ? null : new StreamReader(s).ReadToEnd();
    }

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.Run(new Setup());
    }
}
