$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$rawPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-LEMONADE-JSON-CONTRACT-RAW.txt'
$summaryPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-LEMONADE-JSON-CONTRACT-SUMMARY.json'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - LEMONADE JSON CONTRACT DIAGNOSTIC V2' -ForegroundColor Cyan
Write-Host 'Read-only. No AI calls. No n8n changes. No BuyFlow writes.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

if(-not (Test-Path -LiteralPath $rawPath)){throw ('RAW_NOT_FOUND:'+ $rawPath)}
if(Test-Path -LiteralPath $summaryPath){
  try {
    $s=Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
    Write-Host ('Runner pass: '+$s.pass)
    Write-Host ('Elapsed ms: '+$s.elapsed_ms)
  } catch {}
}

$raw=Get-Content -LiteralPath $rawPath -Raw

# n8n CLI can prepend non-JSON log lines before --rawOutput JSON. Try every line starting with { until parsing succeeds.
$starts=[System.Collections.Generic.List[int]]::new()
for($i=0;$i -lt $raw.Length;$i++){
  if($raw[$i] -eq '{'){$starts.Add($i)}
}

$doc=$null
$usedStart=-1
foreach($idx in $starts){
  try {
    $candidate=$raw.Substring($idx).Trim()
    $parsed=$candidate | ConvertFrom-Json -Depth 100
    if($parsed){$doc=$parsed;$usedStart=$idx;break}
  } catch {}
}
if(-not $doc){throw 'RAW_JSON_OBJECT_NOT_FOUND'}
Write-Host ('RAW JSON parsed from offset: '+$usedStart) -ForegroundColor Green

$status=$null
try{$status=[string]$doc.status}catch{}
$finished=$null
try{$finished=[bool]$doc.finished}catch{}
Write-Host ('Execution status: '+$status+' | finished: '+$finished)

$runData=$null
try{$runData=$doc.data.resultData.runData}catch{}
if(-not $runData){throw 'RUN_DATA_NOT_FOUND'}

$validator=$runData.'Validate Contract'
if(-not $validator){throw 'VALIDATE_CONTRACT_RUN_NOT_FOUND'}
$lastRun=@($validator)[-1]
$outItems=$lastRun.data.main[0]
if(-not $outItems -or @($outItems).Count -lt 1){throw 'VALIDATE_CONTRACT_OUTPUT_NOT_FOUND'}
$result=$outItems[0].json
if(-not $result){throw 'VALIDATE_CONTRACT_JSON_NOT_FOUND'}

Write-Host ''
Write-Host ('Contract pass: '+$result.pass) -ForegroundColor $(if($result.pass){'Green'}else{'Red'})
Write-Host ('Passed: '+$result.passed+' / '+$result.total)
Write-Host ('Failed: '+$result.failed)
Write-Host ('Strict parser autoFix: '+$result.strict_parser_auto_fix)
Write-Host ''

foreach($r in @($result.results)){
  $err=''
  if($r.errors -and @($r.errors).Count -gt 0){$err=' | '+(@($r.errors) -join '; ')}
  $line=('{0} {1} event={2} action={3}{4}' -f $r.case_id,$(if($r.pass){'PASS'}else{'FAIL'}),$r.event_type,$r.action,$err)
  Write-Host $line -ForegroundColor $(if($r.pass){'Green'}else{'Red'})
}

Write-Host ''
if([bool]$result.pass -and [int]$result.passed -eq 12 -and [int]$result.failed -eq 0){
  Write-Host 'DIAGNOSTIC RESULT: TRUE PASS 12/12' -ForegroundColor Green
}else{
  Write-Host 'DIAGNOSTIC RESULT: REAL CONTRACT FAILURES PRESENT' -ForegroundColor Red
}
Write-Host 'No AI calls | no n8n changes | no BuyFlow writes' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan
