param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# Keep the proven V14/V15 REAL120 harness, but pin a dedicated Lemonade parity commit.
$branch='$branch'
$repoRoot='$repoRoot'
$coreCommit='0ba3ee078c179923a58d49f044cd4d01a6d3ff22'
$codeBranch='codex/eventmind-v15-lemonade-real120'
$runnerCommit='ae237feaf910932ef45be40b8979c1f492775ba2'
$url="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/run-eventmind-v14-gemma-gated-real120-direct-v2.ps1"
$tmp=Join-Path $env:TEMP ('buyflow-v15-lemonade-' + [guid]::NewGuid().ToString('N') + '.ps1')

function NeedReplace([string]$text,[string]$needle,[string]$replacement,[string]$reason){
  if(-not $text.Contains($needle)){throw $reason}
  return $text.Replace($needle,$replacement)
}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND V15 - LEMONADE REAL120 PARITY' -ForegroundColor Cyan
  Write-Host 'V15 BUYER GATE + EVENT / 8192 / STRICT JSON SCHEMA' -ForegroundColor Cyan
  Write-Host 'Gmail GET-only / BuyFlow writes 0 / production OFF' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host ('Pinned code commit: ' + $coreCommit) -ForegroundColor Green
  Write-Host 'Reference baseline: Ollama V15 = 92/120' -ForegroundColor Yellow
  Write-Host ''

  # Lemonade itself must already be up and healthy. Never substitute Ollama.
  try{$lh=Invoke-RestMethod -Uri 'http://127.0.0.1:13305/v1/health' -Method Get -TimeoutSec 15}catch{throw 'LEMONADE_NOT_READY'}
  if(-not $lh){throw 'LEMONADE_NOT_READY'}
  Write-Host 'Lemonade API: READY' -ForegroundColor Green

  # Portable Node/n8n are proven in this environment.
  $portableNode=Join-Path $env:USERPROFILE 'BuyFlowTools\node-v24.20.0-win-x64\node.exe'
  $portableN8n=Join-Path $env:USERPROFILE 'BuyFlowTools\n8n-2.37.3-node24\node_modules\n8n\bin\n8n'
  if(-not (Test-Path -LiteralPath $portableNode)){throw 'PORTABLE_NODE24_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $portableN8n)){throw 'PORTABLE_N8N_2_37_3_NOT_FOUND'}
  $nv=(& $portableNode --version | Select-Object -First 1).ToString().Trim()
  if($nv -ne 'v24.20.0'){throw ('UNEXPECTED_PORTABLE_NODE:'+ $nv)}
  Write-Host 'Portable Node 24 + n8n 2.37.3: READY' -ForegroundColor Green

  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp -TimeoutSec 30
  $raw=Get-Content -Raw -LiteralPath $tmp

  # Compatibility fixes from the proven V15 runner.
  $oldGuard=@'
  if($text -match '\$health\.adapter_sha256' -or $text -match 'BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256'){
'@
  $newGuard=@'
  if($text -match '\$health\.adapter_sha256'){
'@
  $raw=NeedReplace $raw $oldGuard $newGuard 'EXPECTED_V15_GUARD_NOT_FOUND'
  $raw=NeedReplace $raw 'fetch --depth=10 origin' 'fetch --depth=50 origin' 'EXPECTED_V15_FETCH_DEPTH_NOT_FOUND'

  # Dedicated branch/commit. Same V15 core logic; only Lemonade runtime bridge is added.
  $raw=NeedReplace $raw "`$codeCommit='c1632945f43dd1ce9d3c8116993adf2d78dfcc7d'" "`$codeCommit='$coreCommit'" 'EXPECTED_V15_CORE_COMMIT_NOT_FOUND'
  $raw=NeedReplace $raw "`$codeBranch='codex/eventmind-gemma3-gated-v14-real120'" "`$codeBranch='$codeBranch'" 'EXPECTED_V15_CODE_BRANCH_NOT_FOUND'

  # Same V15 semantic runner, Lemonade backend bridge instead of Ollama.
  $raw=NeedReplace $raw 'scripts\eventmind-ollama-gemma3-12b-gated-v14-runtime.mjs' 'scripts\eventmind-lemonade-gemma3-12b-gated-v15-runtime.mjs' 'EXPECTED_RUNTIME_PATH_NOT_FOUND'
  $raw=NeedReplace $raw 'src\scripts\eventmind-v14-gemma-gated-real-gmail-dev120.ts' 'src\scripts\eventmind-v15-gemma-gated-real-gmail-dev120.ts' 'EXPECTED_V15_TS_RUNNER_NOT_FOUND'
  $raw=$raw.Replace('4396','4398')

  # The V14 direct wrapper would otherwise check Ollama. Replace that prep with Lemonade-only readiness.
  $oldPrep=@'
  Write-Host '[3/4] Ollama Gemma V14 gated runtime elokeszitese...' -ForegroundColor Yellow
  if(-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)){Fail 'OLLAMA_NOT_FOUND'}
  try{$tags=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 5}catch{Fail 'OLLAMA_NOT_RUNNING'}
  $installed=@($tags.models|Where-Object{[string]$_.name -eq 'gemma3:12b' -or [string]$_.model -eq 'gemma3:12b'})
  if($installed.Count -lt 1){Fail 'GEMMA3_12B_NOT_INSTALLED'}
  $server=Join-Path $codeRoot 'scripts\eventmind-lemonade-gemma3-12b-gated-v15-runtime.mjs'
  if(-not (Test-Path -LiteralPath $server)){Fail 'GEMMA_V14_RUNTIME_BRIDGE_NOT_FOUND'}

'@
  $newPrep=@'
  Write-Host '[3/4] Lemonade Gemma V15 runtime elokeszitese...' -ForegroundColor Yellow
  try{$lemonadeHealth=Invoke-RestMethod -Uri 'http://127.0.0.1:13305/v1/health' -Method Get -TimeoutSec 10}catch{Fail 'LEMONADE_NOT_RUNNING'}
  if(-not $lemonadeHealth){Fail 'LEMONADE_NOT_READY'}
  $server=Join-Path $codeRoot 'scripts\eventmind-lemonade-gemma3-12b-gated-v15-runtime.mjs'
  if(-not (Test-Path -LiteralPath $server)){Fail 'LEMONADE_V15_RUNTIME_BRIDGE_NOT_FOUND'}

'@
  $raw=NeedReplace $raw $oldPrep $newPrep 'EXPECTED_OLLAMA_PREP_BLOCK_NOT_FOUND'

  # Ensure the generated final harness uses the proven portable Node + portable n8n executable.
  $injectNeedle='  # Guard: the generated runner must contain no active adapter_sha256 reference.'
  $inject=@'
  $text=NeedReplace $text '$nodePath=''C:\Program Files\nodejs\node.exe''' '$nodePath=Join-Path $env:USERPROFILE ''BuyFlowTools\node-v24.20.0-win-x64\node.exe''; $env:PATH=(Split-Path $nodePath -Parent)+'';''+$env:PATH' 'EXPECTED_PORTABLE_NODE_PATCH_TARGET_NOT_FOUND'
  $text=NeedReplace $text '$n8nScript=Join-Path $env:USERPROFILE ''Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n''' '$n8nScript=Join-Path $env:USERPROFILE ''BuyFlowTools\n8n-2.37.3-node24\node_modules\n8n\bin\n8n''' 'EXPECTED_PORTABLE_N8N_PATCH_TARGET_NOT_FOUND'

'@
  $raw=NeedReplace $raw $injectNeedle ($inject+$injectNeedle) 'EXPECTED_GUARD_INJECTION_POINT_NOT_FOUND'

  # Separate checkpoint/report namespace: never resume from Ollama V15.
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-CHECKPOINT.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V15-LEMONADE-CHECKPOINT.json')
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-$stamp.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V15-LEMONADE-$stamp.json')
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-RUNTIME-$stamp.jsonl','BuyFlow-EVENTMIND-REAL120-GEMMA3-V15-LEMONADE-RUNTIME-$stamp.jsonl')

  $raw=$raw.Replace('BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER','BUYFLOW EVENTMIND V15 - LEMONADE BUYER GATE + EVENT CLASSIFIER')
  $raw=$raw.Replace('Baseline to beat: Gemma V4 FULL = 44/120','Reference baseline: Ollama V15 = 92/120')
  $raw=$raw.Replace('REAL120 GEMMA V14 GATED V2: COMPLETE','REAL120 GEMMA V15 LEMONADE: COMPLETE')
  $raw=$raw.Replace('Runtime: Ollama gemma3:12b | buyer gate -> event | 8192 context | JSON Schema','Runtime: Lemonade Gemma 3 12B Q4_K_M | V15 buyer gate -> event | 8192 | strict JSON Schema')
  $raw=$raw.Replace('Gemma V14 runtime: READY','Gemma V15 Lemonade runtime: READY')
  $raw=$raw.Replace('gemma-v14-runtime-','gemma-v15-lemonade-runtime-')
  $raw=$raw.Replace('15-os blokk kesz -> Gemma V14 runtime bridge ujrainditas.','15-os blokk kesz -> Lemonade V15 runtime bridge ujrainditas.')

  # Hard guards: no Ollama runtime dependency may survive into the generated direct wrapper.
  if($raw -match 'api/tags' -or $raw -match 'OLLAMA_NOT_RUNNING' -or $raw -match 'eventmind-ollama-gemma3-12b-gated-v14-runtime'){
    throw 'OLLAMA_DEPENDENCY_SURVIVED_IN_LEMONADE_RUNNER'
  }

  Set-Content -LiteralPath $tmp -Value $raw -Encoding UTF8
  . $tmp -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
