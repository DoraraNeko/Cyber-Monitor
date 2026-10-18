# tools/launcher.cs から assets/icon.ico 入りの「Cyber Monitor.exe」をビルドする（Windows 標準の .NET Framework の csc を使用）
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /codepage:65001 /optimize "/win32icon:$(Join-Path $root 'assets\icon.ico')" /r:System.Windows.Forms.dll "/out:$(Join-Path $root 'Cyber Monitor.exe')" (Join-Path $root 'tools\launcher.cs')
if ($LASTEXITCODE -eq 0) { "built: $(Join-Path $root 'Cyber Monitor.exe')" }
