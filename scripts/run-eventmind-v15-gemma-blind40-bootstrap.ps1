param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\blind40-ids.json')
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$branch='$branch'
$repoRoot='$repoRoot'

$coreCommit='0eb9b23e290c954a239e5471fa689f47d1724d10'
$runnerCommit='ae237feaf910932ef45be40b8979c1f492775ba2'
$url="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/scripts/run-eventmind-v14-gemma-gated-real120-direct-v2.ps1"
$tmp=Join-Path $env:TEMP ('buyflow-v15-blind40-' + [guid]::NewGuid().ToString('N') + '.ps1')

function NeedReplace([string]$text,[string]$needle,[string]$replacement,[string]$reason){
  if(-not $text.Contains($needle)){throw $reason}
  return $text.Replace($needle,$replacement)
}

try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND V15 - TRUE BLIND40 HOLDOUT' -ForegroundColor Cyan
  Write-Host 'FROZEN BEFORE MODEL RUN / 8192 / JSON SCHEMA / NO CHUNKS' -ForegroundColor Cyan
  Write-Host 'Gmail GET-only / BuyFlow production OFF' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'A helyes cimkek NINCSENEK a modell futtatojaban.' -ForegroundColor Yellow
  Write-Host ''

  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp -TimeoutSec 30
  $raw=Get-Content -Raw -LiteralPath $tmp

  # Same compatibility fixes as the successful V14/V15 harness.
  $oldGuard=@'
  if($text -match '\$health\.adapter_sha256' -or $text -match 'BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256'){
'@
  $newGuard=@'
  if($text -match '\$health\.adapter_sha256'){
'@
  $raw=NeedReplace $raw $oldGuard $newGuard 'EXPECTED_BLIND40_GUARD_NOT_FOUND'
  $raw=NeedReplace $raw 'fetch --depth=10 origin' 'fetch --depth=50 origin' 'EXPECTED_BLIND40_FETCH_DEPTH_NOT_FOUND'

  # Pin V15 code/runtime, but call the label-free BLIND40 wrapper.
  $raw=NeedReplace $raw "`$codeCommit='c1632945f43dd1ce9d3c8116993adf2d78dfcc7d'" "`$codeCommit='$coreCommit'" 'EXPECTED_BLIND40_CORE_COMMIT_NOT_FOUND'
  $raw=NeedReplace $raw 'scripts\eventmind-ollama-gemma3-12b-gated-v14-runtime.mjs' 'scripts\eventmind-ollama-gemma3-12b-gated-v15-runtime.mjs' 'EXPECTED_BLIND40_RUNTIME_PATH_NOT_FOUND'
  $raw=NeedReplace $raw 'src\scripts\eventmind-v14-gemma-gated-real-gmail-dev120.ts' 'src\scripts\eventmind-v15-gemma-gated-blind40-wrapper.ts' 'EXPECTED_BLIND40_TS_RUNNER_NOT_FOUND'

  # Inject the 40-case count + frozen raw-ID SHA into the generated base harness.
  # Raw Gmail IDs remain local; only this SHA is public.
  $anchor='  # Separate checkpoint/report names so no previous run can contaminate this one.'
  $blindPatch=@'
  # BLIND40 base-harness validation: frozen locally before model run.
  $text=NeedReplace $text '  if($ids.Count -ne 120){Fail "EXPECTED_120_IDS_GOT_$($ids.Count)"}' '  if($ids.Count -ne 40){Fail "EXPECTED_40_IDS_GOT_$($ids.Count)"}' 'EXPECTED_BLIND40_COUNT_GUARD_NOT_FOUND'
  $text=NeedReplace $text '  [string]$ExpectedIdSha256 = ''88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470''' '  [string]$ExpectedIdSha256 = ''61ea05f5f7bd7fbf786a824d61b18108a84ab5b994a11442b9e04d3b407058c0''' 'EXPECTED_BLIND40_SHA_GUARD_NOT_FOUND'
  $text=$text.Replace('Progress: $attempted / 120','Progress: $attempted / 40')
'@
  $raw=NeedReplace $raw $anchor ($blindPatch + "`r`n`r`n" + $anchor) 'EXPECTED_BLIND40_INJECTION_ANCHOR_NOT_FOUND'

  # Separate checkpoint/report namespace; never touch REAL120/V15 checkpoint.
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-CHECKPOINT.json','BuyFlow-EVENTMIND-BLIND40-GEMMA3-V15-CHECKPOINT.json')
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-$stamp.json','BuyFlow-EVENTMIND-BLIND40-GEMMA3-V15-$stamp.json')
  $raw=$raw.Replace('BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-V2-RUNTIME-$stamp.jsonl','BuyFlow-EVENTMIND-BLIND40-GEMMA3-V15-RUNTIME-$stamp.jsonl')

  $raw=$raw.Replace('BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER','BUYFLOW EVENTMIND V15 - TRUE BLIND40 HOLDOUT')
  $raw=$raw.Replace('Baseline to beat: Gemma V4 FULL = 44/120','Frozen holdout: 40 unseen Gmail / labels fixed before run')
  $raw=$raw.Replace('REAL120 GEMMA V14 GATED V2: COMPLETE','BLIND40 GEMMA V15: COMPLETE')
  $raw=$raw.Replace('Runtime: Ollama gemma3:12b | buyer gate -> event | 8192 context | JSON Schema','Runtime: Ollama gemma3:12b | V15 frozen | TRUE BLIND40 | 8192 | JSON Schema')
  $raw=$raw.Replace('REAL120 CHUNK+JUDGE BLOCKED/FAIL','BLIND40 BLOCKED/FAIL')
  $raw=$raw.Replace('REAL120_RUNNER_UNEXPECTED_EXIT','BLIND40_RUNNER_UNEXPECTED_EXIT')

  Set-Content -LiteralPath $tmp -Value $raw -Encoding UTF8
  . $tmp -IdFile $IdFile
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}
