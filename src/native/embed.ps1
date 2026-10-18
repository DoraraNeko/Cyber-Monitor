# Electron のウィンドウをデスクトップアイコンの背後（壁紙レイヤー）に埋め込む。
# 使い方: embed.ps1 -Hwnd <HWND> -X <px> -Y <px> -W <px> -H <px>   （座標は物理ピクセルのスクリーン座標）
param(
  [Parameter(Mandatory = $true)][Int64]$Hwnd,
  [int]$X = 0, [int]$Y = 0, [int]$W = 1920, [int]$H = 1080
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class WallpaperHost {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr FindWindow(string cls, string name);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int idx, IntPtr v);
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr ctx);

  const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
  const long WS_CHILD = 0x40000000L, WS_POPUP = 0x80000000L, WS_CAPTION = 0x00C00000L, WS_THICKFRAME = 0x00040000L;
  const long WS_EX_LAYERED = 0x00080000L, WS_EX_TOOLWINDOW = 0x00000080L, WS_EX_APPWINDOW = 0x00040000L;
  const uint SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040, SWP_NOMOVE = 0x0002, SWP_NOSIZE = 0x0001, SWP_FRAMECHANGED = 0x0020;
  const uint LWA_ALPHA = 0x2;

  public static string Attach(IntPtr hwnd, int x, int y, int w, int h) {
    // 物理ピクセル座標で扱うため Per-Monitor V2 にする
    SetProcessDpiAwarenessContext(new IntPtr(-4));

    IntPtr progman = FindWindow("Progman", null);
    if (progman == IntPtr.Zero) return "ERR: Progman not found";

    // Progman に WorkerW を生成させる（Lively / Wallpaper Engine と同じ非公開メッセージ）
    IntPtr res;
    SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out res);
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);

    // スタイルを子ウィンドウ化し、タスクバー/Alt+Tab から外す
    long style = GetWindowLongPtr(hwnd, GWL_STYLE).ToInt64();
    style = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME)) | WS_CHILD;
    SetWindowLongPtr(hwnd, GWL_STYLE, new IntPtr(style));
    long ex = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
    ex = (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW;

    IntPtr shellView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    IntPtr childWorker = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);

    string mode;
    IntPtr parent;
    if (shellView != IntPtr.Zero && childWorker != IntPtr.Zero) {
      // Windows 11 24H2 以降: Progman の子として SHELLDLL_DefView と WorkerW の間に差し込む
      mode = "24H2";
      parent = progman;
      ex |= WS_EX_LAYERED;
      SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(ex));
      SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
      SetParent(hwnd, progman);
      SetWindowPos(hwnd, shellView, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      // WorkerW（標準の壁紙）は常に最背面へ。複数モニター分のウィンドウを埋め込んでも互いを覆わないように
      SetWindowPos(childWorker, new IntPtr(1) /*HWND_BOTTOM*/, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    } else {
      // 従来: SHELLDLL_DefView を持つ WorkerW の「次の」WorkerW に入れる
      mode = "legacy";
      IntPtr worker = IntPtr.Zero;
      EnumWindows((top, l) => {
        IntPtr sv = FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (sv != IntPtr.Zero) worker = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
        return true;
      }, IntPtr.Zero);
      if (worker == IntPtr.Zero) { worker = progman; mode = "legacy-progman"; }
      parent = worker;
      SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(ex));
      SetParent(hwnd, worker);
    }

    // スクリーン座標 → 親のクライアント座標
    POINT p = new POINT { X = x, Y = y };
    ScreenToClient(parent, ref p);
    SetWindowPos(hwnd, IntPtr.Zero, p.X, p.Y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED | (mode == "24H2" ? 0x0004u /*NOZORDER*/ : 0u));
    ShowWindow(hwnd, 4 /*SW_SHOWNOACTIVATE*/);
    return "OK " + mode + " parent=0x" + parent.ToInt64().ToString("X") + " at " + p.X + "," + p.Y;
  }
}
"@

[WallpaperHost]::Attach([IntPtr]$Hwnd, $X, $Y, $W, $H)
