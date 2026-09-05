param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$codeCommit='fcc9f4e595e2260ec0175b972feaa0b7648a1456'
$codeBranch='codex/eventmind-gemma3-gated-v14-real120'
$baseRunnerCommit='d9476089a3095074700a880bb9d3603763822867'
$baseUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseRunnerCommit/scripts/run-eventmind-v13-gemma3-12b-real120-full-direct.ps1"
$temp=Join-Path $env:TEMP ('buyflow-v14-gated-base-' + [guid]::NewGuid().ToString('N') + '.ps1')
$patched=Join-Path $env:TEMP ('buyflow-v14-gated-run-' + [guid]::NewGuid().ToString('N') + '.ps1')

function NeedReplace([string]$text,[string]$needle,[string]$replacement,[string]$reason){
  if(-not $text.Contains($needle)){throw $reason}
  return $text.Replace($needle,$replacement)
}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER' -ForegroundColor Cyan
  Write-Host 'FULL EMAIL / 8192 CONTEXT / JSON SCHEMA / NO CHUNKS' -ForegroundColor Cyan
  Write-Host 'DIRECT / GMAIL GET-ONLY / PRODUCTION OFF' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ('Pinned code commit: ' + $codeCommit) -ForegroundColor Green
  Write-Host 'Baseline to beat: Gemma V4 FULL = 44/120' -ForegroundColor Yellow
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -OutFile $temp -TimeoutSec 30
  $text=Get-Content -Raw -LiteralPath $temp

  $text=NeedReplace $text "`$codeCommit='f779acc64dabdfea5b476e592da5c6490c736a77'" "`$codeCommit='$codeCommit'" 'EXPECTED_CODE_COMMIT_NOT_FOUND'
  $text=NeedReplace $text "`$codeBranch='codex/eventmind-gemma3-12b-real120'" "`$codeBranch='$codeBranch'" 'EXPECTED_CODE_BRANCH_NOT_FOUND'

  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-12B-FULL-V4-CHECKPOINT.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-CHECKPOINT.json')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-12B-FULL-V4-$stamp.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-$stamp.json')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-12B-FULL-V4-RUNTIME-$stamp.jsonl','BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-RUNTIME-$stamp.jsonl')

  $oldStart=@'
function Start-Qwen([int]$segment){
  Stop-Qwen
  $script:stdout=Join-Path $tempRoot ("gemma-full-runtime-$segment.out.log")
  $script:stderr=Join-Path $tempRoot ("gemma-full-runtime-$segment.err.log")
  $script:serverProcess=Start-Process -FilePath $nodePath -ArgumentList @($server) -RedirectStandardOutput $script:stdout -RedirectStandardError $script:stderr -WindowStyle Hidden -PassThru
  try{$script:serverProcess.PriorityClass='BelowNormal'}catch{}
  $health=$null
  for($i=0;$i -lt 180;$i++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4395/health' -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($script:serverProcess.HasExited){break};Start-Sleep -Seconds 1
  }
  if(-not $health -or -not $health.ok){
    if(Test-Path $script:stderr){Get-Content $script:stderr -Tail 30}
    Fail 'GEMMA3_12B_RUNTIME_START_FAILED'
  }
  if([string]$health.model_id -ne 'gemma3:12b'){Fail ('GEMMA_MODEL_MISMATCH:' + [string]$health.model_id)}
  if([string]$health.adapter_sha256 -notmatch '^[a-f0-9]{64}$'){Fail 'GEMMA_DIGEST_INVALID'}
  return $health
}
'@
  $newStart=@'
function Start-Qwen([int]$segment){
  Stop-Qwen
  $script:stdout=Join-Path $tempRoot ("gemma-v14-gated-runtime-$segment.out.log")
  $script:stderr=Join-Path $tempRoot ("gemma-v14-gated-runtime-$segment.err.log")
  $script:serverProcess=Start-Process -FilePath $nodePath -ArgumentList @($server) -RedirectStandardOutput $script:stdout -RedirectStandardError $script:stderr -WindowStyle Hidden -PassThru
  try{$script:serverProcess.PriorityClass='BelowNormal'}catch{}
  $health=$null
  for($i=0;$i -lt 180;$i++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4396/health' -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($script:serverProcess.HasExited){break};Start-Sleep -Seconds 1
  }
  if(-not $health -or -not $health.ok){
    if(Test-Path $script:stderr){Get-Content $script:stderr -Tail 30}
    Fail 'GEMMA_V14_GATED_RUNTIME_START_FAILED'
  }
  if([string]$health.model_id -ne 'gemma3:12b'){Fail ('GEMMA_MODEL_MISMATCH:' + [string]$health.model_id)}
  if([string]$health.model_digest -notmatch '^[a-f0-9]{64}$'){Fail 'GEMMA_DIGEST_INVALID'}
  if([int]$health.context_tokens -ne 8192){Fail ('GEMMA_CONTEXT_MISMATCH:' + [string]$health.context_tokens)}
  if([string]$health.structured_output -ne 'json_schema'){Fail ('GEMMA_SCHEMA_MODE_MISMATCH:' + [string]$health.structured_output)}
  return $health
}
'@
  $text=NeedReplace $text $oldStart $newStart 'EXPECTED_GEMMA_START_BLOCK_NOT_FOUND'

  $oldPrep=@'
  Write-Host '[3/4] Ollama Gemma 3 12B FULL EMAIL runtime elokeszitese...' -ForegroundColor Yellow
  if(-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)){Fail 'OLLAMA_NOT_FOUND'}
  try{$tags=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 5}catch{Fail 'OLLAMA_NOT_RUNNING'}
  $installed=@($tags.models|Where-Object{[string]$_.name -eq 'gemma3:12b' -or [string]$_.model -eq 'gemma3:12b'})
  if($installed.Count -lt 1){Fail 'GEMMA3_12B_NOT_INSTALLED'}
  $server=Join-Path $codeRoot 'scripts\eventmind-ollama-gemma3-12b-runtime.mjs'
  if(-not (Test-Path -LiteralPath $server)){Fail 'GEMMA_RUNTIME_BRIDGE_NOT_FOUND'}

'@
  $newPrep=@'
  Write-Host '[3/4] Ollama Gemma V14 gated runtime elokeszitese...' -ForegroundColor Yellow
  if(-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)){Fail 'OLLAMA_NOT_FOUND'}
  try{$tags=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 5}catch{Fail 'OLLAMA_NOT_RUNNING'}
  $installed=@($tags.models|Where-Object{[string]$_.name -eq 'gemma3:12b' -or [string]$_.model -eq 'gemma3:12b'})
  if($installed.Count -lt 1){Fail 'GEMMA3_12B_NOT_INSTALLED'}
  $server=Join-Path $codeRoot 'scripts\eventmind-ollama-gemma3-12b-gated-v14-runtime.mjs'
  if(-not (Test-Path -LiteralPath $server)){Fail 'GEMMA_V14_RUNTIME_BRIDGE_NOT_FOUND'}

'@
  $text=NeedReplace $text $oldPrep $newPrep 'EXPECTED_GEMMA_PREP_BLOCK_NOT_FOUND'

  $text=NeedReplace $text "& npm.cmd exec --yes -- tsx 'src\scripts\eventmind-v13-real-gmail-full-dev120.ts' `$IdFile `$checkpointPath 15" "& npm.cmd exec --yes -- tsx 'src\scripts\eventmind-v14-gemma-gated-real-gmail-dev120.ts' `$IdFile `$checkpointPath 15" 'EXPECTED_TS_RUNNER_NOT_FOUND'

  $oldEnv=@'
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED='true'
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL='http://127.0.0.1:4395/v1/eventmind'
    $env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256=[string]$health.adapter_sha256
    $env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS='30000'
'@
  $newEnv=@'
    $env:BUYFLOW_GEMMA_V14_RUNTIME_ENABLED='true'
    $env:BUYFLOW_GEMMA_V14_RUNTIME_URL='http://127.0.0.1:4396'
    $env:BUYFLOW_GEMMA_V14_MODEL_DIGEST=[string]$health.model_digest
    $env:BUYFLOW_GEMMA_V14_TIMEOUT_MS='30000'
'@
  $text=NeedReplace $text $oldEnv $newEnv 'EXPECTED_RUNTIME_ENV_BLOCK_NOT_FOUND'

  $text=$text.Replace('BUYFLOW EVENTMIND - REAL120 GEMMA 3 12B FULL EMAIL','BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER')
  $text=$text.Replace('NO CHUNKS / NO FINAL JUDGE / CHECKPOINT / JSON OUTPUT','FULL EMAIL / 8192 CONTEXT / JSON SCHEMA / NO CHUNKS')
  $text=$text.Replace('Gemma FULL runtime: READY | digest ','Gemma V14 runtime: READY | digest ')
  $text=$text.Replace('--- SEGMENT ${segment}: Gmail token frissites + Gemma 3 12B FULL EMAIL ---','--- SEGMENT ${segment}: Gmail token frissites + Gemma V14 gated ---')
  $text=$text.Replace('15-os blokk kesz -> Gemma runtime bridge ujrainditas.','15-os blokk kesz -> Gemma V14 runtime bridge ujrainditas.')
  $text=$text.Replace('REAL120 GEMMA 3 12B FULL EMAIL: COMPLETE','REAL120 GEMMA V14 GATED: COMPLETE')
  $text=$text.Replace('Runtime: Ollama gemma3:12b | FULL semantic email | V4 prompt | JSON mode','Runtime: Ollama gemma3:12b | buyer gate -> event | 8192 context | JSON Schema')

  $cleanupNeedle="  Remove-Item Env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS -ErrorAction SilentlyContinue"
  $cleanupExtra=@'
  Remove-Item Env:BUYFLOW_GEMMA_V14_RUNTIME_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_GEMMA_V14_RUNTIME_URL -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_GEMMA_V14_MODEL_DIGEST -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_GEMMA_V14_TIMEOUT_MS -ErrorAction SilentlyContinue
'@
  $text=NeedReplace $text $cleanupNeedle ($cleanupNeedle + "`r`n" + $cleanupExtra.TrimEnd()) 'EXPECTED_CLEANUP_ANCHOR_NOT_FOUND'

  Set-Content -LiteralPath $patched -Value $text -Encoding UTF8
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $patched -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temp,$patched -Force -ErrorAction SilentlyContinue
}
