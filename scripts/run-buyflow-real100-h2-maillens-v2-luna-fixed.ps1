$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$pinnedMain='21236b06f57002606d0fabbba24a7c0cc2bb5484'
$runnerCommit='7ad4ce0a695c334389644ab4d580e7a3b12c4819'
$runnerUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/apps/api/src/scripts/buyflow-real100-h2-maillens-v2-luna-fixed.ts"
$nodePath='C:\Program Files\nodejs\node.exe'
$n8nScript=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$credentialId='FqG6EUXZPfOERjkV'
$tempRoot=Join-Path $env:TEMP ('buyflow-h2-maillens-v2-luna-fixed-' + [guid]::NewGuid().ToString('N'))
$worktree=Join-Path $tempRoot 'worktree'
$credentialPath=Join-Path $tempRoot 'credential.json'
$runnerPath=$null
$repoRoot=$null
$createdWorktree=$false
$originalN8nUserFolder=$env:N8N_USER_FOLDER
$originalOpenAIKey=$env:OPENAI_API_KEY

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
  try {
    $origin=(& git -C $p config --get remote.origin.url 2>$null | Select-Object -First 1)
    return ([string]$origin -match 'buyflow-v3')
  } catch {return $false}
}
function Find-BuyFlowRepo{
  $desktop=Join-Path $env:USERPROFILE 'Desktop'
  $known=@(
    (Join-Path $desktop 'buyflow\buyflow-v3'),
    (Join-Path $desktop 'buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
    (Join-Path $desktop 'buyflow\.n8n-local-ai-runner\buyflow-v3'),
    'C:\actions-runner-buyflow\_work\buyflow-v3\buyflow-v3'
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

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW - SAME REAL100 H2 / MAILLENS v2 + GPT-5.6 LUNA FIXED' -ForegroundColor Cyan
  Write-Host 'Same frozen 100 real emails. Frozen Prompt V2.' -ForegroundColor Green
  Write-Host 'Gmail GET only. BuyFlow writes 0. Production OFF. O3 NOT USED.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  if(-not (Get-Command git -ErrorAction SilentlyContinue)){Fail 'GIT_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nScript)){Fail 'N8N_RUNTIME_NOT_FOUND'}

  $preferredIds=Join-Path $env:USERPROFILE 'Desktop\Buyflow minden\buyflow-real100-h2-v2\real100-h2-ids-private-local.json'
  if(Test-Path -LiteralPath $preferredIds){
    $ids=Get-Item -LiteralPath $preferredIds
  } else {
    $ids=Get-ChildItem (Join-Path $env:USERPROFILE 'Desktop') -Recurse -File -Filter 'real100-h2-ids-private-local.json' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  if(-not $ids){Fail 'REAL100_H2_IDS_NOT_FOUND'}
  Write-Host ('H2 IDs: '+$ids.FullName) -ForegroundColor DarkGray

  $repoRoot=Find-BuyFlowRepo
  if(-not $repoRoot){Fail 'BUYFLOW_GIT_REPO_NOT_FOUND'}
  Write-Host ('Base repo: '+$repoRoot) -ForegroundColor DarkGray

  Write-Host '[1/5] Current repaired BuyFlow snapshot...' -ForegroundColor Yellow
  & git -C $repoRoot fetch origin $pinnedMain --depth=1 --quiet
  if($LASTEXITCODE -ne 0){Fail 'GIT_FETCH_MAIN_FAILED'}
  & git -C $repoRoot worktree add --detach $worktree $pinnedMain | Out-Null
  if($LASTEXITCODE -ne 0){Fail 'GIT_WORKTREE_ADD_FAILED'}
  $createdWorktree=$true

  Write-Host '[2/5] Prepare fixed MailLens v2 runner...' -ForegroundColor Yellow
  $runnerPath=Join-Path $worktree 'apps\api\src\scripts\__buyflow-real100-h2-maillens-v2-luna-fixed-temp.ts'
  Invoke-WebRequest -UseBasicParsing -Uri $runnerUrl -OutFile $runnerPath -TimeoutSec 60

  Write-Host '[3/5] Install isolated dependencies...' -ForegroundColor Yellow
  Push-Location $worktree
  try {& npm.cmd ci --ignore-scripts --no-audit --no-fund} finally {Pop-Location}
  if($LASTEXITCODE -ne 0){Fail 'NPM_CI_FAILED'}

  Write-Host '[4/5] Gmail read-only token + OpenAI key...' -ForegroundColor Yellow
  $env:N8N_USER_FOLDER=$n8nUserFolder
  $export=& $nodePath $n8nScript export:credentials "--id=$credentialId" --decrypted "--output=$credentialPath" 2>&1
  if($LASTEXITCODE -ne 0){Fail ('N8N_CREDENTIAL_EXPORT_FAILED: '+($export -join "`n"))}
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

  $secure=Read-Host 'OpenAI API key (input hidden)' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  if([string]::IsNullOrWhiteSpace($plain)){Fail 'OPENAI_API_KEY_EMPTY'}
  $env:OPENAI_API_KEY=$plain
  $plain=$null

  Write-Host '[5/5] Run same 100 H2 emails through MailLens v2 + Luna...' -ForegroundColor Yellow
  $outPath=Join-Path $ids.Directory.FullName 'real100-h2-maillens-v2-prompt-v2-luna-predictions-private-local.json'
  Push-Location (Join-Path $worktree 'apps\api')
  try {
    & npm.cmd exec -- tsx $runnerPath $ids.FullName $outPath
    $exit=$LASTEXITCODE
  } finally {Pop-Location}
  if($exit -ne 0){Fail "MAILLENS_V2_LUNA_EXIT_$exit"}
  if(-not (Test-Path -LiteralPath $outPath)){Fail 'RESULT_FILE_NOT_CREATED'}

  Write-Host ''
  Write-Host 'KESZ.' -ForegroundColor Green
  Write-Host 'Ezt az EGY fajlt toltsd fel ide:' -ForegroundColor Cyan
  Write-Host ('  '+$outPath) -ForegroundColor Cyan
}
finally {
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  if($null -eq $originalOpenAIKey){Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue}else{$env:OPENAI_API_KEY=$originalOpenAIKey}
  if($null -eq $originalN8nUserFolder){Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue}else{$env:N8N_USER_FOLDER=$originalN8nUserFolder}
  if(Test-Path -LiteralPath $credentialPath){try{Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue}catch{}}
  if($createdWorktree -and $repoRoot){try{& git -C $repoRoot worktree remove --force $worktree 2>$null | Out-Null}catch{}}
  if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
}