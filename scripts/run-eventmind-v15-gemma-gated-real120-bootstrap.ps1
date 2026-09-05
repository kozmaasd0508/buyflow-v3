param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json')
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

# Literal source-code placeholders consumed by the proven V14 single-layer patcher.
$branch='$branch'
$repoRoot='$repoRoot'

$coreCommit='2ce1c34cf858a637146cf11fc178350125da4f36'
$runnerCommit='ae237feaf910932ef45be40b8979c1f492775ba2'
$url="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/run-eventmind-v14-gemma-gated-real120-direct-v2.ps1"
$tmp=Join-Path $env:TEMP ('buyflow-v15-gated-' + [guid]::NewGuid().ToString('N') + '.ps1')

function NeedReplace([string]$text,[string]$needle,[string]$replacement,[string]$reason){
  if(-not $text.Contains($needle)){throw $reason}
  return $text.Replace($needle,$replacement)
}

try {
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp -TimeoutSec 30
  $raw=Get-Content -Raw -LiteralPath $tmp

  # Same compatibility fixes that produced the successful V14 V2 run.
  $oldGuard=@'
  if($text -match '\$health\.adapter_sha256' -or $text -match 'BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256'){
'@
  $newGuard=@'
  if($text -match '\$health\.adapter_sha256'){
'@
  $raw=NeedReplace $raw $oldGuard $newGuard 'EXPECTED_V15_GUARD_NOT_FOUND'
  $raw=NeedReplace $raw 'fetch --depth=10 origin' 'fetch --depth=50 origin' 'EXPECTED_V15_FETCH_DEPTH_NOT_FOUND'

  # Pin the exact V15 experiment commit while keeping the same branch and frozen REAL120 IDs.
  $raw=NeedReplace $raw "`$codeCommit='c1632945f43dd1ce9d3c8116993adf2d78dfcc7d'" "`$codeCommit='$coreCommit'" 'EXPECTED_V15_CORE_COMMIT_NOT_FOUND'

  # Only the prompt-overlay bridge and evaluation script change from V14.
  $raw=NeedReplace $raw 'scripts\eventmind-ollama-gemma3-12b-gated-v14-runtime.mjs' 'scripts\eventmind-ollama-gemma3-12b-gated-v15-runtime.mjs' 'EXPECTED_V15_RUNTIME_PATH_NOT_FOUND'
  $raw=NeedReplace $raw 'src\scripts\eventmind-v14-gemma-gated-real-gmail-dev120.ts' 'src\scripts\eventmind-v15-gemma-gated-real-gmail-dev120.ts' 'EXPECTED_V15_TS_RUNNER_NOT_FOUND'

  # Separate checkpoint/report namespace: never resume from the V14 result.
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-CHECKPOINT.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V15-GATED-CHECKPOINT.json')
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-$stamp.json','BuyFlow-EVENTMIND-REAL120-GEMMA3-V15-GATED-$stamp.json')
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-RUNTIME-$stamp.jsonl','BuyFlow-EVENTMIND-REAL120-GEMMA3-V15-GATED-RUNTIME-$stamp.jsonl')

  $raw=$raw.Replace('BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER','BUYFLOW EVENTMIND V15 - GEMMA BUYER GATE + EVENT CLASSIFIER')
  $raw=$raw.Replace('Baseline to beat: Gemma V4 FULL = 44/120','Baseline to beat: Gemma V14 GATED = 85/120')
  $raw=$raw.Replace('REAL120 GEMMA V14 GATED V2: COMPLETE','REAL120 GEMMA V15 GATED: COMPLETE')
  $raw=$raw.Replace('Runtime: Ollama gemma3:12b | buyer gate -> event | 8192 context | JSON Schema','Runtime: Ollama gemma3:12b | V15 gate/event boundary overlay | 8192 context | JSON Schema')

  Set-Content -LiteralPath $tmp -Value $raw -Encoding UTF8
  . $tmp -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
