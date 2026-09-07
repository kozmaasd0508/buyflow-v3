$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$bundleCommit='bfa77723f94439ecd7ce256c016046ad0e3f1c3e'
$bundleUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$bundleCommit/apps/api/src/scripts/buyflow-real120-blind-adjudication-bundle.ts"
$idFile=Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json'
$nodePath='C:\Program Files\nodejs\node.exe'
$n8nScript=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$credentialId='FqG6EUXZPfOERjkV'
$tempRoot=Join-Path $env:TEMP ('buyflow-real120-blind-' + [guid]::NewGuid().ToString('N'))
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
  return (Test-Path -LiteralPath (Join-Path $p 'apps\api\package.json')) -and (Test-Path -LiteralPath (Join-Path $p 'apps\api\src\email\normalize-document-v1.ts'))
}
function Find-RepoRoot{
  $base=Join-Path $env:USERPROFILE 'Desktop\buyflow'
  if(-not (Test-Path -LiteralPath $base)){return $null}
  $known=@(
    (Join-Path $base '01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
    (Join-Path $base 'buyflow-v3'),
    (Join-Path $base 'V11_INPUT_VIEW_HOLDOUT_V2')
  )
  foreach($p in $known){if(Is-BuyFlowRepo $p -and (Test-Path -LiteralPath (Join-Path $p 'node_modules'))){return $p}}
  $candidates=@(Get-ChildItem -LiteralPath $base -Directory -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { Is-BuyFlowRepo $_.FullName })
  $withModules=@($candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node_modules') })
  if($withModules.Count -gt 0){return $withModules[0].FullName}
  if($candidates.Count -gt 0){return $candidates[0].FullName}
  return $null
}
function Parse-TokenData($data){
  $tokenData=Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
  if(-not $tokenData){return $null}
  if($tokenData -is [string]){try{return ($tokenData|ConvertFrom-Json)}catch{return $null}}
  return $tokenData
}

New-Item -ItemType Directory -Force -Path $tempRoot|Out-Null
try{
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW REAL120 - BLIND ADJUDICATION BUNDLE' -ForegroundColor Cyan
  Write-Host 'Only the 35 Luna/Terra disagreement cases.' -ForegroundColor Green
  Write-Host 'No OpenAI calls. Gmail GET only. BuyFlow writes 0.' -ForegroundColor Green
  Write-Host 'Production OFF. Blind O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  if(-not (Test-Path -LiteralPath $idFile)){Fail "REAL120_ID_FILE_NOT_FOUND:$idFile"}
  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nScript)){Fail 'N8N_RUNTIME_NOT_FOUND'}

  $latest=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Directory -Filter 'buyflow-real120-mail-lens-openai-*' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'predictions-private-local.json') } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if(-not $latest){Fail 'REAL120_PREDICTIONS_NOT_FOUND'}
  $predictionsPath=Join-Path $latest.FullName 'predictions-private-local.json'
  Write-Host ('REAL120 result: '+$latest.FullName) -ForegroundColor DarkGray

  $repoRoot=Find-RepoRoot
  if(-not $repoRoot){Fail 'BUYFLOW_REPO_NOT_FOUND'}
  Write-Host ('BuyFlow repo: '+$repoRoot) -ForegroundColor DarkGray

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

  Write-Host '[2/3] Blind bundle generator...' -ForegroundColor Yellow
  $runnerPath=Join-Path $repoRoot 'apps\api\src\scripts\__buyflow-real120-blind-adjudication-temp.ts'
  Invoke-WebRequest -UseBasicParsing -Uri $bundleUrl -OutFile $runnerPath -TimeoutSec 60

  Write-Host '[3/3] 35 disagreement email MailLens view...' -ForegroundColor Yellow
  Push-Location (Join-Path $repoRoot 'apps\api')
  try{
    & npm.cmd exec -- tsx $runnerPath $predictionsPath $idFile
    $exit=$LASTEXITCODE
  }finally{Pop-Location}
  if($exit -ne 0){Fail "BLIND_BUNDLE_EXIT_$exit"}

  $bundlePath=Join-Path $latest.FullName 'blind-adjudication-bundle-private-local.json'
  if(-not (Test-Path -LiteralPath $bundlePath)){Fail 'BLIND_BUNDLE_FILE_NOT_CREATED'}
  Write-Host ''
  Write-Host 'KESZ.' -ForegroundColor Green
  Write-Host ('Upload ezt a fajlt ide: '+$bundlePath) -ForegroundColor Cyan
  Write-Host 'FIGYELEM: a fajl a 35 email MailLens-szoveget tartalmazza; modellvalaszokat es nyers Gmail ID-ket nem.' -ForegroundColor Yellow
}
finally{
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  if($runnerPath -and (Test-Path -LiteralPath $runnerPath)){Remove-Item -LiteralPath $runnerPath -Force -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $credentialPath){try{Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue}catch{}}
  if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalN8nUserFolder){Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue}else{$env:N8N_USER_FOLDER=$originalN8nUserFolder}
}
