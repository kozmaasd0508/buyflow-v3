$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceUrl = 'https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/32052532feb1765b81a153d92d2612531accf222/scripts/run-mailgate-n8n-gmail-history-smoke-v5.ps1'
$tempInner = Join-Path $env:TEMP ("BuyFlow-MAILGATE-HISTORY-SMOKE-V7-INNER-" + [guid]::NewGuid().ToString('N') + '.ps1')

try {
    Invoke-WebRequest -UseBasicParsing -Uri $sourceUrl -OutFile $tempInner -TimeoutSec 30
    $text = [IO.File]::ReadAllText($tempInner)
    $text = $text.Replace('$escapedId?format=raw', '${escapedId}?format=raw')
    $text = $text.Replace('MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V5', 'MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V7')
    $text = $text.Replace('SMOKE V5', 'SMOKE V7')
    [IO.File]::WriteAllText($tempInner, $text, (New-Object Text.UTF8Encoding($false)))

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tempInner
    exit $LASTEXITCODE
} catch {
    Write-Host ''
    Write-Host ('V7 wrapper hiba: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'A MailGate smoke nem futott vegig; semmi nincs elesitve.' -ForegroundColor Yellow
    exit 1
} finally {
    if (Test-Path -LiteralPath $tempInner) {
        Remove-Item -LiteralPath $tempInner -Force -ErrorAction SilentlyContinue
    }
}
