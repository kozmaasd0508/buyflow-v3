param(
  [Parameter(Mandatory=$true)][string]$IdFile,
  [Parameter(Mandatory=$true)][string]$ExpectedIdSha256
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$CodeCommit='e3b88c8e25056543f678927672c1a3a58ee3a34b'
$distro='Ubuntu-24.04'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$tempRoot=Join-Path $env:TEMP ('buyflow-v13-lite-real120-' + [guid]::NewGuid().ToString('N'))
$codeRoot=Join-Path $tempRoot 'code'
$workflowPath=Join-Path $tempRoot 'workflow.json'
$credentialPath=Join-Path $tempRoot 'credential.json'
$stdout=Join-Path $tempRoot 'eventmind.out.log'
$stderr=Join-Path $tempRoot 'eventmind.err.log'
$reportPath=Join-Path $env:USERPROFILE ("Desktop\BuyFlow-EVENTMIND-V13-LITE-REAL120-$stamp.json")
$serverProcess=$null
$repoRoot=$null
$modelRoot=$null
$nodeJunction=$false
$localDataJunction=$false
$originalUserFolder=$env:N8N_USER_FOLDER

function Fail([string]$m){ throw $m }
function As-Array($Value){ if($null -eq $Value){return @()}; if($Value -is [System.Array]){return @($Value)}; return @($Value) }
function Get-PropertyValue($Object,[string[]]$Names){
  if($null -eq $Object){return $null}
  foreach($name in $Names){
    $prop=$Object.PSObject.Properties[$name]
    if($null -ne $prop -and $null -ne $prop.Value){
      if($prop.Value -isnot [string] -or -not [string]::IsNullOrWhiteSpace([string]$prop.Value)){return $prop.Value}
    }
  }
  return $null
}
function Read-JsonFile([string]$Path){
  if(-not (Test-Path -LiteralPath $Path)){Fail "JSON_FILE_MISSING:$Path"}
  $raw=Get-Content -Raw -LiteralPath $Path
  if([string]::IsNullOrWhiteSpace($raw)){Fail "JSON_FILE_EMPTY:$Path"}
  return ($raw | ConvertFrom-Json)
}
function Get-Sha256Text([string]$Text){
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$bytes=[Text.Encoding]::UTF8.GetBytes($Text);return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Run-Git([string[]]$Arguments){
  $out=& git.exe @Arguments 2>&1
  if($LASTEXITCODE -ne 0){throw ('GIT_FAILED: git ' + ($Arguments -join ' ') + "`n" + ($out -join "`n"))}
  return @($out)
}
function Is-BuyFlowRepo([string]$p){
  if(-not (Test-Path -LiteralPath $p)){return $false}
  try{$remote=(& git.exe -C $p remote get-url origin 2>$null | Select-Object -First 1);return ([string]$remote -match 'kozmaasd0508[\\/]buyflow-v3(?:\.git)?$')}catch{return $false}
}
function Find-RepoRoot{
  $known=@(
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runner\buyflow-v3'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\buyflow-v3')
  )
  foreach($p in $known){if(Is-BuyFlowRepo $p){return $p}}
  return $null
}
function Find-ModelRoot([string]$preferred){
  if(Test-Path -LiteralPath (Join-Path $preferred 'local-data\lora-v11\LATEST.txt')){return $preferred}
  $base=Join-Path $env:USERPROFILE 'Desktop\buyflow'
  $hits=@(Get-ChildItem -LiteralPath $base -Filter LATEST.txt -File -Recurse -Force -ErrorAction SilentlyContinue | Where-Object {$_.Directory.Name -eq 'lora-v11'})
  foreach($hit in $hits){$lora=Split-Path -Parent $hit.FullName;$localData=Split-Path -Parent $lora;$candidate=Split-Path -Parent $localData;if(Test-Path -LiteralPath (Join-Path $candidate 'local-data\lora-v11\LATEST.txt')){return $candidate}}
  return $null
}
function Convert-ToWslPath([string]$p){
  $full=[IO.Path]::GetFullPath($p)
  if($full -notmatch '^([A-Za-z]):\\(.*)$'){Fail "WSL_PATH_UNSUPPORTED:$full"}
  $drive=$Matches[1].ToLowerInvariant();$rest=$Matches[2].Replace('\','/');return "/mnt/$drive/$rest"
}
function Remove-Junction([string]$p){if(Test-Path -LiteralPath $p){cmd.exe /d /c "rmdir `"$p`"" | Out-Null}}
function Stop-Server{
  if($serverProcess){try{if(-not $serverProcess.HasExited){Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue}}catch{}}
  if(Get-Command wsl.exe -ErrorAction SilentlyContinue){& wsl.exe -d $distro -- sh -lc "pkill -f '[e]ventmind-v11-runtime.py' || true" | Out-Null}
}

$nodePath='C:\Program Files\nodejs\node.exe'
$n8nScript=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'
$n8nDb=Join-Path $n8nUserFolder '.n8n\database.sqlite'
function Invoke-N8n([string[]]$Arguments){
  $output=& $nodePath $n8nScript @Arguments 2>&1
  if($LASTEXITCODE -ne 0){throw ("n8n command failed: {0}`n{1}" -f ($Arguments -join ' '),($output -join "`n"))}
  return @($output)
}

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try{
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND V13-LITE - REAL120 DIRECT' -ForegroundColor Cyan
  Write-Host 'REGI MODSZER: HELYI CMD/POWERSHELL - NINCS TESTLAB/GITHUB RUNNER' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'Csak olvasas. Gmail/BuyFlow production iras: 0.' -ForegroundColor Green
  Write-Host ''

  if(-not (Get-Command git.exe -ErrorAction SilentlyContinue)){Fail 'GIT_NOT_FOUND'}
  if(-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)){Fail 'NPM_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $IdFile)){Fail "ID_FILE_NOT_FOUND:$IdFile"}
  $ids=As-Array (Read-JsonFile $IdFile)
  if($ids.Count -ne 120){Fail "EXPECTED_120_IDS_GOT_$($ids.Count)"}
  $actualIdSha=Get-Sha256Text ([string]::Join("`n",[string[]]$ids))
  if($actualIdSha -ne $ExpectedIdSha256.ToLowerInvariant()){Fail "FROZEN_ID_SHA_MISMATCH:$actualIdSha"}
  Write-Host ('Frozen Gmail ID SHA256: ' + $actualIdSha) -ForegroundColor Green

  $repoRoot=Find-RepoRoot
  if(-not $repoRoot){Fail 'BUYFLOW_GIT_REPOSITORY_NOT_FOUND'}
  $modelRoot=Find-ModelRoot $repoRoot
  if(-not $modelRoot){Fail 'V11_MODEL_ROOT_NOT_FOUND'}

  & git.exe -C $repoRoot cat-file -e ($CodeCommit + '^{commit}') 2>$null
  if($LASTEXITCODE -ne 0){
    Write-Host '[1/4] Pontos V13-lite kod letoltese...' -ForegroundColor Yellow
    Run-Git @('-C',$repoRoot,'fetch','origin','codex/buyflow-testlab-v1') | Out-Null
    & git.exe -C $repoRoot cat-file -e ($CodeCommit + '^{commit}') 2>$null
    if($LASTEXITCODE -ne 0){Fail 'EXACT_V13_LITE_COMMIT_NOT_AVAILABLE'}
  } else {Write-Host '[1/4] Pontos V13-lite kod: OK' -ForegroundColor Green}

  Run-Git @('-C',$repoRoot,'worktree','add','--detach',$codeRoot,$CodeCommit) | Out-Null

  $localDataSource=Join-Path $modelRoot 'local-data'
  $localDataTarget=Join-Path $codeRoot 'local-data'
  cmd.exe /d /c "mklink /J `"$localDataTarget`" `"$localDataSource`"" | Out-Null
  if($LASTEXITCODE -ne 0){Fail 'LOCAL_DATA_JUNCTION_FAILED'}
  $localDataJunction=$true

  $nodeSource=Join-Path $repoRoot 'node_modules'
  $nodeTarget=Join-Path $codeRoot 'node_modules'
  if(Test-Path -LiteralPath $nodeSource){
    cmd.exe /d /c "mklink /J `"$nodeTarget`" `"$nodeSource`"" | Out-Null
    if($LASTEXITCODE -ne 0){Fail 'NODE_MODULES_JUNCTION_FAILED'}
    $nodeJunction=$true
  } else {
    Push-Location $codeRoot
    try{& npm.cmd install --ignore-scripts --no-audit --no-fund;if($LASTEXITCODE -ne 0){Fail 'NPM_INSTALL_FAILED'}}finally{Pop-Location}
  }

  Write-Host '[2/4] Meglevo n8n Gmail OAuth hasznalata...' -ForegroundColor Yellow
  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nScript)){Fail 'N8N_RUNTIME_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nDb)){Fail 'N8N_DATABASE_NOT_FOUND'}
  $env:N8N_USER_FOLDER=$n8nUserFolder
  Invoke-N8n @('export:workflow','--all',"--output=$workflowPath") | Out-Null
  $workflows=As-Array (Read-JsonFile $workflowPath)
  $workflow=$null
  foreach($candidate in $workflows){
    $nodes=As-Array (Get-PropertyValue $candidate @('nodes'))
    foreach($node in $nodes){
      $parameters=Get-PropertyValue $node @('parameters')
      $path=[string](Get-PropertyValue $parameters @('path'))
      if($path -eq 'buyflow-gmail-targeted-test-v2'){$workflow=$candidate;break}
    }
    if($workflow){break}
  }
  if(-not $workflow){Fail 'TARGETED_GMAIL_WORKFLOW_NOT_FOUND'}
  $gmailCredentialId=$null
  foreach($node in (As-Array (Get-PropertyValue $workflow @('nodes')))){
    $credentials=Get-PropertyValue $node @('credentials');if($null -eq $credentials){continue}
    foreach($prop in $credentials.PSObject.Properties){
      if($prop.Name -match 'gmail|google.*oauth|oauth.*google'){
        $gmailCredentialId=[string](Get-PropertyValue $prop.Value @('id'));if($gmailCredentialId){break}
      }
    }
    if($gmailCredentialId){break}
  }
  if(-not $gmailCredentialId){Fail 'GMAIL_CREDENTIAL_REFERENCE_NOT_FOUND'}
  Invoke-N8n @('export:credentials',"--id=$gmailCredentialId",'--decrypted',"--output=$credentialPath") | Out-Null
  $credential=(As-Array (Read-JsonFile $credentialPath) | Select-Object -First 1)
  $data=Get-PropertyValue $credential @('data')
  $clientId=[string](Get-PropertyValue $data @('clientId','client_id'))
  $clientSecret=[string](Get-PropertyValue $data @('clientSecret','client_secret'))
  $refreshToken=[string](Get-PropertyValue $data @('refreshToken','refresh_token'))
  if(-not $refreshToken){
    $tokenData=Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
    if($tokenData){$parsedToken=if($tokenData -is [string]){try{$tokenData|ConvertFrom-Json}catch{$null}}else{$tokenData};if($parsedToken){$refreshToken=[string](Get-PropertyValue $parsedToken @('refresh_token','refreshToken'))}}
  }
  if(-not $clientId -or -not $clientSecret -or -not $refreshToken){Fail 'GMAIL_REFRESH_CREDENTIALS_MISSING'}
  $tokenResponse=Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{client_id=$clientId;client_secret=$clientSecret;refresh_token=$refreshToken;grant_type='refresh_token'} -TimeoutSec 30
  $accessToken=[string](Get-PropertyValue $tokenResponse @('access_token'))
  if(-not $accessToken){Fail 'GMAIL_ACCESS_TOKEN_NOT_AVAILABLE'}

  Write-Host '[3/4] Helyi Qwen V11 adapter inditasa V13-lite prompttal...' -ForegroundColor Yellow
  $server=Join-Path $codeRoot 'scripts\eventmind-v11-runtime.py'
  $wslProject=Convert-ToWslPath $codeRoot
  $wslServer=Convert-ToWslPath $server
  $wslHome=(& wsl.exe -d $distro -- sh -lc 'printf %s "$HOME"').Trim()
  if([string]::IsNullOrWhiteSpace($wslHome)){Fail 'WSL_HOME_NOT_FOUND'}
  $wslPython="$wslHome/.venvs/buyflow-lora/bin/python"
  & wsl.exe -d $distro -- test -x $wslPython
  if($LASTEXITCODE -ne 0){Fail 'LORA_PYTHON_NOT_FOUND'}
  Stop-Server
  $serverProcess=Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d',$distro,'--','env','HSA_ENABLE_DXG_DETECTION=1','TOKENIZERS_PARALLELISM=false',$wslPython,$wslServer,$wslProject) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  $health=$null
  for($i=0;$i -lt 180;$i++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4394/health' -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($serverProcess.HasExited){break};Start-Sleep -Seconds 1
  }
  if(-not $health -or -not $health.ok){if(Test-Path $stderr){Get-Content $stderr -Tail 30};Fail 'EVENTMIND_RUNTIME_START_FAILED'}
  if($health.model_id -ne 'Qwen/Qwen3-8B' -or $health.thinking_enabled -ne $false -or $health.deterministic -ne $true){Fail 'EVENTMIND_RUNTIME_CONTRACT_FAILED'}

  Write-Host '[4/4] 120 valodi Gmail level -> MailLens -> EventMind V13-lite...' -ForegroundColor Yellow
  $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken
  $env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED='true'
  $env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL='http://127.0.0.1:4394/v1/eventmind'
  $env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256=[string]$health.adapter_sha256
  $env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS='30000'
  Push-Location (Join-Path $codeRoot 'apps\api')
  try{
    & npm.cmd exec -- tsx 'src\scripts\eventmind-v13-real-gmail-dev120.ts' $IdFile $reportPath
    $exit=$LASTEXITCODE
  }finally{Pop-Location}

  Write-Host ''
  Write-Host ('Report: ' + $reportPath) -ForegroundColor Cyan
  Write-Host 'Mailbox writes: 0 | BuyFlow DB writes: 0 | Production OFF' -ForegroundColor Green
  if($exit -ne 0){Fail "V13_LITE_REAL120_EXIT_$exit"}
  Write-Host 'V13-LITE REAL120: COMPLETE' -ForegroundColor Green
  exit 0
}catch{
  Write-Host ''
  Write-Host ('V13-LITE REAL120 BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Semmi nincs elesitve. Gmail/BuyFlow production modositas nem tortent.' -ForegroundColor Yellow
  if(Test-Path $stderr){Get-Content $stderr -Tail 20}
  exit 1
}finally{
  $env:N8N_USER_FOLDER=$originalUserFolder
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS -ErrorAction SilentlyContinue
  Stop-Server
  if($nodeJunction){Remove-Junction (Join-Path $codeRoot 'node_modules')}
  if($localDataJunction){Remove-Junction (Join-Path $codeRoot 'local-data')}
  if($repoRoot -and (Test-Path -LiteralPath $codeRoot)){try{& git.exe -C $repoRoot worktree remove --force $codeRoot 2>$null | Out-Null}catch{};try{& git.exe -C $repoRoot worktree prune 2>$null | Out-Null}catch{}}
  if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
}
