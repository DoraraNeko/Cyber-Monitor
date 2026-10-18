# 修飾キーを押しながらデスクトップ（壁紙）をクリックしたら、その座標を stdout に出す常駐スクリプト。
# 使い方: clickhook.ps1 -Keys 12        （仮想キーコードを 16 進でカンマ区切り。例: Ctrl+Alt = "11,12"）
# 出力:   "ready" / "click <x> <y>"（物理ピクセルのスクリーン座標）
# 入力:   "fg <HWND>" でそのウィンドウを前面に出す（バックグラウンドからのフォーカス奪取制限の回避）
#         "rects x,y,w,h;x,y,w,h" でクリックを拾う範囲（Cyber Board を表示しているモニター）を指定する。未指定ならデスクトップ全体
param([string]$Keys = '12')

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class ClickHook {
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);

  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr w; public IntPtr l; public uint time; public POINT pt; }

  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr ctx);

  const int WH_MOUSE_LL = 14, WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202;
  const uint GA_ROOT = 2;

  static HookProc proc; // GC されないよう保持
  static IntPtr hook;
  static int[] keys;
  static bool swallowUp;
  static int[][] rects; // null = 全体

  static string ClassOf(IntPtr h) {
    var sb = new StringBuilder(64);
    GetClassName(h, sb, sb.Capacity);
    return sb.ToString();
  }

  // クリック位置のウィンドウの最上位が Progman / WorkerW ならデスクトップ（アイコン層・壁紙層）
  static bool IsDesktop(POINT p) {
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) return false;
    string cls = ClassOf(GetAncestor(h, GA_ROOT));
    return cls == "Progman" || cls == "WorkerW";
  }

  static bool InRects(POINT p) {
    var r = rects;
    if (r == null) return true;
    foreach (var a in r) if (p.X >= a[0] && p.X < a[0] + a[2] && p.Y >= a[1] && p.Y < a[1] + a[3]) return true;
    return false;
  }

  static void SetRects(string spec) {
    var list = new System.Collections.Generic.List<int[]>();
    foreach (var part in spec.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries)) {
      var v = part.Split(',');
      if (v.Length != 4) continue;
      int x, y, w, h;
      if (int.TryParse(v[0], out x) && int.TryParse(v[1], out y) && int.TryParse(v[2], out w) && int.TryParse(v[3], out h)) list.Add(new[] { x, y, w, h });
    }
    rects = list.ToArray();
  }

  static bool KeysDown() {
    if (keys.Length == 0) return false;
    foreach (int k in keys) if ((GetAsyncKeyState(k) & 0x8000) == 0) return false;
    return true;
  }

  static IntPtr OnMouse(int code, IntPtr w, IntPtr l) {
    if (code >= 0) {
      int msg = w.ToInt32();
      if (msg == WM_LBUTTONDOWN) {
        var m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(l, typeof(MSLLHOOKSTRUCT));
        if (KeysDown() && InRects(m.pt) && IsDesktop(m.pt)) {
          swallowUp = true;
          Console.Out.WriteLine("click " + m.pt.X + " " + m.pt.Y);
          Console.Out.Flush();
          return new IntPtr(1); // デスクトップには渡さない（アイコン選択などを起こさない）
        }
      } else if (msg == WM_LBUTTONUP && swallowUp) {
        swallowUp = false;
        return new IntPtr(1);
      }
    }
    return CallNextHookEx(hook, code, w, l);
  }

  static void Foreground(IntPtr h) {
    if (GetForegroundWindow() == h) return;
    // Alt キーを 1 回送るとフォアグラウンドロックが外れる（よく知られた回避策）
    keybd_event(0x12, 0, 0x1, UIntPtr.Zero);
    keybd_event(0x12, 0, 0x1 | 0x2, UIntPtr.Zero);
    SetForegroundWindow(h);
  }

  public static void Run(int[] k) {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    keys = k;
    proc = OnMouse;
    hook = SetWindowsHookEx(WH_MOUSE_LL, proc, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) {
      Console.Out.WriteLine("ERR SetWindowsHookEx " + Marshal.GetLastWin32Error());
      return;
    }

    // 親（Electron）からのコマンド。stdin が閉じたら親が終了したので一緒に終わる
    var reader = new Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        long v;
        if (line.StartsWith("fg ") && long.TryParse(line.Substring(3), out v)) Foreground(new IntPtr(v));
        else if (line.StartsWith("rects")) SetRects(line.Substring(5).Trim());
      }
      Environment.Exit(0);
    });
    reader.IsBackground = true;
    reader.Start();

    Console.Out.WriteLine("ready");
    Console.Out.Flush();
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
  }
}
"@

$vk = @($Keys -split ',' | Where-Object { $_.Trim() } | ForEach-Object { [Convert]::ToInt32($_.Trim(), 16) })
[ClickHook]::Run([int[]]$vk)
