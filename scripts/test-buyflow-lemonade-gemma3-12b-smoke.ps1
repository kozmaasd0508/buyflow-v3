$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$api='http://127.0.0.1:13305'
$model='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$summaryPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-LEMONADE-SMOKE-SUMMARY.json'

function ApiGet([string]$path,[int]$timeout=30){ Invoke-RestMethod -Uri ($api+$path) -Method Get -TimeoutSec $timeout }
function ApiPost([string]$path,$body,[int]$timeout=300){ Invoke-RestMethod -Uri ($api+$path) -Method Post -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 20 -Compress) -TimeoutSec $timeout }

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - LEMONADE GEMMA 3 12B ROCm SMOKE TEST' -ForegroundColor Cyan
Write-Host '1 tiny inference only. No Gmail. No n8n write. No BuyFlow write.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$health=ApiGet '/v1/health'
if(-not $health){throw 'LEMONADE_HEALTH_FAILED'}

$modelInfo=ApiGet ('/v1/models/'+[uri]::EscapeDataString($model)) 30
if(-not $modelInfo.downloaded){throw 'MODEL_NOT_DOWNLOADED'}

$sys=ApiGet '/v1/system-info' 30
$rocmState=[string]$sys.recipes.llamacpp.backends.rocm.state
if($rocmState -ne 'installed'){throw ('ROCM_BACKEND_NOT_INSTALLED:'+ $rocmState)}

Write-Host ('Model: '+$model) -ForegroundColor DarkGray
Write-Host 'Inference indul...' -ForegroundColor Yellow
$sw=[Diagnostics.Stopwatch]::StartNew()
$body=@{
  model=$model
  messages=@(
    @{role='system';content='You are a deterministic local AI smoke test. Answer with exactly: BUYFLOW_LEMONADE_OK'}
    @{role='user';content='Return the required smoke-test token only.'}
  )
  temperature=0
  max_tokens=32
  stream=$false
}
$response=ApiPost '/v1/chat/completions' $body 300
$sw.Stop()

if(-not $response.choices -or @($response.choices).Count -lt 1){throw 'NO_CHAT_COMPLETION_CHOICES'}
$text=[string]$response.choices[0].message.content
$text=$text.Trim()
if($text -ne 'BUYFLOW_LEMONADE_OK'){
  throw ('UNEXPECTED_MODEL_OUTPUT:'+ $text)
}

$summary=[ordered]@{
  completed_at=(Get-Date).ToString('o')
  model=$model
  lemonade_api=$api
  expected='BUYFLOW_LEMONADE_OK'
  actual=$text
  exact_match=($text -eq 'BUYFLOW_LEMONADE_OK')
  elapsed_ms=[math]::Round($sw.Elapsed.TotalMilliseconds,1)
  rocm_backend_state=$rocmState
  gmail_touched=$false
  n8n_changed=$false
  buyflow_changed=$false
  production_changed=$false
}
$summary|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'LEMONADE SMOKE TEST: PASS' -ForegroundColor Green
Write-Host ('Output: '+$text) -ForegroundColor Cyan
Write-Host ('Elapsed: '+$summary.elapsed_ms+' ms') -ForegroundColor Cyan
Write-Host ('Summary: '+$summaryPath) -ForegroundColor DarkGray
Write-Host 'Gmail: untouched | n8n: unchanged | BuyFlow writes: 0' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
