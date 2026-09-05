param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# Literal source-code placeholders consumed by the proven V14 single-layer patcher.
# These are intentionally literal strings, not runtime paths/branch values.
$branch='$branch'
$repoRoot='$repoRoot'

$coreCommit='e26ccd995469690f9d8450db0959cc50f295c7bd'
$codeBranch='codex/eventmind-gemma3-v16-hierarchical'
$runnerCommit='ae237feaf910932ef45be40b8979c1f492775ba2'
$url="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/run-eventmind-v14-gemma-gated-real120-direct-v2.ps1"
$tmp=Join-Path $env:TEMP ('buyflow-v16-hierarchical-' + [guid]::NewGuid().ToString('N') + '.ps1')

function NeedReplace([string]$text,[string]$needle,[string]$replacement,[string]$reason){
  if(-not $text.Contains($needle)){throw $reason}
  return $text.Replace($needle,$replacement)
}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND V16 - HIERARCHICAL GENERALIZATION' -ForegroundColor Cyan
  Write-Host 'BUYER GATE -> FAMILY GATE -> FAMILY-RESTRICTED EVENT' -ForegroundColor Cyan
  Write-Host 'NO BLIND40 TUNING / Gmail GET-only / PRODUCTION OFF' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'REAL120 only = development. BLIND40 V1 remains sealed.' -ForegroundColor Yellow
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp -TimeoutSec 30
  $raw=Get-Content -Raw -LiteralPath $tmp

  # Compatibility fixes from the proven V15/V14 harness.
  $oldGuard=@'
  if($text -match '\$health\.adapter_sha256' -or $text -match 'BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256'){
'@
  $newGuard=@'
  if($text -match '\$health\.adapter_sha256'){
'@
  $raw=NeedReplace $raw $oldGuard $newGuard 'EXPECTED_V16_GUARD_NOT_FOUND'
  $raw=NeedReplace $raw 'fetch --depth=10 origin' 'fetch --depth=50 origin' 'EXPECTED_V16_FETCH_DEPTH_NOT_FOUND'

  # Pin V16 code and branch.
  $raw=NeedReplace $raw "`$codeCommit='c1632945f43dd1ce9d3c8116993adf2d78dfcc7d'" "`$codeCommit='$coreCommit'" 'EXPECTED_V16_CORE_COMMIT_NOT_FOUND'
  $raw=NeedReplace $raw "`$codeBranch='codex/eventmind-gemma3-gated-v14-real120'" "`$codeBranch='$codeBranch'" 'EXPECTED_V16_CODE_BRANCH_NOT_FOUND'

  # Native V16 runtime + V16 hierarchical runner.
  $raw=NeedReplace $raw 'scripts\eventmind-ollama-gemma3-12b-gated-v14-runtime.mjs' 'scripts\eventmind-ollama-gemma3-12b-v16-hierarchical-runtime.mjs' 'EXPECTED_V16_RUNTIME_PATH_NOT_FOUND'
  $raw=NeedReplace $raw 'src\scripts\eventmind-v14-gemma-gated-real-gmail-dev120.ts' 'src\scripts\eventmind-v16-gemma-hierarchical-real-gmail-dev120.ts' 'EXPECTED_V16_TS_RUNNER_NOT_FOUND'

  # V16 has its own loopback port and environment namespace.
  $raw=$raw.Replace('4396','4397')
  $raw=$raw.Replace('BUYFLOW_GEMMA_V14_RUNTIME_ENABLED','BUYFLOW_GEMMA_V16_RUNTIME_ENABLED')
  $raw=$raw.Replace('BUYFLOW_GEMMA_V14_RUNTIME_URL','BUYFLOW_GEMMA_V16_RUNTIME_URL')
  $raw=$raw.Replace('BUYFLOW_GEMMA_V14_MODEL_DIGEST','BUYFLOW_GEMMA_V16_MODEL_DIGEST')
  $raw=$raw.Replace('BUYFLOW_GEMMA_V14_TIMEOUT_MS','BUYFLOW_GEMMA_V16_TIMEOUT_MS')

  # Separate checkpoint/report namespace. Never resume V15 or BLIND40 state.
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-CHECKPOINT.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V16-HIERARCHICAL-CHECKPOINT.json')
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-$stamp.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V16-HIERARCHICAL-$stamp.json')
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-RUNTIME-$stamp.jsonl','BuyFlow-EVENTMIND-REAL120-GEMMA3-V16-HIERARCHICAL-RUNTIME-$stamp.jsonl')

  $raw=$raw.Replace('BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER','BUYFLOW EVENTMIND V16 - HIERARCHICAL GENERALIZATION')
  $raw=$raw.Replace('Baseline to beat: Gemma V4 FULL = 44/120','Development baseline: V15 = 92/120 | BLIND40 V1 sealed')
  $raw=$raw.Replace('Gemma V14 runtime: READY','Gemma V16 runtime: READY')
  $raw=$raw.Replace('GEMMA_V14_GATED_RUNTIME_START_FAILED','GEMMA_V16_HIERARCHICAL_RUNTIME_START_FAILED')
  $raw=$raw.Replace('GEMMA_V14_RUNTIME_BRIDGE_NOT_FOUND','GEMMA_V16_RUNTIME_BRIDGE_NOT_FOUND')
  $raw=$raw.Replace('Ollama Gemma V14 gated runtime elokeszitese','Ollama Gemma V16 hierarchical runtime elokeszitese')
  $raw=$raw.Replace('REAL120 GEMMA V14 GATED V2: COMPLETE','REAL120 GEMMA V16 HIERARCHICAL: COMPLETE')
  $raw=$raw.Replace('buyer gate -> event','buyer gate -> family gate -> restricted event')
  $raw=$raw.Replace('Gemma V14 gated','Gemma V16 hierarchical')

  Set-Content -LiteralPath $tmp -Value $raw -Encoding UTF8
  . $tmp -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
