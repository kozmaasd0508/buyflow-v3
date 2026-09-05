$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$api='http://127.0.0.1:13305'
# New stable registry name. The earlier failed tensorblock attempt reserved the old name with different metadata.
$model='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$repo='ggml-org/gemma-3-12b-it-GGUF'
$variant='Q4_K_M'
$checkpoint=($repo+':'+$variant)
$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-LEMONADE-GEMMA3-12B-SUMMARY.json'

function ApiGet([string]$path,[int]$timeout=30){ Invoke-RestMethod -Uri ($api+$path) -Method Get -TimeoutSec $timeout }
function ApiPost([string]$path,$body,[int]$timeout=1800){ Invoke-RestMethod -Uri ($api+$path) -Method Post -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 20 -Compress) -TimeoutSec $timeout }

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - LEMONADE GEMMA 3 12B Q4_K_M DOWNLOAD V4' -ForegroundColor Cyan
Write-Host 'Official ggml-org repo + unique registry name + ROCm/8192 config.' -ForegroundColor Green
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
if($existing -and $existing.downloaded -eq $true){
  Write-Host 'Model mar le van toltve; letoltes kihagyva.' -ForegroundColor Green
}else{
  Write-Host 'Model letoltese indul: Gemma 3 12B Q4_K_M (~6.8 GB)...' -ForegroundColor Yellow
  Write-Host ('Checkpoint: '+$checkpoint) -ForegroundColor DarkGray
  $pull=@{
    model_name=$model
    checkpoint=$checkpoint
    recipe='llamacpp'
    source='huggingface'
    stream=$false
  }
  $result=ApiPost '/v1/pull' $pull 7200
  if($result.error){throw ('MODEL_PULL_FAILED:'+($result.error|ConvertTo-Json -Compress))}
  Write-Host 'Model letoltes kesz.' -ForegroundColor Green
}

Write-Host 'ROCm + 8192 context beallitasa...' -ForegroundColor Yellow
$options=ApiPost ('/v1/models/'+[uri]::EscapeDataString($model)+'/options') @{ctx_size=8192;llamacpp_backend='rocm'} 60
if([int]$options.effective.ctx_size -ne 8192){throw ('CTX_SAVE_FAILED:'+[string]$options.effective.ctx_size)}
if([string]$options.effective.llamacpp_backend -ne 'rocm'){throw ('ROCM_SAVE_FAILED:'+[string]$options.effective.llamacpp_backend)}

$check=ApiGet ('/v1/models/'+[uri]::EscapeDataString($model))
if($check.downloaded -ne $true){throw 'MODEL_NOT_DOWNLOADED_AFTER_PULL'}

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
  downloaded=[bool]$check.downloaded
  size_gb=$check.size
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
