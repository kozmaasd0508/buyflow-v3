$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$base='http://127.0.0.1:13305/v1'
$model='user.BuyFlow-Gemma-3-12B-Q4_K_M-ggmlorg'
$summary=Join-Path ([Environment]::GetFolderPath('Desktop')) 'BuyFlow-LEMONADE-JSON-SCHEMA-PROBE.json'

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host 'BUYFLOW - LEMONADE DIRECT JSON_SCHEMA PROBE' -ForegroundColor Cyan
Write-Host 'One tiny inference. No n8n changes. No Gmail. No BuyFlow writes.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan

$health=Invoke-RestMethod -Uri "$base/health" -Method Get -TimeoutSec 15
if(-not $health){throw 'LEMONADE_HEALTH_FAILED'}
Write-Host 'Lemonade API: READY' -ForegroundColor Green

$schema=[ordered]@{
  type='object'
  additionalProperties=$false
  properties=[ordered]@{
    event_type=[ordered]@{type='string';enum=@('PAYMENT','OTHER')}
    confidence=[ordered]@{type='number';minimum=0;maximum=1}
  }
  required=@('event_type','confidence')
}

$body=[ordered]@{
  model=$model
  messages=@(
    [ordered]@{role='system';content='Return only the required structured object. Classify the current event.'},
    [ordered]@{role='user';content='Payment successful for order A100. Transaction TX200 approved.'}
  )
  temperature=0
  stream=$false
  response_format=[ordered]@{
    type='json_schema'
    json_schema=[ordered]@{
      name='buyflow_probe'
      strict=$true
      schema=$schema
    }
  }
}

$payload=$body | ConvertTo-Json -Depth 20 -Compress
$status=$null
$responseText=$null
$errorText=$null
$accepted=$false
$schemaValid=$false
$content=$null

try {
  $r=Invoke-WebRequest -UseBasicParsing -Uri "$base/chat/completions" -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 120
  $status=[int]$r.StatusCode
  $responseText=$r.Content
  $accepted=$status -ge 200 -and $status -lt 300
  if($accepted){
    $doc=$responseText | ConvertFrom-Json
    $content=[string]$doc.choices[0].message.content
    try {
      $obj=$content | ConvertFrom-Json
      $keys=@($obj.PSObject.Properties.Name | Sort-Object)
      $expected=@('confidence','event_type')
      $schemaValid=(($keys -join ',') -eq ($expected -join ',')) -and ([string]$obj.event_type -eq 'PAYMENT') -and ([double]$obj.confidence -ge 0) -and ([double]$obj.confidence -le 1)
    } catch {
      $schemaValid=$false
    }
  }
} catch {
  if($_.Exception.Response){
    try{$status=[int]$_.Exception.Response.StatusCode}catch{}
  }
  $errorText=$_.Exception.Message
  try {
    if($_.ErrorDetails.Message){$errorText=$_.ErrorDetails.Message}
  } catch {}
}

$result=[ordered]@{
  checked_at=(Get-Date).ToString('o')
  model=$model
  endpoint="$base/chat/completions"
  response_format_type='json_schema'
  http_status=$status
  request_accepted=$accepted
  schema_valid_output=$schemaValid
  content=$content
  error=$errorText
  n8n_changed=$false
  gmail_touched=$false
  buyflow_writes=0
  production_changed=$false
}
$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $summary -Encoding UTF8

Write-Host ''
if($accepted -and $schemaValid){
  Write-Host 'LEMONADE JSON_SCHEMA CONSTRAINED PROBE: PASS' -ForegroundColor Green
  Write-Host ('Output: '+$content) -ForegroundColor Cyan
} elseif($accepted) {
  Write-Host 'LEMONADE accepted response_format=json_schema, but output did NOT satisfy the strict probe.' -ForegroundColor Yellow
  Write-Host ('Output: '+$content) -ForegroundColor Yellow
} else {
  Write-Host 'LEMONADE response_format=json_schema: NOT ACCEPTED / NOT SUPPORTED BY THIS RUNTIME' -ForegroundColor Yellow
  Write-Host ('HTTP: '+$status) -ForegroundColor Yellow
  if($errorText){Write-Host ('Error: '+$errorText) -ForegroundColor Yellow}
}
Write-Host ('Summary: '+$summary) -ForegroundColor DarkGray
Write-Host 'n8n unchanged | Gmail untouched | BuyFlow writes 0 | production unchanged' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Cyan
