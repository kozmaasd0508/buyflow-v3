$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$pinnedMailLensCommit='f69195404831323f2783464a61f6f7b7435698b5'
$generatorCommit='c5eb9161e3d397ed46b65d1b2b571e03a5bf78a5'
$generatorUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$generatorCommit/apps/api/src/scripts/buyflow-real100-h2-blind-maillens-v11-v2.ts"
$real120Ids=Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json'
$nodePath='C:\Program Files\nodejs\node.exe'
$n8nScript=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$credentialId='FqG6EUXZPfOERjkV'
$tempRoot=Join-Path $env:TEMP ('buyflow-real100-h2-v2-' + [guid]::NewGuid().ToString('N'))
$worktree=Join-Path $tempRoot 'worktree'
$credentialPath=Join-Path $tempRoot 'credential.json'
$runnerPath=$null
$repoRoot=$null
$createdWorktree=$false
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
function Parse-TokenData($data){
  $tokenData=Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
  if(-not $tokenData){return $null}
  if($tokenData -is [string]){try{return ($tokenData|ConvertFrom-Json)}catch{return $null}}
  return $tokenData
}
function Is-BuyFlowGitRepo([string]$p){
  if(-not (Test-Path -LiteralPath (Join-Path $p 'apps\api\package.json'))){return $false}
  if(-not (Test-Path -LiteralPath (Join-Path $p '.git'))){return $false}
  try {
    $origin=(& git -C $p config --get remote.origin.url 2>$null | Select-Object -First 1)
    return ([string]$origin -match 'buyflow-v3')
  } catch {return $false}
}
function Find-BuyFlowRepo{
  $desktop=Join-Path $env:USERPROFILE 'Desktop'
  $known=@(
    (Join-Path $desktop 'buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
    (Join-Path $desktop 'buyflow\buyflow-v3'),
    (Join-Path $desktop 'buyflow\.n8n-local-ai-runner\buyflow-v3'),
    (Join-Path $desktop 'buyflow\V11_INPUT_VIEW_HOLDOUT_V2')
  )
  foreach($p in $known){if(Is-BuyFlowGitRepo $p){return $p}}
  $roots=@((Join-Path $desktop 'buyflow'),(Join-Path $desktop 'Buyflow minden')) | Where-Object {Test-Path -LiteralPath $_}
  foreach($root in $roots){
    $candidate=Get-ChildItem -LiteralPath $root -Directory -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object {Is-BuyFlowGitRepo $_.FullName} | Select-Object -First 1
    if($candidate){return $candidate.FullName}
  }
  return $null
}
function Link-NodeModules([string]$source,[string]$target){
  if(-not (Test-Path -LiteralPath $source)){return $false}
  $parent=Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
  New-Item -ItemType Junction -Path $target -Target $source | Out-Null
  return $true
}

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW REAL100 H2 V2 - RESUMABLE / MAILLENS v1.1' -ForegroundColor Cyan
  Write-Host '100 real Gmail purchase emails. REAL120 + H1 excluded.' -ForegroundColor Green
  Write-Host 'Gmail 403 reason/retry handling + local checkpoints.' -ForegroundColor Green
  Write-Host 'NO Luna/OpenAI calls. BuyFlow writes 0. Production OFF. O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  if(-not (Get-Command git -ErrorAction SilentlyContinue)){Fail 'GIT_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nScript)){Fail 'N8N_RUNTIME_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $real120Ids)){Fail "REAL120_IDS_NOT_FOUND:$real120Ids"}

  $h1Ids=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real60-h1-ids-private-local.json' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if(-not $h1Ids){Fail 'H1_IDS_NOT_FOUND'}
  Write-Host ('H1 IDs: '+$h1Ids.FullName) -ForegroundColor DarkGray

  $repoRoot=Find-BuyFlowRepo
  if(-not $repoRoot){Fail 'BUYFLOW_GIT_REPO_NOT_FOUND'}
  Write-Host ('Base repo: '+$repoRoot) -ForegroundColor DarkGray

  $preferredBase=Join-Path $env:USERPROFILE 'Desktop\Buyflow minden'
  if(-not (Test-Path -LiteralPath $preferredBase)){$preferredBase=Join-Path $env:USERPROFILE 'Desktop'}
  $outDir=Join-Path $preferredBase 'buyflow-real100-h2-v2'
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  Write-Host ('H2 checkpoint folder: '+$outDir) -ForegroundColor DarkGray

  Write-Host '[1/5] Fetch pinned MailLens code...' -ForegroundColor Yellow
  & git -C $repoRoot fetch origin $pinnedMailLensCommit --depth=1 --quiet
  if($LASTEXITCODE -ne 0){Fail 'GIT_FETCH_PINNED_MAILLENS_FAILED'}

  Write-Host '[2/5] Create isolated worktree...' -ForegroundColor Yellow
  & git -C $repoRoot worktree add --detach $worktree $pinnedMailLensCommit | Out-Null
  $worktreeExit=$LASTEXITCODE
  if($worktreeExit -ne 0){Fail "GIT_WORKTREE_ADD_FAILED:$worktreeExit"}
  $createdWorktree=$true

  $normalizerPath=Join-Path $worktree 'apps\api\src\email\normalize-document-v1.ts'
  if(-not (Test-Path -LiteralPath $normalizerPath)){Fail 'PINNED_NORMALIZER_FILE_MISSING'}
  $normalizerText=[System.IO.File]::ReadAllText($normalizerPath,[System.Text.Encoding]::UTF8)
  if($normalizerText -notmatch 'normalized-email-document-v1\.1'){Fail 'PINNED_NORMALIZER_VERSION_GUARD_FAILED'}
  Write-Host ('Pinned MailLens: '+$pinnedMailLensCommit) -ForegroundColor Green

  Write-Host '[3/5] Prepare dependencies...' -ForegroundColor Yellow
  $linked=$false
  if(Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules')){
    $linked=Link-NodeModules (Join-Path $repoRoot 'node_modules') (Join-Path $worktree 'node_modules')
  }
  if(Test-Path -LiteralPath (Join-Path $repoRoot 'apps\api\node_modules')){
    $null=Link-NodeModules (Join-Path $repoRoot 'apps\api\node_modules') (Join-Path $worktree 'apps\api\node_modules')
    $linked=$true
  }
  if(-not $linked){
    Write-Host 'Installing dependencies in isolated worktree...' -ForegroundColor Yellow
    Push-Location $worktree
    try {& npm.cmd install --ignore-scripts --no-audit --no-fund} finally {Pop-Location}
    if($LASTEXITCODE -ne 0){Fail 'NPM_INSTALL_FAILED'}
  }

  Write-Host '[4/5] Gmail OAuth token...' -ForegroundColor Yellow
  $env:N8N_USER_FOLDER=$n8nUserFolder
  $out=& $nodePath $n8nScript export:credentials "--id=$credentialId" --decrypted "--output=$credentialPath" 2>&1
  if($LASTEXITCODE -ne 0){Fail ('N8N_CREDENTIAL_EXPORT_FAILED: '+($out -join "`n"))}
  $credential=(As-Array (([System.IO.File]::ReadAllText($credentialPath,[System.Text.Encoding]::UTF8)|ConvertFrom-Json)) | Select-Object -First 1)
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

  Write-Host '[5/5] Freeze/resume 100 unseen H2 emails...' -ForegroundColor Yellow
  $runnerPath=Join-Path $worktree 'apps\api\src\scripts\__buyflow-real100-h2-v2-temp.ts'
  Invoke-WebRequest -UseBasicParsing -Uri $generatorUrl -OutFile $runnerPath -TimeoutSec 60
  Push-Location (Join-Path $worktree 'apps\api')
  try {
    & npm.cmd exec -- tsx $runnerPath $real120Ids $h1Ids.FullName $outDir
    $exit=$LASTEXITCODE
  } finally {Pop-Location}
  if($exit -ne 0){
    Write-Host ''
    Write-Host 'The H2 selection/partial progress was kept locally.' -ForegroundColor Yellow
    Write-Host 'Run the SAME command again after the Gmail error clears; it resumes instead of starting over.' -ForegroundColor Yellow
    Fail "REAL100_H2_V2_EXIT_$exit"
  }

  $bundle=Join-Path $outDir 'real100-h2-blind-bundle-maillens-v1.1-private-local.json'
  $ids=Join-Path $outDir 'real100-h2-ids-private-local.json'
  $summary=Join-Path $outDir 'real100-h2-summary.json'
  if(-not (Test-Path -LiteralPath $bundle)){Fail 'H2_BUNDLE_NOT_CREATED'}
  if(-not (Test-Path -LiteralPath $ids)){Fail 'H2_IDS_NOT_CREATED'}
  if(-not (Test-Path -LiteralPath $summary)){Fail 'H2_SUMMARY_NOT_CREATED'}

  Write-Host ''
  Write-Host 'H2 FROZEN. Luna has NOT run yet.' -ForegroundColor Green
  Write-Host 'Upload these two files to ChatGPT BEFORE any Luna run:' -ForegroundColor Cyan
  Write-Host ('  '+$bundle) -ForegroundColor Cyan
  Write-Host ('  '+$summary) -ForegroundColor Cyan
  Write-Host 'Keep the private IDs file locally.' -ForegroundColor Yellow
}
finally {
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  if($runnerPath -and (Test-Path -LiteralPath $runnerPath)){Remove-Item -LiteralPath $runnerPath -Force -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $credentialPath){try{Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue}catch{}}
  if($createdWorktree -and $repoRoot){try{& git -C $repoRoot worktree remove --force $worktree 2>$null | Out-Null}catch{}}
  if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalN8nUserFolder){Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue}else{$env:N8N_USER_FOLDER=$originalN8nUserFolder}
}
