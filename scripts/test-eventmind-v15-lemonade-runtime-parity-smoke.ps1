$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$nodeExe=Join-Path $env:USERPROFILE 'BuyFlowTools\node-v24.20.0-win-x64\node.exe'
$runtimeCommit='de5d126d914f1ee38bd347612b15320452ada9be'
$runtimeUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runtimeCommit/scripts/eventmind-lemonade-gemma3-12b-gated-v15-runtime.mjs"
$runtimeFile=Join-Path $env:TEMP 'buyflow-eventmind-v15-lemonade-runtime.mjs'
$stdout=Join-Path $env:TEMP 'buyflow-eventmind-v15-lemonade-runtime.out.log'
$stderr=Join-Path $env:TEMP 'buyflow-eventmind-v15-lemonade-runtime.err.log'
$summary=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-EVENTMIND-V15-LEMONADE-PARITY-SMOKE.json'
$base='http://127.0.0.1:4398'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - EVENTMIND V15 LEMONADE PARITY SMOKE' -ForegroundColor Cyan
Write-Host 'V15 gate/event overlays + strict JSON Schema through Lemonade.' -ForegroundColor Green
Write-Host 'Synthetic only. No Gmail. No BuyFlow writes. Production unchanged.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

if(-not (Test-Path -LiteralPath $nodeExe)){throw 'PORTABLE_NODE24_NOT_FOUND'}
$nv=(& $nodeExe --version | Select-Object -First 1).ToString().Trim()
Write-Host ('Portable Node: '+$nv) -ForegroundColor Green
if($nv -ne 'v24.20.0'){throw ('UNEXPECTED_NODE_VERSION:'+ $nv)}

$lh=Invoke-RestMethod -Uri 'http://127.0.0.1:13305/v1/health' -Method Get -TimeoutSec 15
if(-not $lh){throw 'LEMONADE_HEALTH_FAILED'}
Write-Host 'Lemonade API: READY' -ForegroundColor Green

Invoke-WebRequest -UseBasicParsing -Uri $runtimeUrl -OutFile $runtimeFile -TimeoutSec 30
Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue

$existing=Get-NetTCPConnection -LocalPort 4398 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if($existing){
  $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$existing.OwningProcess) -ErrorAction SilentlyContinue
  if(([string]$proc.CommandLine) -notmatch 'eventmind.*lemonade'){throw 'PORT_4398_IN_USE_BY_OTHER_PROCESS'}
  Stop-Process -Id ([int]$existing.OwningProcess) -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700
}

$proc=Start-Process -FilePath $nodeExe -ArgumentList @($runtimeFile) -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
try {
  $health=$null
  for($i=0;$i -lt 120;$i++){
    Start-Sleep -Milliseconds 500
    try{$health=Invoke-RestMethod -Uri "$base/health" -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($proc.HasExited){break}
  }
  if(-not $health -or -not $health.ok){
    if(Test-Path $stderr){Get-Content -LiteralPath $stderr -Tail 40}
    throw 'V15_LEMONADE_RUNTIME_START_FAILED'
  }
  if([string]$health.model_id -ne 'gemma3:12b'){throw 'COMPAT_MODEL_ID_MISMATCH'}
  if([string]$health.backend_model_id -ne 'user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'){throw 'BACKEND_MODEL_ID_MISMATCH'}
  if([string]$health.structured_output -ne 'json_schema'){throw 'STRUCTURED_OUTPUT_MISMATCH'}
  if([int]$health.context_tokens -ne 8192){throw 'CONTEXT_MISMATCH'}
  Write-Host 'V15 Lemonade compatibility runtime: READY' -ForegroundColor Green

  function Call([string]$path,[string]$prompt){
    $body=@{prompt=$prompt}|ConvertTo-Json -Compress
    $r=Invoke-RestMethod -Uri ($base+$path) -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 120
    if(-not $r.ok){throw ('RUNTIME_CALL_FAILED:'+ $path)}
    return ($r.output | ConvertFrom-Json)
  }

  $tests=@()

  $g1=Call '/v1/buyer-gate' 'Choose the current main event direction. The mailbox owner received only a weekend sale newsletter. No order, payment, invoice, shipment, return, refund or warranty event is present. Return only reason_code.'
  $tests += [ordered]@{name='pure_marketing_gate';expected='MARKETING_SURVEY';actual=[string]$g1.reason_code;pass=([string]$g1.reason_code -eq 'MARKETING_SURVEY')}

  $g2=Call '/v1/buyer-gate' 'Choose the current main event direction. The mailbox owner is the buyer. Their parcel is physically waiting FOR them at a parcel locker and can now be collected. Return only reason_code.'
  $tests += [ordered]@{name='buyer_pickup_gate';expected='BUYER_PURCHASE';actual=[string]$g2.reason_code;pass=([string]$g2.reason_code -eq 'BUYER_PURCHASE')}

  $g3=Call '/v1/buyer-gate' 'Choose the current main event direction. A courier confirms it will collect an outgoing parcel FROM the mailbox owner warehouse tomorrow; the mailbox owner is the sender. Return only reason_code.'
  $tests += [ordered]@{name='merchant_outbound_gate';expected='MERCHANT_OUTBOUND';actual=[string]$g3.reason_code;pass=([string]$g3.reason_code -eq 'MERCHANT_OUTBOUND')}

  $e1=Call '/v1/eventmind' 'The buyer-scope gate already determined buyer-side. A shipping label and tracking number were created, but the parcel has NOT been handed to the courier. Choose the single CURRENT event_type and return only event_type.'
  $tests += [ordered]@{name='label_not_handoff_event';expected='SHIPMENT_CREATED';actual=[string]$e1.event_type;pass=([string]$e1.event_type -eq 'SHIPMENT_CREATED')}

  $e2=Call '/v1/eventmind' 'The buyer-scope gate already determined buyer-side. The parcel was delivered to the recipient. The email then asks the buyer to rate the delivery. Choose the single CURRENT event_type and return only event_type.'
  $tests += [ordered]@{name='delivered_plus_survey_event';expected='DELIVERED';actual=[string]$e2.event_type;pass=([string]$e2.event_type -eq 'DELIVERED')}

  $passed=@($tests|Where-Object{$_.pass}).Count
  $ok=$passed -eq $tests.Count
  foreach($t in $tests){
    Write-Host (($t.name)+': '+$(if($t.pass){'PASS'}else{'FAIL'})+' expected='+$t.expected+' actual='+$t.actual) -ForegroundColor $(if($t.pass){'Green'}else{'Red'})
  }

  $result=[ordered]@{
    checked_at=(Get-Date).ToString('o')
    pass=$ok
    passed=$passed
    total=$tests.Count
    runtime_commit=$runtimeCommit
    runtime_url=$base
    exposed_model_id=[string]$health.model_id
    backend='lemonade'
    backend_model_id=[string]$health.backend_model_id
    model_digest=[string]$health.model_digest
    model_digest_kind=[string]$health.model_digest_kind
    context_tokens=[int]$health.context_tokens
    structured_output=[string]$health.structured_output
    experiment_version=[string]$health.experiment_version
    tests=$tests
    gmail_touched=$false
    buyflow_writes=0
    production_changed=$false
  }
  $result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summary -Encoding UTF8

  Write-Host ''
  if($ok){
    Write-Host 'EVENTMIND V15 LEMONADE PARITY SMOKE: PASS (5/5)' -ForegroundColor Green
  } else {
    Write-Host ('EVENTMIND V15 LEMONADE PARITY SMOKE: NOT PASS ('+$passed+'/'+$tests.Count+')') -ForegroundColor Red
  }
  Write-Host ('Summary: '+$summary) -ForegroundColor DarkGray
  Write-Host 'No Gmail | BuyFlow writes 0 | production unchanged' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan
  if(-not $ok){exit 3}
}
finally {
  try{if($proc -and -not $proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}}catch{}
}
