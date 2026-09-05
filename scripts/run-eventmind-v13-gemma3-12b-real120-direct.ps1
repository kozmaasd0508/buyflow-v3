param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$codeCommit='071712983494ccbea0a173986f5877b76faeaa55'
$codeBranch='codex/eventmind-gemma3-12b-real120'
$baseCommit='e3ff5a29e0c0bc8c9074c3ba22f07c6d58e6bda6'
$baseUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$baseCommit/scripts/run-eventmind-v13-lite-real120-chunk-judge-direct.ps1"
$temp=Join-Path $env:TEMP ('buyflow-gemma3-real120-base-' + [guid]::NewGuid().ToString('N') + '.ps1')
$patched=Join-Path $env:TEMP ('buyflow-gemma3-real120-run-' + [guid]::NewGuid().ToString('N') + '.ps1')

function NeedReplace([string]$text,[string]$needle,[string]$replacement,[string]$reason){
  if(-not $text.Contains($needle)){throw $reason}
  return $text.Replace($needle,$replacement)
}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND - REAL120 GEMMA 3 12B A/B TEST' -ForegroundColor Cyan
  Write-Host 'SAME REAL120 + SAME V4 PROMPT / ONLY MODEL CHANGED' -ForegroundColor Cyan
  Write-Host 'DIRECT / GMAIL GET-ONLY / PRODUCTION OFF' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ('Pinned code commit: ' + $codeCommit) -ForegroundColor Green
  Write-Host 'Model: Ollama gemma3:12b' -ForegroundColor Green
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -OutFile $temp -TimeoutSec 30
  $text=Get-Content -Raw -LiteralPath $temp

  $text=NeedReplace $text "`$branch='codex/buyflow-testlab-v1'" "`$branch='$codeBranch'" 'EXPECTED_BRANCH_ASSIGNMENT_NOT_FOUND'

  $parserBad='Write-Host ("--- SEGMENT $segment: Gmail token frissites + tiszta Qwen ---") -ForegroundColor Cyan'
  $parserGood='Write-Host ("--- SEGMENT ${segment}: Gmail token frissites + Gemma 3 12B ---") -ForegroundColor Cyan'
  $text=NeedReplace $text $parserBad $parserGood 'EXPECTED_SEGMENT_INTERPOLATION_NOT_FOUND'

  $pinNeedle='if($fetched -notmatch ''^[a-f0-9]{40}$''){Fail "FETCH_HEAD_INVALID:$fetched"}'
  $pinLine="  if(`$fetched -ne '$codeCommit'){Fail `"PINNED_CODE_MISMATCH:`$fetched`"}"
  $text=NeedReplace $text $pinNeedle ($pinNeedle + "`r`n" + $pinLine) 'EXPECTED_FETCH_HEAD_GUARD_NOT_FOUND'

  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-CHECKPOINT.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-12B-V4-CHECKPOINT.json')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-$stamp.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-12B-V4-$stamp.json')
  $text=$text.Replace('BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-GPU-$stamp.jsonl','BuyFlow-EVENTMIND-REAL120-GEMMA3-12B-V4-RUNTIME-$stamp.jsonl')

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
  $text=NeedReplace $text $oldStop $newStop 'EXPECTED_STOP_QWEN_BLOCK_NOT_FOUND'

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
  $script:stdout=Join-Path $tempRoot ("gemma-runtime-$segment.out.log")
  $script:stderr=Join-Path $tempRoot ("gemma-runtime-$segment.err.log")
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
  $text=NeedReplace $text $oldStart $newStart 'EXPECTED_START_QWEN_BLOCK_NOT_FOUND'

  $oldModel=@'
  $modelRoot=Find-ModelRoot $repoRoot
  if(-not $modelRoot){Fail 'V11_MODEL_ROOT_NOT_FOUND'}
'@
  $newModel=@'
  $modelRoot=$null
'@
  $text=NeedReplace $text $oldModel $newModel 'EXPECTED_MODEL_ROOT_BLOCK_NOT_FOUND'

  $oldLocal=@'
  $localDataSource=Join-Path $modelRoot 'local-data'
  $localDataTarget=Join-Path $codeRoot 'local-data'
  & cmd.exe /d /c "mklink /J `"$localDataTarget`" `"$localDataSource`""|Out-Null
  if($LASTEXITCODE -ne 0){Fail 'LOCAL_DATA_JUNCTION_FAILED'}
  $localDataJunction=$true

'@
  $text=NeedReplace $text $oldLocal '' 'EXPECTED_LOCAL_DATA_BLOCK_NOT_FOUND'

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
  Write-Host '[3/4] Ollama Gemma 3 12B runtime elokeszitese...' -ForegroundColor Yellow
  if(-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)){Fail 'OLLAMA_NOT_FOUND'}
  try{
    $tags=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 5
  }catch{Fail 'OLLAMA_NOT_RUNNING'}
  $installed=@($tags.models|Where-Object{[string]$_.name -eq 'gemma3:12b' -or [string]$_.model -eq 'gemma3:12b'})
  if($installed.Count -lt 1){Fail 'GEMMA3_12B_NOT_INSTALLED'}
  $server=Join-Path $codeRoot 'scripts\eventmind-ollama-gemma3-12b-runtime.mjs'
  if(-not (Test-Path -LiteralPath $server)){Fail 'GEMMA_RUNTIME_BRIDGE_NOT_FOUND'}

'@
  $text=NeedReplace $text $oldPrep $newPrep 'EXPECTED_QWEN_PREP_BLOCK_NOT_FOUND'

  $text=$text.Replace('BUYFLOW EVENTMIND V13-LITE - REAL120 CHUNK + FINAL JUDGE','BUYFLOW EVENTMIND - REAL120 GEMMA 3 12B / PROMPT V4')
  $text=$text.Replace('DIRECT / CHECKPOINT / QWEN RESTART 15 LEVELENKENT','DIRECT / CHECKPOINT / GEMMA 3 12B / SAME V4 PROMPT')
  $text=$text.Replace("Write-Host 'Qwen runtime: READY' -ForegroundColor Green","Write-Host ('Gemma runtime: READY | digest ' + [string]`$health.adapter_sha256) -ForegroundColor Green")
  $text=$text.Replace("`$env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL='http://127.0.0.1:4394/v1/eventmind'","`$env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL='http://127.0.0.1:4395/v1/eventmind'")
  $text=$text.Replace("`$env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS='20000'","`$env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS='30000'")
  $text=$text.Replace('15-os blokk kesz -> tervezett Qwen ujrainditas.','15-os blokk kesz -> Gemma runtime bridge ujrainditas.')
  $text=$text.Replace("Write-Host ('GPU log: ' + `$diagLogPath) -ForegroundColor DarkGray","Write-Host 'Runtime: Ollama gemma3:12b | prompt: V4 unchanged' -ForegroundColor DarkGray")
  $text=$text.Replace('REAL120 CHUNK + FINAL JUDGE: COMPLETE','REAL120 GEMMA 3 12B: COMPLETE')

  Set-Content -LiteralPath $patched -Value $text -Encoding UTF8
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $patched -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $temp,$patched -Force -ErrorAction SilentlyContinue
}
