$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$api='http://127.0.0.1:13305'
$model='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$repo='ggml-org/gemma-3-12b-it-GGUF'
$variant='Q4_K_M'
$checkpoint=($repo+':'+$variant)
$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-LEMONADE-GEMMA3-12B-SUMMARY.json'

function ApiGet([string]$path,[int]$timeout=30){ Invoke-RestMethod -Uri ($api+$path) -Method Get -TimeoutSec $timeout }
function ApiPost([string]$path,$body,[int]$timeout=1800){ Invoke-RestMethod -Uri ($api+$path) -Method Post -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 20 -Compress) -TimeoutSec $timeout }
function HasProp($obj,[string]$name){ return ($null -ne $obj -and $null -ne $obj.PSObject.Properties[$name]) }
function GetDownloaded($obj){ if(HasProp $obj 'downloaded'){ return [bool]$obj.downloaded }; return $false }

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - LEMONADE GEMMA 3 12B Q4_K_M DOWNLOAD V5' -ForegroundColor Cyan
Write-Host 'Safe resume/check + official ggml-org repo + ROCm/8192 config.' -ForegroundColor Green
Write-Host 'No inference. No n8n change. Ollama unchanged.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$health=ApiGet '/v1/health'
if(-not $health){throw 'LEMONADE_HEALTH_FAILED'}
$sys=ApiGet '/v1/system-info'
$rocmState=$sys.recipes.llamacpp.backends.rocm.state
if([string]$rocmState -ne 'installed'){throw ('ROCM_BACKEND_NOT_INSTALLED:'+[string]$rocmState)}

Write-Host ('Q4_K_M varians ellenorzese: '+$repo) -ForegroundColor Yellow
$variantsPath='/v1/pull/variants?checkpoint='+[uri]::EscapeDataString($repo)
$variants=ApiGet $variantsPath 60
$match=@($variants.variants|Where-Object{[string]$_.name -ieq $variant})
if($match.Count -lt 1){
  $available=@($variants.variants|ForEach-Object{[string]$_.name}) -join ', '
  throw ('Q4_K_M_VARIANT_NOT_FOUND. AVAILABLE='+$available)
}
$primaryFile=[string]$match[0].primary_file
$sizeBytes=[double]$match[0].size_bytes
Write-Host ('Variant READY: '+$variant+' -> '+$primaryFile) -ForegroundColor Green
if($sizeBytes -gt 0){Write-Host ("Meret: {0:N2} GB" -f ($sizeBytes/1GB)) -ForegroundColor DarkGray}
Write-Host ('Registry model name: '+$model) -ForegroundColor DarkGray

$existing=$null
try{$existing=ApiGet ('/v1/models/'+[uri]::EscapeDataString($model))}catch{}
if(GetDownloaded $existing){
  Write-Host 'Model mar teljesen le van toltve; letoltes kihagyva.' -ForegroundColor Green
}else{
  Write-Host 'Model nincs meg teljesen; letoltes/resume indul (~6.8 GB)...' -ForegroundColor Yellow
  Write-Host ('Checkpoint: '+$checkpoint) -ForegroundColor DarkGray
  $pull=@{
    model_name=$model
    checkpoint=$checkpoint
    recipe='llamacpp'
    source='huggingface'
    stream=$false
  }
  $result=ApiPost '/v1/pull' $pull 7200
  if(HasProp $result 'error'){
    $errText=[string]$result.error
    if(-not [string]::IsNullOrWhiteSpace($errText)){
      throw ('MODEL_PULL_FAILED:'+($result.error|ConvertTo-Json -Compress))
    }
  }
  Write-Host 'Pull API visszatert; registry allapot ellenorzese...' -ForegroundColor Green
}

$check=$null
for($i=0;$i -lt 10;$i++){
  try{$check=ApiGet ('/v1/models/'+[uri]::EscapeDataString($model))}catch{$check=$null}
  if(GetDownloaded $check){break}
  Start-Sleep -Seconds 2
}
if(-not (GetDownloaded $check)){throw 'MODEL_NOT_DOWNLOADED_AFTER_PULL'}
Write-Host 'Model download status: READY.' -ForegroundColor Green

Write-Host 'ROCm + 8192 context beallitasa...' -ForegroundColor Yellow
$options=ApiPost ('/v1/models/'+[uri]::EscapeDataString($model)+'/options') @{ctx_size=8192;llamacpp_backend='rocm'} 60
if(-not (HasProp $options 'effective')){throw 'MODEL_OPTIONS_RESPONSE_MISSING_EFFECTIVE'}
if([int]$options.effective.ctx_size -ne 8192){throw ('CTX_SAVE_FAILED:'+[string]$options.effective.ctx_size)}
if([string]$options.effective.llamacpp_backend -ne 'rocm'){throw ('ROCM_SAVE_FAILED:'+[string]$options.effective.llamacpp_backend)}

$sizeValue=$null
if(HasProp $check 'size'){$sizeValue=$check.size}
$summary=[ordered]@{
  completed_at=(Get-Date).ToString('o')
  model_id=$model
  repository=$repo
  variant=$variant
  resolved_primary_file=$primaryFile
  checkpoint=$checkpoint
  recipe='llamacpp'
  backend='rocm'
  context_tokens=8192
  downloaded=$true
  size_gb=$sizeValue
  openai_base="$api/v1"
  inference_started=$false
  n8n_changed=$false
  ollama_changed=$false
  stale_registry_entry_preserved=$true
}
$summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'LEMONADE MODEL: READY' -ForegroundColor Green
Write-Host ('Model: '+$model) -ForegroundColor Cyan
Write-Host ('Resolved file: '+$primaryFile) -ForegroundColor Cyan
Write-Host 'Backend: ROCm | Context: 8192' -ForegroundColor Cyan
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'Inference: NEM indult | n8n: valtozatlan | Ollama: valtozatlan' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
