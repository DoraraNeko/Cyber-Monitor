// start.cmd と同じ起動をする「Cyber Monitor.exe」（アイコン埋め込み用。.cmd にはアイコンを付けられないため）
// ビルド: npm run launcher   （tools/build-launcher.ps1）
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher {
  [STAThread]
  static void Main() {
    string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    string electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");
    if (!File.Exists(electron)) {
      string nl = Environment.NewLine;
      MessageBox.Show("Electron が見つかりません。" + nl + "このフォルダで npm install を実行してください。" + nl + nl + electron,
        "Cyber Monitor", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return;
    }
    var psi = new ProcessStartInfo(electron, "\"" + root + "\"") { WorkingDirectory = root, UseShellExecute = false };
    Process.Start(psi);
  }
}
