$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runnerCommit='2e6f7891502bd68995c1333621630cb2fc92eec4'
$runnerUrl="https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/$runnerCommit/apps/api/src/scripts/buyflow-real120-mail-lens-openai.ts"
$idFile=Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json'
$expectedIdSha='88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir=Join-Path $env:USERPROFILE ("Desktop\buyflow-real120-mail-lens-openai-$stamp")
$tempRoot=Join-Path $env:TEMP ('buyflow-real120-openai-' + [guid]::NewGuid().ToString('N'))
$workflowPath=Join-Path $tempRoot 'workflow.json'
$credentialPath=Join-Path $tempRoot 'credential.json'
$runnerPath=$null
$repoRoot=$null
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
function Read-JsonFile([string]$p){
  if(-not (Test-Path -LiteralPath $p)){Fail "JSON_FILE_MISSING:$p"}
  $raw=Get-Content -Raw -LiteralPath $p
  if([string]::IsNullOrWhiteSpace($raw)){Fail "JSON_FILE_EMPTY:$p"}
  return ($raw|ConvertFrom-Json)
}
function Get-Sha256Text([string]$text){
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$bytes=[Text.Encoding]::UTF8.GetBytes($text);return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Is-BuyFlowRepo([string]$p){
  return (Test-Path -LiteralPath (Join-Path $p 'apps\api\package.json')) -and (Test-Path -LiteralPath (Join-Path $p 'apps\api\src\email\normalize-document-v1.ts'))
}
function Find-RepoRoot{
  $known=@(
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\buyflow-v3'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runner\buyflow-v3')
  )
  foreach($p in $known){if(Is-BuyFlowRepo $p){return $p}}
  return $null
}

$nodePath='C:\Program Files\nodejs\node.exe'
$n8nScript=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
function Invoke-N8n([string[]]$Arguments){
  $output=& $nodePath $n8nScript @Arguments 2>&1
  if($LASTEXITCODE -ne 0){Fail ("N8N_COMMAND_FAILED: {0}`n{1}" -f ($Arguments -join ' '),($output -join "`n"))}
  return @($output)
}

New-Item -ItemType Directory -Force -Path $tempRoot,$outDir|Out-Null
try{
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW REAL120 - MAILLENS + LUNA/TERRA + SOL TIEBREAK' -ForegroundColor Cyan
  Write-Host '120 real Gmail messages. Gmail GET only. BuyFlow writes 0.' -ForegroundColor Green
  Write-Host 'Luna + Terra all cases; Sol only on disagreements.' -ForegroundColor Green
  Write-Host 'This is agreement/routing measurement, not frozen-gold accuracy.' -ForegroundColor Yellow
  Write-Host 'Blind O3 NOT USED. Production OFF.' -ForegroundColor Green
  Write-Host '==============================================================' -ForegroundColor Cyan

  if(-not (Test-Path -LiteralPath $idFile)){Fail "REAL120_ID_FILE_NOT_FOUND:$idFile"}
  $ids=As-Array (Read-JsonFile $idFile)
  if($ids.Count -ne 120){Fail "EXPECTED_120_IDS_GOT_$($ids.Count)"}
  $actualIdSha=Get-Sha256Text ([string]::Join("`n",[string[]]$ids))
  if($actualIdSha -ne $expectedIdSha){Fail "REAL120_ID_SHA_MISMATCH:$actualIdSha"}
  Write-Host ('Frozen REAL120 SHA256: '+$actualIdSha) -ForegroundColor Green

  $repoRoot=Find-RepoRoot
  if(-not $repoRoot){Fail 'BUYFLOW_REPO_NOT_FOUND'}
  Write-Host ('BuyFlow repo: '+$repoRoot) -ForegroundColor DarkGray
  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nScript)){Fail 'N8N_RUNTIME_NOT_FOUND'}

  Write-Host '[1/4] Existing Gmail OAuth betoltese...' -ForegroundColor Yellow
  $env:N8N_USER_FOLDER=$n8nUserFolder
  Invoke-N8n @('export:workflow','--all',"--output=$workflowPath")|Out-Null
  $workflows=As-Array (Read-JsonFile $workflowPath)
  $workflow=$null
  foreach($candidate in $workflows){
    foreach($node in (As-Array (Get-PropertyValue $candidate @('nodes')))){
      $parameters=Get-PropertyValue $node @('parameters')
      if([string](Get-PropertyValue $parameters @('path')) -eq 'buyflow-gmail-targeted-test-v2'){$workflow=$candidate;break}
    }
    if($workflow){break}
  }
  if(-not $workflow){Fail 'TARGETED_GMAIL_WORKFLOW_NOT_FOUND'}

  $credentialId=$null
  foreach($node in (As-Array (Get-PropertyValue $workflow @('nodes')))){
    $credentials=Get-PropertyValue $node @('credentials')
    if($null -eq $credentials){continue}
    foreach($prop in $credentials.PSObject.Properties){
      if($prop.Name -match 'gmail|google.*oauth|oauth.*google'){
        $credentialId=[string](Get-PropertyValue $prop.Value @('id'))
        if($credentialId){break}
      }
    }
    if($credentialId){break}
  }
  if(-not $credentialId){Fail 'GMAIL_CREDENTIAL_REFERENCE_NOT_FOUND'}
  Invoke-N8n @('export:credentials',"--id=$credentialId",'--decrypted',"--output=$credentialPath")|Out-Null
  $credential=(As-Array (Read-JsonFile $credentialPath)|Select-Object -First 1)
  $data=Get-PropertyValue $credential @('data')
  if($null -eq $data){Fail 'GMAIL_CREDENTIAL_DATA_MISSING'}
  $clientId=[string](Get-PropertyValue $data @('clientId','client_id'))
  $clientSecret=[string](Get-PropertyValue $data @('clientSecret','client_secret'))
  $refreshToken=[string](Get-PropertyValue $data @('refreshToken','refresh_token'))
  if(-not $refreshToken){
    $tokenData=Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
    if($tokenData){
      $parsed=if($tokenData -is [string]){try{$tokenData|ConvertFrom-Json}catch{$null}}else{$tokenData}
      if($parsed){$refreshToken=[string](Get-PropertyValue $parsed @('refresh_token','refreshToken'))}
    }
  }
  if(-not $clientId -or -not $clientSecret -or -not $refreshToken){Fail 'GMAIL_REFRESH_CREDENTIAL_INCOMPLETE'}
  Write-Host 'Gmail OAuth: OK (ertekek rejtve)' -ForegroundColor Green

  Write-Host '[2/4] Gmail read-only token...' -ForegroundColor Yellow
  $tokenResponse=Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{
    client_id=$clientId;client_secret=$clientSecret;refresh_token=$refreshToken;grant_type='refresh_token'
  } -TimeoutSec 30
  $accessToken=[string]$tokenResponse.access_token
  if([string]::IsNullOrWhiteSpace($accessToken)){Fail 'GMAIL_TOKEN_REFRESH_FAILED'}
  $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken
  Write-Host 'Gmail GET token: READY' -ForegroundColor Green

  Write-Host '[3/4] OpenAI API key...' -ForegroundColor Yellow
  if(-not $env:OPENAI_API_KEY){
    $sec=Read-Host 'OpenAI API key (input hidden)' -AsSecureString
    $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try{$env:OPENAI_API_KEY=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
  }
  if([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)){Fail 'OPENAI_API_KEY_MISSING'}

  Write-Host '[4/4] REAL120 MailLens benchmark...' -ForegroundColor Yellow
  $runnerPath=Join-Path $repoRoot 'apps\api\src\scripts\__buyflow-real120-mail-lens-openai-temp.ts'
  Invoke-WebRequest -UseBasicParsing -Uri $runnerUrl -OutFile $runnerPath -TimeoutSec 60

  Push-Location (Join-Path $repoRoot 'apps\api')
  try{
    & npm.cmd exec -- tsx $runnerPath $idFile $outDir
    $exit=$LASTEXITCODE
  }finally{Pop-Location}
  if($exit -ne 0){Fail "REAL120_OPENAI_EXIT_$exit"}

  Write-Host ''
  Write-Host 'REAL120 MAILLENS OPENAI: COMPLETE' -ForegroundColor Green
  Write-Host ('Result folder: '+$outDir) -ForegroundColor Green
  Write-Host 'Masold be ide a REAL120 RESULT blokkot.' -ForegroundColor Cyan
}
finally{
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  if($runnerPath -and (Test-Path -LiteralPath $runnerPath)){Remove-Item -LiteralPath $runnerPath -Force -ErrorAction SilentlyContinue}
  if(Test-Path -LiteralPath $credentialPath){try{Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue}catch{}}
  if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalN8nUserFolder){Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue}else{$env:N8N_USER_FOLDER=$originalN8nUserFolder}
}
