param([string]$BundlePath)
$ErrorActionPreference = 'Stop'

$repo = 'kozmaasd0508/buyflow-v3'
$predictorCommit = 'c47c9f13b713e667a7398f55010994154107e1c0'
$goldCommit = 'a5c54940643374803ba344a4014ba44ae183e240'
$resolutionCommit = '101a982449ef100e9f319296056755bf9b6744fb'
$promptCommit = 'ba42c38974537d9994966a34c74f09b24b6aeddd'
$policyCommit = '7d65ea51bc9923b9139458f3f2416a78298ec0e9'
$expectedSelectionSha = '59650c8dbb687be609361b3e3576a404f9acdba5ea13f71985dcd0dc2451b04f'

$work = Join-Path $env:TEMP 'buyflow-h3-v33-regression100'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$predictor = Join-Path $work 'buyflow-h3-prompt-v33-luna-regression100.mjs'
$gold = Join-Path $work 'buyflow-real100-h3-gold-v1-pre-luna.json'
$resolution = Join-Path $work 'buyflow-real100-h3-review-resolution-v33.json'
$prompt = Join-Path $work 'buyflow-email-prompt-v3.3.txt'
$policy = Join-Path $work 'buyflow-email-policy-v3.3-post-h3.md'

function Get-Raw([string]$commit,[string]$path,[string]$out) {
  $u = "https://raw.githubusercontent.com/$repo/$commit/$path"
  Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $out
  if (-not (Test-Path $out) -or (Get-Item $out).Length -lt 20) { throw "DOWNLOAD_INVALID: $path" }
}

Get-Raw $predictorCommit 'scripts/buyflow-h3-prompt-v33-luna-regression100.mjs' $predictor
Get-Raw $goldCommit 'benchmarks/buyflow-real100-h3-gold-v1-pre-luna.json' $gold
Get-Raw $resolutionCommit 'benchmarks/buyflow-real100-h3-review-resolution-v33.json' $resolution
Get-Raw $promptCommit 'benchmarks/buyflow-email-prompt-v3.3.txt' $prompt
Get-Raw $policyCommit 'benchmarks/buyflow-email-policy-v3.3-post-h3.md' $policy

$promptText = Get-Content -Raw -LiteralPath $prompt
if ($promptText -match 'H3-\d{3}') { throw 'PROMPT_LEAK: runtime prompt contains H3 case IDs' }
if ($promptText -notmatch 'DELAYED') { throw 'PROMPT_INVALID: DELAYED missing' }

$g = Get-Content -Raw -LiteralPath $gold | ConvertFrom-Json
$r = Get-Content -Raw -LiteralPath $resolution | ConvertFrom-Json
if ($g.selection_sha256 -ne $expectedSelectionSha -or $g.cases.Count -ne 100) { throw 'GOLD_VERIFICATION_FAILED' }
if ($r.selection_sha256 -ne $expectedSelectionSha -or $r.cases.Count -ne 11) { throw 'RESOLUTION_VERIFICATION_FAILED' }

function Test-H3Bundle([string]$p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p)) { return $false }
  try {
    $b = Get-Content -Raw -LiteralPath $p | ConvertFrom-Json
    return ($b.benchmark -eq 'buyflow-real100-h3-blind-maillens-v1.1' -and $b.selection_sha256 -eq $expectedSelectionSha -and $b.cases.Count -eq 100)
  } catch { return $false }
}

if (-not (Test-H3Bundle $BundlePath)) {
  $roots = @((Get-Location).Path, (Join-Path $env:USERPROFILE 'Desktop'), (Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Documents'), $env:TEMP) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
  $found = $null
  foreach ($root in $roots) {
    $candidates = Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.json' -and ($_.Name -match 'h3' -or $_.Name -match 'real100') }
    foreach ($f in $candidates) { if (Test-H3Bundle $f.FullName) { $found = $f.FullName; break } }
    if ($found) { break }
  }
  $BundlePath = $found
}

if (-not (Test-H3Bundle $BundlePath)) {
  $BundlePath = Read-Host 'H3 bundle JSON teljes eleresi utja'
}
if (-not (Test-H3Bundle $BundlePath)) { throw 'H3_BUNDLE_NOT_FOUND_OR_INVALID' }

$out = Join-Path (Split-Path -Parent $BundlePath) 'real100-h3-prompt-v33-luna-regression100.json'

Write-Host '=============================================================='
Write-Host 'BUYFLOW H3 V3.3 - VERIFIED REGRESSION LAUNCH'
Write-Host "Bundle: $BundlePath"
Write-Host "Selection SHA: $expectedSelectionSha"
Write-Host "Policy commit: $policyCommit"
Write-Host "Prompt commit: $promptCommit"
Write-Host "Resolution commit: $resolutionCommit"
Write-Host "Gold commit: $goldCommit"
Write-Host "Predictor commit: $predictorCommit"
Write-Host 'Runtime prompt H3 case IDs: 0 (verified)'
Write-Host 'H3 is SPENT | Production OFF | O3 NOT USED | BuyFlow writes 0'
Write-Host '=============================================================='
Write-Host 'Artifact SHA256:'
@($predictor,$gold,$resolution,$prompt,$policy) | ForEach-Object { $h=Get-FileHash -Algorithm SHA256 -LiteralPath $_; Write-Host ("{0}  {1}" -f $h.Hash,$_.ToString()) }

$sec = Read-Host 'OpenAI API key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

try {
  & node $predictor $BundlePath $gold $resolution $prompt $out
  if ($LASTEXITCODE -ne 0) { throw "PREDICTOR_EXIT_$LASTEXITCODE" }
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
}

$s = Get-Content -Raw -LiteralPath $out | ConvertFrom-Json
$receiptPass = ($s.total -eq 100 -and $s.exact -eq 100 -and $s.technical_errors -eq 0 -and $s.model_calls -eq 99 -and $s.deterministic_input_gate_reviews -eq 1 -and $s.safety.gmail_calls -eq 0 -and $s.safety.buyflow_writes -eq 0 -and $s.safety.lifecycle_writes -eq 0 -and $s.safety.production_off -eq $true -and $s.safety.blind_o3_used -eq $false -and $s.safety.openai_store -eq $false)

$receipt = [ordered]@{
  evidence_receipt = $(if ($receiptPass) { 'PASS' } else { 'FAIL' })
  benchmark = $s.benchmark
  exact = "$($s.exact)/$($s.total)"
  exact_pct = $s.exact_pct
  technical_errors = $s.technical_errors
  model_calls = $s.model_calls
  deterministic_input_gate_reviews = $s.deterministic_input_gate_reviews
  runtime_prompt_contains_h3_case_ids = $false
  selection_sha256 = $s.selection_sha256
  policy_commit = $policyCommit
  prompt_commit = $promptCommit
  resolution_commit = $resolutionCommit
  gold_commit = $goldCommit
  predictor_commit = $predictorCommit
  gmail_calls = $s.safety.gmail_calls
  buyflow_writes = $s.safety.buyflow_writes
  lifecycle_writes = $s.safety.lifecycle_writes
  production_off = $s.safety.production_off
  blind_o3_used = $s.safety.blind_o3_used
  result = $out
}
Write-Host ''
Write-Host '================ EVIDENCE RECEIPT ================'
$receipt | ConvertTo-Json -Depth 4
Write-Host '=================================================='
