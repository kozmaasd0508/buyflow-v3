$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceUrl = 'https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/32052532feb1765b81a153d92d2612531accf222/scripts/run-mailgate-n8n-gmail-history-smoke-v5.ps1'
$tempInner = Join-Path $env:TEMP ("BuyFlow-MAILGATE-HISTORY-SMOKE-V8-INNER-" + [guid]::NewGuid().ToString('N') + '.ps1')

try {
    Invoke-WebRequest -UseBasicParsing -Uri $sourceUrl -OutFile $tempInner -TimeoutSec 30
    $text = [IO.File]::ReadAllText($tempInner)

    # PowerShell string interpolation fix for Gmail RAW URL.
    $text = $text.Replace('$escapedId?format=raw', '${escapedId}?format=raw')

    # Force list-valued results to remain arrays even for 0 or 1 item under StrictMode.
    $text = $text.Replace('$workflows = As-Array (Read-JsonFile $workflowPath)', '$workflows = @(As-Array (Read-JsonFile $workflowPath))')
    $text = $text.Replace('$nodes = As-Array (Get-PropertyValue $candidate @(''nodes''))', '$nodes = @(As-Array (Get-PropertyValue $candidate @(''nodes'')))')
    $text = $text.Replace('$workflowNodes = As-Array (Get-PropertyValue $workflow @(''nodes''))', '$workflowNodes = @(As-Array (Get-PropertyValue $workflow @(''nodes'')))')
    $text = $text.Replace('$messageRefs = As-Array (Get-PropertyValue $list @(''messages''))', '$messageRefs = @(As-Array (Get-PropertyValue $list @(''messages'')))')
    $text = $text.Replace('$historyRecords = As-Array (Get-PropertyValue $history @(''history''))', '$historyRecords = @(As-Array (Get-PropertyValue $history @(''history'')))')

    $text = $text.Replace('MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V5', 'MAILGATE_REAL_GMAIL_HISTORY_SMOKE_V8')
    $text = $text.Replace('SMOKE V5', 'SMOKE V8')
    [IO.File]::WriteAllText($tempInner, $text, (New-Object Text.UTF8Encoding($false)))

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tempInner
    exit $LASTEXITCODE
} catch {
    Write-Host ''
    Write-Host ('V8 wrapper hiba: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'A MailGate smoke nem futott vegig; semmi nincs elesitve.' -ForegroundColor Yellow
    exit 1
} finally {
    if (Test-Path -LiteralPath $tempInner) {
        Remove-Item -LiteralPath $tempInner -Force -ErrorAction SilentlyContinue
    }
}
