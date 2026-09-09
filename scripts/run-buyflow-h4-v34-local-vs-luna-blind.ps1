$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$repo='kozmaasd0508/buyflow-v3'
$predictorCommit='1cafacddc14cb416c266e54f82548cdad309609c'
$goldCommit='385aa15d1978fa1941bf3a962fcb9095da44d657'
$promptCommit='25810f66af0855fbc81d913872072d42d75a0abb'
$selectionSha='ab0104762feaf0b1c05e871a92321060f97eb20bd9edbf6cdf1d3aa1c525caa9'
$localModel=if($env:BUYFLOW_LOCAL_MODEL){$env:BUYFLOW_LOCAL_MODEL}else{'gpt-oss:20b'}
$work=Join-Path $env:TEMP ('buyflow-h4-compare-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work|Out-Null
$predictor=Join-Path $work 'buyflow-h4-v34-local-vs-luna-blind.mjs'
$gold=Join-Path $work 'buyflow-real100-h4-gold-v1-pre-model.json'
$prompt=Join-Path $work 'buyflow-email-prompt-v3.4.txt'

function Get-Raw([string]$commit,[string]$path,[string]$out){
  $u="https://raw.githubusercontent.com/$repo/$commit/$path"
  Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $out -TimeoutSec 60
  if(-not(Test-Path -LiteralPath $out) -or (Get-Item -LiteralPath $out).Length -lt 20){throw "DOWNLOAD_INVALID:$path"}
}
function Find-H4Bundle{
  $roots=@((Join-Path $env:USERPROFILE 'Desktop'),(Join-Path $env:USERPROFILE 'Documents'),(Join-Path $env:USERPROFILE 'Downloads'))|Where-Object{Test-Path -LiteralPath $_}
  foreach($r in $roots){
    $fs=Get-ChildItem -LiteralPath $r -Recurse -File -Filter 'real100-h4-blind-bundle-maillens-v1.2-private-local.json' -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending
    foreach($f in $fs){
      try{$b=Get-Content -Raw -LiteralPath $f.FullName|ConvertFrom-Json;if($b.selection_sha256 -eq $selectionSha -and $b.total -eq 100){return $f.FullName}}catch{}
    }
  }
  return $null
}

try{
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW H4 - FRESH BLIND LOCAL AI vs LUNA' -ForegroundColor Cyan
  Write-Host 'Both prediction artifacts freeze BEFORE scoring is revealed.' -ForegroundColor Green
  Write-Host 'Production OFF | Gmail 0 | BuyFlow writes 0 | O3 NOT USED' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  if(-not(Get-Command node -ErrorAction SilentlyContinue)){throw 'NODE_NOT_FOUND'}
  Write-Host '[1/5] Verify Ollama + local model...' -ForegroundColor Yellow
  try{$tags=Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 15}catch{throw 'OLLAMA_NOT_RUNNING'}
  $names=@($tags.models|ForEach-Object{$_.name})
  if($names -notcontains $localModel){throw ("LOCAL_MODEL_NOT_FOUND:$localModel available="+($names -join ','))}
  Write-Host ("  local model: $localModel") -ForegroundColor Green

  Write-Host '[2/5] Download pinned predictor/gold/prompt...' -ForegroundColor Yellow
  Get-Raw $predictorCommit 'scripts/buyflow-h4-v34-local-vs-luna-blind.mjs' $predictor
  Get-Raw $goldCommit 'benchmarks/buyflow-real100-h4-gold-v1-pre-model.json' $gold
  Get-Raw $promptCommit 'scripts/buyflow-email-prompt-v3.4.txt' $prompt
  & node --check $predictor
  if($LASTEXITCODE -ne 0){throw 'PREDICTOR_SYNTAX_INVALID'}
  $g=Get-Content -Raw -LiteralPath $gold|ConvertFrom-Json
  if($g.selection_sha256 -ne $selectionSha -or $g.gold_count -ne 96 -or $g.review_count -ne 4){throw 'GOLD_VERIFICATION_FAILED'}
  if($g.adjudication.local_ai_predictions_seen -ne $false -or $g.adjudication.luna_predictions_seen -ne $false){throw 'GOLD_NOT_PRE_MODEL'}

  Write-Host '[3/5] Locate frozen H4 bundle...' -ForegroundColor Yellow
  $bundle=Find-H4Bundle
  if(-not $bundle){$bundle=Read-Host 'H4 bundle JSON teljes eleresi utja'}
  if(-not(Test-Path -LiteralPath $bundle)){throw 'H4_BUNDLE_NOT_FOUND'}
  $b=Get-Content -Raw -LiteralPath $bundle|ConvertFrom-Json
  if($b.selection_sha256 -ne $selectionSha -or $b.total -ne 100 -or $b.gold_labels_included -ne $false){throw 'H4_BUNDLE_VERIFICATION_FAILED'}
  Write-Host ("  bundle: $bundle") -ForegroundColor DarkGray
  Write-Host ("  selection SHA: $selectionSha") -ForegroundColor DarkGray
  Write-Host ("  gold commit: $goldCommit") -ForegroundColor DarkGray
  Write-Host ("  predictor commit: $predictorCommit") -ForegroundColor DarkGray

  Write-Host '[4/5] OpenAI API key...' -ForegroundColor Yellow
  $sec=Read-Host 'OpenAI API key' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try{$env:OPENAI_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  $env:BUYFLOW_LOCAL_MODEL=$localModel

  Write-Host '[5/5] Freeze LOCAL then LUNA, then score...' -ForegroundColor Yellow
  $outDir=Split-Path -Parent $bundle
  try{
    & node $predictor $bundle $gold $prompt $outDir
    if($LASTEXITCODE -ne 0){throw "COMPARE_EXIT_$LASTEXITCODE"}
  }finally{
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  }

  $result=Join-Path $outDir 'real100-h4-v34-local-vs-luna-blind-result.json'
  if(-not(Test-Path -LiteralPath $result)){throw 'RESULT_NOT_CREATED'}
  $r=Get-Content -Raw -LiteralPath $result|ConvertFrom-Json
  $integrity=($r.selection_sha256 -eq $selectionSha -and $r.goldable -eq 96 -and $r.review -eq 4 -and $r.safety.gmail_calls -eq 0 -and $r.safety.buyflow_writes -eq 0 -and $r.safety.lifecycle_writes -eq 0 -and $r.safety.production_off -eq $true -and $r.safety.blind_o3_used -eq $false -and $r.safety.openai_store -eq $false)
  Write-Host ''
  Write-Host '================ FINAL INTEGRITY RECEIPT ================' -ForegroundColor Cyan
  [ordered]@{
    integrity_receipt=$(if($integrity){'PASS'}else{'FAIL'})
    selection_sha256=$r.selection_sha256
    goldable=$r.goldable
    review=$r.review
    local_model=$r.local.model
    local_exact="$($r.local.exact)/$($r.local.goldable)"
    local_exact_pct=$r.local.exact_pct
    local_technical_errors=$r.local.technical_errors
    luna_model=$r.luna.model
    luna_exact="$($r.luna.exact)/$($r.luna.goldable)"
    luna_exact_pct=$r.luna.exact_pct
    luna_technical_errors=$r.luna.technical_errors
    result=$result
    result_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $result).Hash
  }|ConvertTo-Json -Depth 4
  Write-Host '=========================================================' -ForegroundColor Cyan
  if(-not $integrity){throw 'FINAL_INTEGRITY_FAILED'}
}finally{
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  if(Test-Path -LiteralPath $work){Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue}
}
