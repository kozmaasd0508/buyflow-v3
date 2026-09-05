$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$nodeDir=Join-Path $env:USERPROFILE 'BuyFlowTools\node-v24.20.0-win-x64'
$n8nDir=Join-Path $env:USERPROFILE 'BuyFlowTools\n8n-2.37.3-node24'
$nodeExe=Join-Path $nodeDir 'node.exe'
$n8nBin=Join-Path $n8nDir 'node_modules\n8n\bin\n8n'
$workflowId='BFLemonadeJsonContract1'
$workflowCommit='e96effa18fcf6b1153edf797b421f453e17be7b3'
$credentialCommit='c977f272af32de18574f9399fb13c5fa298beb54'
$repoRaw='https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3'
$tmpDir=Join-Path $env:TEMP 'buyflow-lemonade-json-contract-12'
$workflowFile=Join-Path $tmpDir 'workflow.json'
$credFile=Join-Path $tmpDir 'credential.json'
$rawPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-LEMONADE-JSON-CONTRACT-RAW.txt'
$summaryPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-LEMONADE-JSON-CONTRACT-SUMMARY.json'
$stdoutLog=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-STDOUT.log'
$stderrLog=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-N8N-PORTABLE-STDERR.log'

function Test-Port5678 {
  try {
    $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5678/' -Method Get -TimeoutSec 3
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - N8N + LEMONADE JSON CONTRACT 12' -ForegroundColor Cyan
Write-Host 'Synthetic only. Strict parser autoFix=false.' -ForegroundColor Green
Write-Host 'No Gmail. No webhook. No BuyFlow writes. Production unchanged.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

if(-not (Test-Path -LiteralPath $nodeExe)){throw 'PORTABLE_NODE24_NOT_FOUND'}
if(-not (Test-Path -LiteralPath $n8nBin)){throw 'PORTABLE_N8N_NOT_FOUND'}

$oldPath=$env:PATH
$env:PATH=$nodeDir+';'+$env:PATH
$wasRunning=Test-Port5678

try {
  $nodeVersion=(& $nodeExe --version | Select-Object -First 1).ToString().Trim()
  $n8nVersion=(& $nodeExe $n8nBin --version 2>$null | Select-Object -First 1).ToString().Trim()
  Write-Host ('Portable Node: '+$nodeVersion) -ForegroundColor Green
  Write-Host ('n8n: '+$n8nVersion) -ForegroundColor Green
  if($nodeVersion -ne 'v24.20.0'){throw ('UNEXPECTED_NODE_VERSION:'+ $nodeVersion)}
  if($n8nVersion -ne '2.37.3'){throw ('UNEXPECTED_N8N_VERSION:'+ $n8nVersion)}

  $health=Invoke-RestMethod -Uri 'http://127.0.0.1:13305/v1/health' -Method Get -TimeoutSec 15
  if(-not $health){throw 'LEMONADE_HEALTH_FAILED'}
  Write-Host 'Lemonade API: READY' -ForegroundColor Green

  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri "$repoRaw/$credentialCommit/scripts/n8n/BuyFlow-LEMONADE-LOCAL-CREDENTIAL.json" -OutFile $credFile
  Invoke-WebRequest -UseBasicParsing -Uri "$repoRaw/$workflowCommit/scripts/n8n/BuyFlow-N8N-LEMONADE-JSON-CONTRACT-12.json" -OutFile $workflowFile

  $wf=Get-Content -LiteralPath $workflowFile -Raw | ConvertFrom-Json
  if([string]$wf.id -ne $workflowId){throw 'WORKFLOW_ID_MISMATCH'}
  $parser=@($wf.nodes | Where-Object {$_.name -eq 'Strict Structured Output Parser'}) | Select-Object -First 1
  if(-not $parser){throw 'STRICT_PARSER_NODE_MISSING'}
  if([bool]$parser.parameters.autoFix){throw 'AUTOFIX_MUST_BE_FALSE'}
  Write-Host 'Pinned JSON-contract workflow: READY (12 cases, autoFix=false)' -ForegroundColor Green

  if($wasRunning){
    $conn=Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if(-not $conn){throw 'N8N_PORT_OWNER_NOT_FOUND'}
    $pidToStop=[int]$conn.OwningProcess
    $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidToStop) -ErrorAction SilentlyContinue
    $cmdline=[string]$proc.CommandLine
    if($cmdline -notmatch '(?i)n8n'){throw ('PORT_5678_OWNER_NOT_N8N:'+ $cmdline)}
    Write-Host ('Temporarily stopping n8n PID '+$pidToStop+' for isolated CLI test...') -ForegroundColor Yellow
    Stop-Process -Id $pidToStop -Force
    Start-Sleep -Seconds 2
    if(Test-Port5678){throw 'N8N_DID_NOT_STOP'}
  }

  Write-Host 'Upserting isolated local Lemonade credential...' -ForegroundColor Yellow
  & $nodeExe $n8nBin import:credentials --input=$credFile
  if($LASTEXITCODE -ne 0){throw ('CREDENTIAL_IMPORT_FAILED:'+ $LASTEXITCODE)}

  Write-Host 'Importing JSON-contract workflow...' -ForegroundColor Yellow
  & $nodeExe $n8nBin import:workflow --input=$workflowFile
  if($LASTEXITCODE -ne 0){throw ('WORKFLOW_IMPORT_FAILED:'+ $LASTEXITCODE)}

  Write-Host 'Running 12 synthetic cases through n8n -> Lemonade -> Gemma...' -ForegroundColor Yellow
  $sw=[System.Diagnostics.Stopwatch]::StartNew()
  $raw=(& $nodeExe $n8nBin execute --id=$workflowId --rawOutput 2>&1 | Out-String)
  $execCode=$LASTEXITCODE
  $sw.Stop()
  Set-Content -LiteralPath $rawPath -Value $raw -Encoding UTF8
  if($execCode -ne 0){throw ('WORKFLOW_EXECUTE_FAILED:'+ $execCode+' RAW='+$raw)}

  $hasPass=$raw -match '"pass"\s*:\s*true'
  $hasTwelve=$raw -match '"passed"\s*:\s*12'
  $hasZero=$raw -match '"failed"\s*:\s*0'
  $hasNoWrites=$raw -match '"buyflow_writes"\s*:\s*0'
  $pass=$hasPass -and $hasTwelve -and $hasZero -and $hasNoWrites

  $summary=[ordered]@{
    completed_at=(Get-Date).ToString('o')
    pass=$pass
    total=12
    expected_passed=12
    strict_parser_auto_fix=$false
    workflow_id=$workflowId
    workflow_commit=$workflowCommit
    model='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
    n8n_version=$n8nVersion
    portable_node_version=$nodeVersion
    elapsed_ms=[math]::Round($sw.Elapsed.TotalMilliseconds,1)
    raw_output=$rawPath
    gmail_touched=$false
    webhook_created=$false
    buyflow_writes=0
    production_changed=$false
  }
  $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor $(if($pass){'Green'}else{'Red'})
  if($pass){
    Write-Host 'LEMONADE JSON CONTRACT 12: PASS (12/12)' -ForegroundColor Green
  } else {
    Write-Host 'LEMONADE JSON CONTRACT 12: NOT PASS' -ForegroundColor Red
    Write-Host 'The raw result is saved; do not proceed to REAL120 yet.' -ForegroundColor Yellow
  }
  Write-Host ('Elapsed: '+[math]::Round($sw.Elapsed.TotalSeconds,1)+' s') -ForegroundColor Cyan
  Write-Host ('Raw: '+$rawPath) -ForegroundColor DarkGray
  Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
  Write-Host 'Gmail untouched | webhook 0 | BuyFlow writes 0 | production unchanged' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor $(if($pass){'Green'}else{'Red'})

  if(-not $pass){exit 3}
}
finally {
  if($wasRunning -and -not (Test-Port5678)){
    Write-Host 'Restarting portable n8n localhost:5678...' -ForegroundColor Yellow
    Remove-Item -LiteralPath $stdoutLog,$stderrLog -Force -ErrorAction SilentlyContinue
    Start-Process -FilePath $nodeExe -ArgumentList @($n8nBin,'start') -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog | Out-Null
    $ready=$false
    for($i=0;$i -lt 45;$i++){
      Start-Sleep -Seconds 1
      if(Test-Port5678){$ready=$true;break}
    }
    Write-Host ('n8n restarted: '+$ready) -ForegroundColor $(if($ready){'Green'}else{'Yellow'})
  }
  $env:PATH=$oldPath
}
