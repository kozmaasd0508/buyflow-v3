$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$desktop=[Environment]::GetFolderPath('Desktop')
$rawPath=Join-Path $desktop 'BuyFlow-N8N-LEMONADE-JSON-CONTRACT-RAW.txt'
$summaryPath=Join-Path $desktop 'BuyFlow-N8N-LEMONADE-JSON-CONTRACT-SUMMARY.json'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - LEMONADE JSON CONTRACT DIAGNOSTIC' -ForegroundColor Cyan
Write-Host 'Read-only. No AI calls. No n8n changes. No BuyFlow writes.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

if(-not (Test-Path -LiteralPath $rawPath)){throw 'RAW_FILE_NOT_FOUND'}
if(-not (Test-Path -LiteralPath $summaryPath)){throw 'SUMMARY_FILE_NOT_FOUND'}

$summary=Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
Write-Host ('Runner pass: '+$summary.pass)
Write-Host ('Elapsed ms: '+$summary.elapsed_ms)

$raw=Get-Content -LiteralPath $rawPath -Raw
try {
  $j=$raw | ConvertFrom-Json -Depth 100
} catch {
  Write-Host 'RAW_JSON_PARSE_FAILED' -ForegroundColor Red
  Write-Host '--- RAW tail ---' -ForegroundColor Yellow
  Get-Content -LiteralPath $rawPath -Tail 120
  exit 2
}

$contract=$null
try {
  $contract=$j.data.resultData.runData.'Validate Contract'[0].data.main[0][0].json
} catch {}

if(-not $contract){
  Write-Host 'CONTRACT_RESULT_NOT_FOUND_AT_EXPECTED_PATH' -ForegroundColor Red
  Write-Host '--- Top-level keys ---' -ForegroundColor Yellow
  $j.PSObject.Properties.Name | ForEach-Object { Write-Host ('  '+$_) }
  Write-Host '--- RAW tail ---' -ForegroundColor Yellow
  Get-Content -LiteralPath $rawPath -Tail 120
  exit 3
}

Write-Host ''
Write-Host ('Contract pass: '+$contract.pass) -ForegroundColor $(if($contract.pass){'Green'}else{'Red'})
Write-Host ('Passed: '+$contract.passed+' / '+$contract.total)
Write-Host ('Failed: '+$contract.failed)
Write-Host ''
Write-Host 'CASES:' -ForegroundColor Cyan
foreach($r in $contract.results){
  $mark=if($r.pass){'PASS'}else{'FAIL'}
  $err=if($r.errors -and $r.errors.Count -gt 0){[string]::Join(' | ',@($r.errors))}else{''}
  Write-Host (('{0,-4} {1,-4} event={2,-20} action={3,-8} {4}' -f $r.case_id,$mark,$r.event_type,$r.action,$err)) -ForegroundColor $(if($r.pass){'Green'}else{'Red'})
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'DIAGNOSTIC COMPLETE - READ ONLY' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
