# Windows パフォーマンスカウンタ（WMI。ロケールに依存しないクラス名）を 1 秒ごとに JSON 1 行で出力する。
param([int]$IntervalMs = 1000, [switch]$Gpu)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$i = 0
$page = $null
while ($true) {
  $o = @{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

  $d = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
  if ($d) {
    $o.diskRead  = [double]$d.DiskReadBytesPersec
    $o.diskWrite = [double]$d.DiskWriteBytesPersec
    $o.diskBusy  = [math]::Max(0, 100 - [double]$d.PercentIdleTime)
    $o.diskQueue = [double]$d.CurrentDiskQueueLength
  }

  # 実効クロック（定格に対する %）
  $pi = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'"
  if ($pi) { $o.cpuPerf = [double]$pi.PercentProcessorPerformance }

  # 物理NIC ごとの送受信（最も通信量の多いもの + 合計）
  $nics = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface
  if ($nics) {
    $o.netRx = [double](($nics | Measure-Object BytesReceivedPersec -Sum).Sum)
    $o.netTx = [double](($nics | Measure-Object BytesSentPersec -Sum).Sum)
  }

  # ページファイルは変化が遅いので 10 秒ごと
  if ($i % 10 -eq 0) {
    $page = Get-CimInstance Win32_PageFileUsage | Measure-Object CurrentUsage, AllocatedBaseSize -Sum
  }
  if ($page) {
    $o.pageUsedMB  = [double]$page[0].Sum
    $o.pageTotalMB = [double]$page[1].Sum
  }

  if ($Gpu) {
    $e = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
      Where-Object { $_.Name -like '*engtype_3D' }
    if ($e) { $o.gpuUtil = [math]::Min(100, ($e | Measure-Object UtilizationPercentage -Sum).Sum) }
  }

  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  $i++
  Start-Sleep -Milliseconds $IntervalMs
}
