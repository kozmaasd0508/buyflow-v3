$ErrorActionPreference = 'SilentlyContinue'

$dataRoot = Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$pidFile = Join-Path $dataRoot 'n8n.pid'

Write-Host 'BuyFlow n8n leallitasa...'

$stopped = $false
if (Test-Path $pidFile) {
    $raw = (Get-Content $pidFile -Raw).Trim()
    $pidValue = 0
    if ([int]::TryParse($raw, [ref]$pidValue) -and $pidValue -gt 0) {
        & taskkill.exe /PID $pidValue /T /F | Out-Null
        $stopped = $true
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

try {
    $listeners = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction Stop
    foreach ($listener in $listeners) {
        if ($listener.OwningProcess -gt 0) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
            $stopped = $true
        }
    }
} catch {}

$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if ($ollama) { & ollama.exe stop qwen3:8b | Out-Null }

if ($stopped) {
    Write-Host 'KESZ. n8n leallt. A helyi SQLite adatok megmaradtak.' -ForegroundColor Green
} else {
    Write-Host 'n8n nem futott. A helyi adatok valtozatlanok.'
}
Write-Host 'Az Ollama qwen3:8b modell ki lett rakva a memoriabol.'
Start-Sleep -Seconds 2
