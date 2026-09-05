$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$apiBase='http://127.0.0.1:13305'
$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-LEMONADE-SETUP-SUMMARY.json'
$systemInfoPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-LEMONADE-SYSTEM-INFO.json'

function ApiGet([string]$path){
  return Invoke-RestMethod -Uri ($apiBase+$path) -Method Get -TimeoutSec 30
}
function ApiPost([string]$path,[hashtable]$body){
  $json=$body|ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri ($apiBase+$path) -Method Post -ContentType 'application/json' -Body $json -TimeoutSec 1800
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'BUYFLOW - LEMONADE AMD BACKEND RESUME' -ForegroundColor Green
Write-Host 'CLI nelkul, kozvetlen Lemonade HTTP API-val' -ForegroundColor Yellow
Write-Host '==============================================================' -ForegroundColor Green

try{$null=ApiGet '/v1/models'}catch{throw 'LEMONADE_API_NOT_READY'}
Write-Host ('Lemonade API READY: '+$apiBase) -ForegroundColor Green

$systemInfo=ApiGet '/v1/system-info'
$systemInfo|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $systemInfoPath -Encoding UTF8
Write-Host ('System info: '+$systemInfoPath) -ForegroundColor DarkGray

$backend=$null
$rocmError=$null
Write-Host ''
Write-Host 'ROCm backend telepitese...' -ForegroundColor Yellow
try{
  $null=ApiPost '/v1/install' @{recipe='llamacpp';backend='rocm';stream=$false;force=$false}
  $backend='llamacpp:rocm'
  Write-Host 'ROCm backend READY.' -ForegroundColor Green
}catch{
  $rocmError=$_.Exception.Message
  Write-Host ('ROCm nem hasznalhato ezen a konfiguracion: '+$rocmError) -ForegroundColor Yellow
}

if(-not $backend){
  Write-Host 'Vulkan fallback telepitese...' -ForegroundColor Yellow
  try{
    $null=ApiPost '/v1/install' @{recipe='llamacpp';backend='vulkan';stream=$false;force=$false}
    $backend='llamacpp:vulkan'
    Write-Host 'Vulkan backend READY.' -ForegroundColor Green
  }catch{
    throw ('LEMONADE_VULKAN_BACKEND_INSTALL_FAILED: '+$_.Exception.Message)
  }
}

$models=ApiGet '/v1/models?show_all=true'
$modelCount=if($models.data){@($models.data).Count}else{0}

$summary=[ordered]@{
  completed_at=(Get-Date).ToString('o')
  lemonade_api=$apiBase
  openai_compatible_base="$apiBase/v1"
  gpu_backend=$backend
  rocm_attempt_error=$rocmError
  n8n_changed=$false
  ollama_changed=$false
  model_download_started=$false
  visible_catalog_models=$modelCount
  system_info_file=$systemInfoPath
  next_step='After V16 finishes, choose a fixed model and test Lemonade in n8n/BuyFlow.'
}
$summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'LEMONADE AMD BACKEND: READY' -ForegroundColor Green
Write-Host ('Backend: '+$backend) -ForegroundColor Cyan
Write-Host ('API: '+$apiBase) -ForegroundColor Cyan
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'Ollama: valtozatlan | n8n: valtozatlan | modelletoltes: NEM indult' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
