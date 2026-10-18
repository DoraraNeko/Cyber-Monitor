# start.cmd へのショートカットに assets/icon.ico を設定する（.cmd ファイル自体にはアイコンを設定できないため）。
# このフォルダにある start.cmd 宛てのショートカットをすべて更新し、1 つも無ければ「Cyber Monitor.lnk」を作る。
# 使い方: npm run shortcut   （フォルダを移動したら作り直す）
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$target = Join-Path $root 'start.cmd'
$icon = (Join-Path $root 'assets\icon.ico') + ',0'
$shell = New-Object -ComObject WScript.Shell

$links = @(Get-ChildItem -LiteralPath $root -Filter '*.lnk' | Where-Object { $shell.CreateShortcut($_.FullName).TargetPath -eq $target } | ForEach-Object { $_.FullName })
if ($links.Count -eq 0) { $links = @(Join-Path $root 'Cyber Monitor.lnk') }

foreach ($lnk in $links) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $target
  $s.WorkingDirectory = $root
  $s.IconLocation = $icon
  $s.WindowStyle = 7 # 最小化で起動（コマンドプロンプトの画面を出さない）
  $s.Description = 'Cyber Monitor (Performance Monitor + Cyber Board)'
  $s.Save()
  "updated: $lnk"
}
