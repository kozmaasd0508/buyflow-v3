param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$codeCommit='c1632945f43dd1ce9d3c8116993adf2d78dfcc7d'
$codeBranch='codex/eventmind-gemma3-gated-v14-real120'
$baseCommit='e3ff5a29e0c0bc8c9074c3ba22f07c6d58e6bda6'
$baseUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/run-eventmind-v13-lite-real120-chunk-judge-direct.ps1"
$temp=Join-Path $env:TEMP ('buyflow-v14-gated-base-' + [guid]::NewGuid().ToString('N') + '.ps1')
$patched=Join-Path $env:TEMP ('buyflow-v14-gated-direct-' + [guid]::NewGuid().ToString('N') + '.ps1')

function NeedReplace([string]$text,[string]$needle,[string]$replacement,[string]$reason){
  if(-not $text.Contains($needle)){throw $reason}
  return $text.Replace($needle,$replacement)
}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER' -ForegroundColor Cyan
  Write-Host 'SINGLE-LAYER RUNNER / 8192 CONTEXT / JSON SCHEMA / NO CHUNKS' -ForegroundColor Cyan
  Write-Host 'DIRECT / GMAIL GET-ONLY / PRODUCTION OFF' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ('Pinned code commit: ' + $codeCommit) -ForegroundColor Green
  Write-Host 'Baseline to beat: Gemma V4 FULL = 44/120' -ForegroundColor Yellow
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -OutFile $temp -TimeoutSec 30
  $text=Get-Content -Raw -LiteralPath $temp

  # Pin the exact V14 code and keep the frozen REAL120 harness.
  $text=NeedReplace $text "$branch='codex/buyflow-testlab-v1'" "$branch='$codeBranch'" 'EXPECTED_BRANCH_ASSIGNMENT_NOT_FOUND'
  $text=NeedReplace $text "Cmd-Git $repoRoot ('fetch --depth=1 origin ' + $branch)|Out-Null" "Cmd-Git $repoRoot ('fetch --depth=10 origin ' + $branch)|Out-Null" 'EXPECTED_FETCH_DEPTH_NOT_FOUND'

  $pinNeedle='if($fetched -notmatch ''^[a-f0-9]{40}$''){Fail "FETCH_HEAD_INVALID:$fetched"}'
  $pinLines=$pinNeedle + "`r`n  Cmd-Git `$repoRoot ('merge-base --is-ancestor $codeCommit ' + `$fetched)|Out-Null"
  $text=NeedReplace $text $pinNeedle $pinLines 'EXPECTED_FETCH_HEAD_GUARD_NOT_FOUND'
  $text=NeedReplace $text "Write-Host ('Code commit: ' + `$fetched) -ForegroundColor Green" "Write-Host ('Branch head: ' + `$fetched) -ForegroundColor DarkGray`r`n  Write-Host ('Pinned code commit: $codeCommit') -ForegroundColor Green" 'EXPECTED_CODE_PRINT_NOT_FOUND'
  $text=NeedReplace $text "Cmd-Git `$repoRoot ('worktree add --detach `"' + `$codeRoot + '`" ' + `$fetched)|Out-Null" "Cmd-Git `$repoRoot ('worktree add --detach `"' + `$codeRoot + '`" $codeCommit')|Out-Null" 'EXPECTED_WORKTREE_ADD_NOT_FOUND'

  # V14 has no LoRA/local-data dependency.
  $oldModel=@'
  $modelRoot=Find-ModelRoot $repoRoot
  if(-not $modelRoot){Fail 'V11_MODEL_ROOT_NOT_FOUND'}
'@
  $text=NeedReplace $text $oldModel "  `$modelRoot=`$null`r`n" 'EXPECTED_MODEL_ROOT_BLOCK_NOT_FOUND'

  $oldLocal=@'
  $localDataSource=Join-Path $modelRoot 'local-data'
  $localDataTarget=Join-Path $codeRoot 'local-data'
  & cmd.exe /d /c "mklink /J `"$localDataTarget`" `"$localDataSource`""|Out-Null
  if($LASTEXITCODE -ne 0){Fail 'LOCAL_DATA_JUNCTION_FAILED'}
  $localDataJunction=$true

'@
  $text=NeedReplace $text $oldLocal '' 'EXPECTED_LOCAL_DATA_BLOCK_NOT_FOUND'

  # Replace WSL/Qwen process management with the native Ollama V14 bridge.
  $oldStop=@'
function Stop-Qwen{
  if($script:serverProcess){try{if(-not $script:serverProcess.HasExited){Stop-Process -Id $script:serverProcess.Id -Force -ErrorAction SilentlyContinue}}catch{}}
  $script:serverProcess=$null
  if(Get-Command wsl.exe -ErrorAction SilentlyContinue){
    & wsl.exe -d $distro -- sh -lc "pkill -f '[e]ventmind-v11-runtime-diagnostic.py' || true; pkill -f '[e]ventmind-v11-runtime.py' || true"|Out-Null
  }
  Start-Sleep -Seconds 2
}
'@
  $newStop=@'
function Stop-Qwen{
  if($script:serverProcess){try{if(-not $script:serverProcess.HasExited){Stop-Process -Id $script:serverProcess.Id -Force -ErrorAction SilentlyContinue}}catch{}}
  $script:serverProcess=$null
  Start-Sleep -Milliseconds 500
}
'@
  $text=NeedReplace $text $oldStop $newStop 'EXPECTED_STOP_BLOCK_NOT_FOUND'

  $oldStart=@'
$server=$null;$wslProject=$null;$wslServer=$null;$wslDiagLog=$null;$wslPython=$null
function Start-Qwen([int]$segment){
  Stop-Qwen
  $script:stdout=Join-Path $tempRoot ("runtime-$segment.out.log")
  $script:stderr=Join-Path $tempRoot ("runtime-$segment.err.log")
  $launchArgs=@(
    '-d',$distro,'--','nice','-n','10','env',
    'HSA_ENABLE_DXG_DETECTION=1','TOKENIZERS_PARALLELISM=false',
    'OMP_NUM_THREADS=4','MKL_NUM_THREADS=4','OPENBLAS_NUM_THREADS=4','NUMEXPR_NUM_THREADS=4',
    ('BUYFLOW_EVENTMIND_DIAG_LOG=' + $wslDiagLog),
    $wslPython,$wslServer,$wslProject
  )
  $script:serverProcess=Start-Process -FilePath 'wsl.exe' -ArgumentList $launchArgs -RedirectStandardOutput $script:stdout -RedirectStandardError $script:stderr -WindowStyle Hidden -PassThru
  try{$script:serverProcess.PriorityClass='BelowNormal'}catch{}
  $health=$null
  for($i=0;$i -lt 180;$i++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4394/health' -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($script:serverProcess.HasExited){break};Start-Sleep -Seconds 1
  }
  if(-not $health -or -not $health.ok){
    if(Test-Path $script:stderr){Get-Content $script:stderr -Tail 30}
    Fail 'EVENTMIND_DIAGNOSTIC_RUNTIME_START_FAILED'
  }
  return $health
}
'@
  $newStart=@'
$server=$null;$wslProject=$null;$wslServer=$null;$wslDiagLog=$null;$wslPython=$null
function Start-Qwen([int]$segment){
  Stop-Qwen
  $script:stdout=Join-Path $tempRoot ("gemma-v14-runtime-$segment.out.log")
  $script:stderr=Join-Path $tempRoot ("gemma-v14-runtime-$segment.err.log")
  $script:serverProcess=Start-Process -FilePath $nodePath -ArgumentList @($server) -RedirectStandardOutput $script:stdout -RedirectStandardError $script:stderr -WindowStyle Hidden -PassThru
  try{$script:serverProcess.PriorityClass='BelowNormal'}catch{}
  $health=$null
  for($i=0;$i -lt 180;$i++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4396/health' -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($script:serverProcess.HasExited){break};Start-Sleep -Seconds 1
  }
  if(-not $health -or -not $health.ok){
    if(Test-Path $script:stderr){Get-Content $script:stderr -Tail 40}
    Fail 'GEMMA_V14_GATED_RUNTIME_START_FAILED'
  }
  if([string]$health.model_id -ne 'gemma3:12b'){Fail ('GEMMA_MODEL_MISMATCH:' + [string]$health.model_id)}
  if([string]$health.model_digest -notmatch '^[a-f0-9]{64}$'){Fail 'GEMMA_MODEL_DIGEST_INVALID'}
  if([int]$health.context_tokens -ne 8192){Fail ('GEMMA_CONTEXT_MISMATCH:' + [string]$health.context_tokens)}
  if([string]$health.structured_output -ne 'json_schema'){Fail ('GEMMA_SCHEMA_MODE_MISMATCH:' + [string]$health.structured_output)}
  return $health
}
'@
  $text=NeedReplace $text $oldStart $newStart 'EXPECTED_START_BLOCK_NOT_FOUND'

  $oldPrep=@'
  Write-Host '[3/4] Helyi Qwen felugyelet elokeszitese...' -ForegroundColor Yellow
  $server=Join-Path $codeRoot 'scripts\eventmind-v11-runtime-diagnostic.py'
  if(-not (Test-Path -LiteralPath $server)){Fail 'DIAGNOSTIC_RUNTIME_NOT_FOUND'}
  $wslProject=Convert-ToWslPath $codeRoot
  $wslServer=Convert-ToWslPath $server
  $wslDiagLog=Convert-ToWslPath $diagLogPath
  $wslHome=(& wsl.exe -d $distro -- sh -lc 'printf %s "$HOME"').Trim()
  if([string]::IsNullOrWhiteSpace($wslHome)){Fail 'WSL_HOME_NOT_FOUND'}
  $wslPython="$wslHome/.venvs/buyflow-lora/bin/python"
  & wsl.exe -d $distro -- test -x $wslPython
  if($LASTEXITCODE -ne 0){Fail 'LORA_PYTHON_NOT_FOUND'}

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
  $text=NeedReplace $text $oldPrep $newPrep 'EXPECTED_PREP_BLOCK_NOT_FOUND'

  # Replace the old runtime environment in one exact operation; no adapter_sha256 survives.
  $oldEnv=@'
    $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED='true'
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL='http://127.0.0.1:4394/v1/eventmind'
    $env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256=[string]$health.adapter_sha256
    $env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS='20000'
'@
  $newEnv=@'
    $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken
    $env:BUYFLOW_GEMMA_V14_RUNTIME_ENABLED='true'
    $env:BUYFLOW_GEMMA_V14_RUNTIME_URL='http://127.0.0.1:4396'
    $env:BUYFLOW_GEMMA_V14_MODEL_DIGEST=[string]$health.model_digest
    $env:BUYFLOW_GEMMA_V14_TIMEOUT_MS='30000'
'@
  $text=NeedReplace $text $oldEnv $newEnv 'EXPECTED_RUNTIME_ENV_BLOCK_NOT_FOUND'

  $text=NeedReplace $text "& npm.cmd exec --yes -- tsx 'src\scripts\eventmind-v13-real-gmail-chunk-judge-dev120.ts' `$IdFile `$checkpointPath 15" "& npm.cmd exec --yes -- tsx 'src\scripts\eventmind-v14-gemma-gated-real-gmail-dev120.ts' `$IdFile `$checkpointPath 15" 'EXPECTED_TS_RUNNER_CALL_NOT_FOUND'

  # Separate checkpoint/report names so no previous run can contaminate this one.
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-CHECKPOINT.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-CHECKPOINT.json')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-$stamp.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-$stamp.json')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-GPU-$stamp.jsonl','BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-RUNTIME-$stamp.jsonl')

  $text=$text.Replace('BUYFLOW EVENTMIND V13-LITE - REAL120 CHUNK + FINAL JUDGE','BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER')
  $text=$text.Replace('DIRECT / CHECKPOINT / QWEN RESTART 15 LEVELENKENT','SINGLE-LAYER / 8192 CONTEXT / JSON SCHEMA / NO CHUNKS')
  $text=$text.Replace('--- SEGMENT $segment: Gmail token frissites + tiszta Qwen ---','--- SEGMENT ${segment}: Gmail token frissites + Gemma V14 gated ---')
  $text=$text.Replace("Write-Host 'Qwen runtime: READY' -ForegroundColor Green","Write-Host ('Gemma V14 runtime: READY | digest ' + [string]`$health.model_digest + ' | ctx 8192 | JSON Schema') -ForegroundColor Green")
  $text=$text.Replace('15-os blokk kesz -> tervezett Qwen ujrainditas.','15-os blokk kesz -> Gemma V14 runtime bridge ujrainditas.')
  $text=$text.Replace("Write-Host ('GPU log: ' + `$diagLogPath) -ForegroundColor DarkGray","Write-Host 'Runtime: Ollama gemma3:12b | buyer gate -> event | 8192 context | JSON Schema' -ForegroundColor DarkGray")
  $text=$text.Replace('REAL120 CHUNK + FINAL JUDGE: COMPLETE','REAL120 GEMMA V14 GATED V2: COMPLETE')

  # Guard: the generated runner must contain no active adapter_sha256 reference.
  if($text -match '\$health\.adapter_sha256' -or $text -match 'BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256'){
    throw 'LEGACY_ADAPTER_REFERENCE_SURVIVED'
  }

  Set-Content -LiteralPath $patched -Value $text -Encoding UTF8
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $patched -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temp,$patched -Force -ErrorAction SilentlyContinue
}
