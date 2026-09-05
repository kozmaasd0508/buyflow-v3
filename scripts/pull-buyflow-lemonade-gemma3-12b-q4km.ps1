$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$api='http://127.0.0.1:13305'
$model='user.BuyFlow-Gemma-3-12B-Q4_K_M'
$checkpoint='tensorblock/gemma-3-12b-it-GGUF:gemma-3-12b-it-Q4_K_M.gguf'
$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-LEMONADE-GEMMA3-12B-SUMMARY.json'

function ApiGet([string]$path){ Invoke-RestMethod -Uri ($api+$path) -Method Get -TimeoutSec 30 }
function ApiPost([string]$path,$body,[int]$timeout=1800){ Invoke-RestMethod -Uri ($api+$path) -Method Post -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 20 -Compress) -TimeoutSec $timeout }

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - LEMONADE GEMMA 3 12B Q4_K_M DOWNLOAD' -ForegroundColor Cyan
Write-Host 'Download only + ROCm/8192 config. No inference. No n8n change.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$health=ApiGet '/v1/health'
if(-not $health){throw 'LEMONADE_HEALTH_FAILED'}
$sys=ApiGet '/v1/system-info'
$rocmState=$sys.recipes.llamacpp.backends.rocm.state
if([string]$rocmState -ne 'installed'){throw ('ROCM_BACKEND_NOT_INSTALLED:'+[string]$rocmState)}

$existing=$null
try{$existing=ApiGet ('/v1/models/'+[uri]::EscapeDataString($model))}catch{}
if($existing -and $existing.downloaded -eq $true){
  Write-Host 'Model mar le van toltve; letoltes kihagyva.' -ForegroundColor Green
}else{
  Write-Host 'Model letoltese indul: Gemma 3 12B Q4_K_M (~7.3 GB)...' -ForegroundColor Yellow
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
$check=ApiGet ('/v1/models/'+[uri]::EscapeDataString($model))
if($check.downloaded -ne $true){throw 'MODEL_NOT_DOWNLOADED_AFTER_PULL'}

$summary=[ordered]@{
  completed_at=(Get-Date).ToString('o')
  model_id=$model
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
}
$summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'LEMONADE MODEL: READY' -ForegroundColor Green
Write-Host ('Model: '+$model) -ForegroundColor Cyan
Write-Host 'Backend: ROCm | Context: 8192' -ForegroundColor Cyan
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'Inference: NEM indult | n8n: valtozatlan | Ollama: valtozatlan' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
