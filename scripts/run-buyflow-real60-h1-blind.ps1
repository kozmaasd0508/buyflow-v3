$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$generatorCommit='1135a9c42237b66451ec58474de5209b16fd9732'
$generatorUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$generatorCommit/apps/api/src/scripts/buyflow-real60-h1-blind-bundle.ts"
$idFile=Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json'
$nodePath='C:\Program Files\nodejs\node.exe'
$n8nScript=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$credentialId='FqG6EUXZPfOERjkV'
$tempRoot=Join-Path $env:TEMP ('buyflow-real60-h1-' + [guid]::NewGuid().ToString('N'))
$credentialPath=Join-Path $tempRoot 'credential.json'
$runnerPath=$null
$originalN8nUserFolder=$env:N8N_USER_FOLDER

function Fail([string]$m){throw $m}
function As-Array($v){if($null -eq $v){return @()};if($v -is [System.Array]){return @($v)};return @($v)}
function Get-PropertyValue($o,[string[]]$names){
  if($null -eq $o){return $null}
  foreach($name in $names){
    $p=$o.PSObject.Properties[$name]
    if($null -ne $p -and $null -ne $p.Value){
      if($p.Value -isnot [string] -or -not [string]::IsNullOrWhiteSpace([string]$p.Value)){return $p.Value}
    }
  }
  return $null
}
function Is-BuyFlowRepo([string]$p){
  return (Test-Path -LiteralPath (Join-Path $p 'apps\api\package.json')) -and
         (Test-Path -LiteralPath (Join-Path $p 'apps\api\src\email\normalize-document-v1.ts')) -and
         (Test-Path -LiteralPath (Join-Path $p 'node_modules'))
}
function Find-RepoRoot{
  $desktop=Join-Path $env:USERPROFILE 'Desktop'
  $known=@(
    (Join-Path $desktop 'buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
    (Join-Path $desktop 'buyflow\buyflow-v3'),
    (Join-Path $desktop 'buyflow\V11_INPUT_VIEW_HOLDOUT_V2')
  )
  foreach($p in $known){if(Is-BuyFlowRepo $p){return $p}}
  $roots=@((Join-Path $desktop 'buyflow'),(Join-Path $desktop 'Buyflow minden')) | Where-Object {Test-Path -LiteralPath $_}
  foreach($root in $roots){
    $candidate=Get-ChildItem -LiteralPath $root -Directory -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object { Is-BuyFlowRepo $_.FullName } |
      Select-Object -First 1
    if($candidate){return $candidate.FullName}
  }
  return $null
}
function Parse-TokenData($data){
  $tokenData=Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
  if(-not $tokenData){return $null}
  if($tokenData -is [string]){try{return ($tokenData|ConvertFrom-Json)}catch{return $null}}
  return $tokenData
}

New-Item -ItemType Directory -Force -Path $tempRoot|Out-Null
try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW REAL60 H1 - FRESH BLIND HOLDOUT' -ForegroundColor Cyan
  Write-Host '60 fresh purchase emails selected without reading content.' -ForegroundColor Green
  Write-Host 'REAL120 IDs + threads excluded; one message per thread.' -ForegroundColor Green
  Write-Host 'NO OpenAI calls. Gmail GET only. BuyFlow writes 0.' -ForegroundColor Green
  Write-Host 'Prompt V2 frozen. Production OFF. Blind O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  if(-not (Test-Path -LiteralPath $idFile)){Fail "REAL120_ID_FILE_NOT_FOUND:$idFile"}
  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nScript)){Fail 'N8N_RUNTIME_NOT_FOUND'}

  $repoRoot=Find-RepoRoot
  if(-not $repoRoot){Fail 'BUYFLOW_REPO_NOT_FOUND'}
  Write-Host ('BuyFlow repo: '+$repoRoot) -ForegroundColor DarkGray

  $preferredBase=Join-Path $env:USERPROFILE 'Desktop\Buyflow minden'
  if(-not (Test-Path -LiteralPath $preferredBase)){$preferredBase=Join-Path $env:USERPROFILE 'Desktop'}
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $outDir=Join-Path $preferredBase ('buyflow-real60-h1-'+$stamp)
  New-Item -ItemType Directory -Force -Path $outDir|Out-Null

  Write-Host '[1/3] Gmail OAuth token...' -ForegroundColor Yellow
  $env:N8N_USER_FOLDER=$n8nUserFolder
  $out=& $nodePath $n8nScript export:credentials "--id=$credentialId" --decrypted "--output=$credentialPath" 2>&1
  if($LASTEXITCODE -ne 0){Fail ('N8N_CREDENTIAL_EXPORT_FAILED: '+($out -join "`n"))}
  $credential=(As-Array ((Get-Content -Raw -LiteralPath $credentialPath)|ConvertFrom-Json)|Select-Object -First 1)
  $data=Get-PropertyValue $credential @('data')
  if($null -eq $data){Fail 'GMAIL_CREDENTIAL_DATA_MISSING'}
  $clientId=[string](Get-PropertyValue $data @('clientId','client_id'))
  $clientSecret=[string](Get-PropertyValue $data @('clientSecret','client_secret'))
  $refreshToken=[string](Get-PropertyValue $data @('refreshToken','refresh_token'))
  $parsed=Parse-TokenData $data
  if(-not $refreshToken -and $parsed){$refreshToken=[string](Get-PropertyValue $parsed @('refresh_token','refreshToken'))}
  if(-not $clientId -or -not $clientSecret -or -not $refreshToken){Fail 'GMAIL_OAUTH_DATA_INCOMPLETE'}
  $tokenResponse=Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
    client_id=$clientId;client_secret=$clientSecret;refresh_token=$refreshToken;grant_type='refresh_token'
  } -TimeoutSec 30
  $accessToken=[string](Get-PropertyValue $tokenResponse @('access_token'))
  if([string]::IsNullOrWhiteSpace($accessToken)){Fail 'GMAIL_ACCESS_TOKEN_MISSING'}
  $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken
  Write-Host 'Gmail token: OK' -ForegroundColor Green

  Write-Host '[2/3] Fresh holdout generator...' -ForegroundColor Yellow
  $runnerPath=Join-Path $repoRoot 'apps\api\src\scripts\__buyflow-real60-h1-temp.ts'
  Invoke-WebRequest -UseBasicParsing -Uri $generatorUrl -OutFile $runnerPath -TimeoutSec 60

  Write-Host '[3/3] Freeze 60 unseen MailLens cases...' -ForegroundColor Yellow
  Push-Location (Join-Path $repoRoot 'apps\api')
  try {
    & npm.cmd exec -- tsx $runnerPath $idFile $outDir
    $exit=$LASTEXITCODE
  } finally { Pop-Location }
  if($exit -ne 0){Fail "REAL60_H1_EXIT_$exit"}

  $bundle=Join-Path $outDir 'real60-h1-blind-bundle-private-local.json'
  if(-not (Test-Path -LiteralPath $bundle)){Fail 'REAL60_H1_BUNDLE_NOT_CREATED'}

  Write-Host ''
  Write-Host 'KESZ. Most meg NEM futott AI.' -ForegroundColor Green
  Write-Host ('Toltsd fel ide CSAK ezt a fajlt: '+$bundle) -ForegroundColor Cyan
  Write-Host 'A private ID fajlt ne toltsd fel. O3 tovabbra is erintetlen.' -ForegroundColor Yellow
}
finally {
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  if($runnerPath -and (Test-Path -LiteralPath $runnerPath)){Remove-Item -LiteralPath $runnerPath -Force -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $credentialPath){try{Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue}catch{}}
  if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalN8nUserFolder){Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue}else{$env:N8N_USER_FOLDER=$originalN8nUserFolder}
}
