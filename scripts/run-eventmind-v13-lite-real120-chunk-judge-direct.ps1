param(
  [string]$IdFile = (Join-Path $env:USERPROFILE 'Desktop\buyflow\.testlab-private\real120-ids.json'),
  [string]$ExpectedIdSha256 = '88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470'
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$branch='codex/buyflow-testlab-v1'
$distro='Ubuntu-24.04'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$tempRoot=Join-Path $env:TEMP ('buyflow-real120-chunk-judge-' + [guid]::NewGuid().ToString('N'))
$codeRoot=Join-Path $tempRoot 'code'
$workflowPath=Join-Path $tempRoot 'workflow.json'
$credentialPath=Join-Path $tempRoot 'credential.json'
$checkpointPath=Join-Path $env:USERPROFILE 'Desktop\BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-CHECKPOINT.json'
$finalReportPath=Join-Path $env:USERPROFILE ("Desktop\BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-$stamp.json")
$diagLogPath=Join-Path $env:USERPROFILE ("Desktop\BuyFlow-EVENTMIND-REAL120-CHUNK-JUDGE-GPU-$stamp.jsonl")
$script:serverProcess=$null
$script:stdout=$null
$script:stderr=$null
$repoRoot=$null
$modelRoot=$null
$nodeJunction=$false
$localDataJunction=$false
$originalUserFolder=$env:N8N_USER_FOLDER

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
function Cmd-Git([string]$repo,[string]$command){
  $full='git.exe -C "' + $repo + '" ' + $command + ' 2>&1'
  $out=& cmd.exe /d /s /c $full
  $exit=$LASTEXITCODE
  if($exit -ne 0){Fail ("GIT_FAILED: $command`n" + ($out -join "`n"))}
  return @($out)
}
function Is-BuyFlowRepo([string]$p){
  if(-not (Test-Path -LiteralPath $p)){return $false}
  try{
    $out=& cmd.exe /d /s /c ('git.exe -C "' + $p + '" remote get-url origin 2>nul')
    if($LASTEXITCODE -ne 0){return $false}
    return ([string]($out|Select-Object -First 1) -match 'kozmaasd0508[\\/]buyflow-v3(?:\.git)?$')
  }catch{return $false}
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
  $hits=@(Get-ChildItem -LiteralPath $base -Filter LATEST.txt -File -Recurse -Force -ErrorAction SilentlyContinue|Where-Object{$_.Directory.Name -eq 'lora-v11'})
  foreach($hit in $hits){
    $lora=Split-Path -Parent $hit.FullName;$localData=Split-Path -Parent $lora;$candidate=Split-Path -Parent $localData
    if(Test-Path -LiteralPath (Join-Path $candidate 'local-data\lora-v11\LATEST.txt')){return $candidate}
  }
  return $null
}
function Find-NodeModules{
  $known=@(
    (Join-Path $repoRoot 'node_modules'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation\node_modules'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\buyflow-v3\node_modules')
  )
  foreach($p in $known){if(Test-Path -LiteralPath $p){return $p}}
  return $null
}
function Convert-ToWslPath([string]$p){
  $full=[IO.Path]::GetFullPath($p)
  if($full -notmatch '^([A-Za-z]):\\(.*)$'){Fail "WSL_PATH_UNSUPPORTED:$full"}
  return '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\','/')
}
function Remove-Junction([string]$p){if(Test-Path -LiteralPath $p){& cmd.exe /d /c "rmdir `"$p`""|Out-Null}}
function Stop-Qwen{
  if($script:serverProcess){try{if(-not $script:serverProcess.HasExited){Stop-Process -Id $script:serverProcess.Id -Force -ErrorAction SilentlyContinue}}catch{}}
  $script:serverProcess=$null
  if(Get-Command wsl.exe -ErrorAction SilentlyContinue){
    & wsl.exe -d $distro -- sh -lc "pkill -f '[e]ventmind-v11-runtime-diagnostic.py' || true; pkill -f '[e]ventmind-v11-runtime.py' || true"|Out-Null
  }
  Start-Sleep -Seconds 2
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

$clientId=$null;$clientSecret=$null;$refreshToken=$null
function Refresh-GmailToken{
  $token=Invoke-RestMethod -Method Post -Uri 'https://oauth2.googleapis.com/token' -ContentType 'application/x-www-form-urlencoded' -Body @{client_id=$script:clientId;client_secret=$script:clientSecret;refresh_token=$script:refreshToken;grant_type='refresh_token'} -TimeoutSec 30
  $accessToken=[string](Get-PropertyValue $token @('access_token'))
  if(-not $accessToken){Fail 'GMAIL_ACCESS_TOKEN_NOT_AVAILABLE'}
  return $accessToken
}

$server=$null;$wslProject=$null;$wslServer=$null;$wslDiagLog=$null;$wslPython=$null
function Start-Qwen([int]$segment){
  Stop-Qwen
  $script:stdout=Join-Path $tempRoot ("runtime-$segment.out.log")
  $script:stderr=Join-Path $tempRoot ("runtime-$segment.err.log")
  $launchArgs=@(
    '-d',$distro,'--','nice','-n','10','env',
    'HSA_ENABLE_DXG_DETECTION=1','TOKENIZERS_PARALLELISM=false',
    'OMP_NUM_THREADS=4','MKL_NUM_THREADS=4','OPENBLAS_NUM_THREADS=4','NUMEXPR_NUM_THREADS=4',
    ('BUYFLOW_EVENTMIND_DIAG_LOG=' + $wslDiagLog),
    $wslPython,$wslServer,$wslProject
  )
  $script:serverProcess=Start-Process -FilePath 'wsl.exe' -ArgumentList $launchArgs -RedirectStandardOutput $script:stdout -RedirectStandardError $script:stderr -WindowStyle Hidden -PassThru
  try{$script:serverProcess.PriorityClass='BelowNormal'}catch{}
  $health=$null
  for($i=0;$i -lt 180;$i++){
    try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4394/health' -Method Get -TimeoutSec 2;if($health.ok){break}}catch{}
    if($script:serverProcess.HasExited){break};Start-Sleep -Seconds 1
  }
  if(-not $health -or -not $health.ok){
    if(Test-Path $script:stderr){Get-Content $script:stderr -Tail 30}
    Fail 'EVENTMIND_DIAGNOSTIC_RUNTIME_START_FAILED'
  }
  return $health
}

New-Item -ItemType Directory -Force -Path $tempRoot|Out-Null
try{
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND V13-LITE - REAL120 CHUNK + FINAL JUDGE' -ForegroundColor Cyan
  Write-Host 'DIRECT / CHECKPOINT / QWEN RESTART 15 LEVELENKENT' -ForegroundColor Cyan
  Write-Host 'NINCS TESTLAB / NINCS GITHUB RUNNER / PRODUCTION OFF' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'REAL120 = development set, nem final blind holdout.' -ForegroundColor Yellow
  Write-Host 'Gmail csak GET. BuyFlow production iras: 0.' -ForegroundColor Green
  Write-Host ''

  if(-not (Get-Command git.exe -ErrorAction SilentlyContinue)){Fail 'GIT_NOT_FOUND'}
  if(-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)){Fail 'NPM_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $IdFile)){Fail "REAL120_ID_FILE_NOT_FOUND:$IdFile"}
  $ids=As-Array (Read-JsonFile $IdFile)
  if($ids.Count -ne 120){Fail "EXPECTED_120_IDS_GOT_$($ids.Count)"}
  $actual=Get-Sha256Text ([string]::Join("`n",[string[]]$ids))
  if($actual -ne $ExpectedIdSha256.ToLowerInvariant()){Fail "FROZEN_ID_SHA_MISMATCH:$actual"}
  Write-Host ('Frozen Gmail ID SHA256: ' + $actual) -ForegroundColor Green

  $repoRoot=Find-RepoRoot
  if(-not $repoRoot){Fail 'BUYFLOW_GIT_REPOSITORY_NOT_FOUND'}
  $modelRoot=Find-ModelRoot $repoRoot
  if(-not $modelRoot){Fail 'V11_MODEL_ROOT_NOT_FOUND'}

  Write-Host '[1/4] Kod es munkakornyezet...' -ForegroundColor Yellow
  Cmd-Git $repoRoot ('fetch --depth=1 origin ' + $branch)|Out-Null
  $fetched=(Cmd-Git $repoRoot 'rev-parse FETCH_HEAD'|Select-Object -First 1).Trim()
  if($fetched -notmatch '^[a-f0-9]{40}$'){Fail "FETCH_HEAD_INVALID:$fetched"}
  Write-Host ('Code commit: ' + $fetched) -ForegroundColor Green
  Cmd-Git $repoRoot ('worktree add --detach "' + $codeRoot + '" ' + $fetched)|Out-Null

  $localDataSource=Join-Path $modelRoot 'local-data'
  $localDataTarget=Join-Path $codeRoot 'local-data'
  & cmd.exe /d /c "mklink /J `"$localDataTarget`" `"$localDataSource`""|Out-Null
  if($LASTEXITCODE -ne 0){Fail 'LOCAL_DATA_JUNCTION_FAILED'}
  $localDataJunction=$true

  $nodeSource=Find-NodeModules
  $nodeTarget=Join-Path $codeRoot 'node_modules'
  if($nodeSource){
    & cmd.exe /d /c "mklink /J `"$nodeTarget`" `"$nodeSource`""|Out-Null
    if($LASTEXITCODE -ne 0){Fail 'NODE_MODULES_JUNCTION_FAILED'}
    $nodeJunction=$true
  }else{
    Write-Host 'node_modules nincs keszen; egyszeri npm install...' -ForegroundColor Yellow
    Push-Location $codeRoot
    try{& npm.cmd install --ignore-scripts --no-audit --no-fund;if($LASTEXITCODE -ne 0){Fail 'NPM_INSTALL_FAILED'}}finally{Pop-Location}
  }

  Write-Host '[2/4] Meglevo n8n Gmail OAuth...' -ForegroundColor Yellow
  if(-not (Test-Path -LiteralPath $nodePath)){Fail 'NODE_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nScript)){Fail 'N8N_RUNTIME_NOT_FOUND'}
  if(-not (Test-Path -LiteralPath $n8nDb)){Fail 'N8N_DATABASE_NOT_FOUND'}
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
  $credId=$null
  foreach($node in (As-Array (Get-PropertyValue $workflow @('nodes')))){
    $credentials=Get-PropertyValue $node @('credentials');if($null -eq $credentials){continue}
    foreach($prop in $credentials.PSObject.Properties){
      if($prop.Name -match 'gmail|google.*oauth|oauth.*google'){$credId=[string](Get-PropertyValue $prop.Value @('id'));if($credId){break}}
    }
    if($credId){break}
  }
  if(-not $credId){Fail 'GMAIL_CREDENTIAL_REFERENCE_NOT_FOUND'}
  Invoke-N8n @('export:credentials',"--id=$credId",'--decrypted',"--output=$credentialPath")|Out-Null
  $credential=(As-Array (Read-JsonFile $credentialPath)|Select-Object -First 1)
  $data=Get-PropertyValue $credential @('data')
  $script:clientId=[string](Get-PropertyValue $data @('clientId','client_id'))
  $script:clientSecret=[string](Get-PropertyValue $data @('clientSecret','client_secret'))
  $script:refreshToken=[string](Get-PropertyValue $data @('refreshToken','refresh_token'))
  if(-not $script:refreshToken){
    $tokenData=Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
    if($tokenData){$parsedToken=if($tokenData -is [string]){try{$tokenData|ConvertFrom-Json}catch{$null}}else{$tokenData};if($parsedToken){$script:refreshToken=[string](Get-PropertyValue $parsedToken @('refresh_token','refreshToken'))}}
  }
  if(-not $script:clientId -or -not $script:clientSecret -or -not $script:refreshToken){Fail 'GMAIL_REFRESH_CREDENTIALS_MISSING'}

  Write-Host '[3/4] Helyi Qwen felugyelet elokeszitese...' -ForegroundColor Yellow
  $server=Join-Path $codeRoot 'scripts\eventmind-v11-runtime-diagnostic.py'
  if(-not (Test-Path -LiteralPath $server)){Fail 'DIAGNOSTIC_RUNTIME_NOT_FOUND'}
  $wslProject=Convert-ToWslPath $codeRoot
  $wslServer=Convert-ToWslPath $server
  $wslDiagLog=Convert-ToWslPath $diagLogPath
  $wslHome=(& wsl.exe -d $distro -- sh -lc 'printf %s "$HOME"').Trim()
  if([string]::IsNullOrWhiteSpace($wslHome)){Fail 'WSL_HOME_NOT_FOUND'}
  $wslPython="$wslHome/.venvs/buyflow-lora/bin/python"
  & wsl.exe -d $distro -- test -x $wslPython
  if($LASTEXITCODE -ne 0){Fail 'LORA_PYTHON_NOT_FOUND'}

  Write-Host '[4/4] REAL120 indul...' -ForegroundColor Yellow
  Write-Host ('Checkpoint: ' + $checkpointPath) -ForegroundColor DarkGray
  $segment=0
  while($true){
    $segment++
    Write-Host ''
    Write-Host ("--- SEGMENT $segment: Gmail token frissites + tiszta Qwen ---") -ForegroundColor Cyan
    $accessToken=Refresh-GmailToken
    $health=Start-Qwen $segment
    Write-Host 'Qwen runtime: READY' -ForegroundColor Green

    $env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN=$accessToken
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED='true'
    $env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL='http://127.0.0.1:4394/v1/eventmind'
    $env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256=[string]$health.adapter_sha256
    $env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS='20000'

    Push-Location (Join-Path $codeRoot 'apps\api')
    try{
      & npm.cmd exec --yes -- tsx 'src\scripts\eventmind-v13-real-gmail-chunk-judge-dev120.ts' $IdFile $checkpointPath 15
      $runnerExit=$LASTEXITCODE
    }finally{Pop-Location}

    Stop-Qwen
    Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue

    if(-not (Test-Path -LiteralPath $checkpointPath)){Fail "CHECKPOINT_MISSING_EXIT_$runnerExit"}
    $progress=Read-JsonFile $checkpointPath
    $attempted=[int](Get-PropertyValue (Get-PropertyValue $progress @('summary')) @('attempted'))
    $complete=[bool](Get-PropertyValue $progress @('complete'))
    Write-Host ("Progress: $attempted / 120") -ForegroundColor Green

    if($complete){
      Copy-Item -LiteralPath $checkpointPath -Destination $finalReportPath -Force
      Remove-Item -LiteralPath $checkpointPath -Force
      Write-Host ''
      Write-Host '==============================================================' -ForegroundColor Green
      Write-Host 'REAL120 CHUNK + FINAL JUDGE: COMPLETE' -ForegroundColor Green
      Write-Host ('Report: ' + $finalReportPath) -ForegroundColor Cyan
      Write-Host ('GPU log: ' + $diagLogPath) -ForegroundColor DarkGray
      Write-Host 'Mailbox writes: 0 | BuyFlow DB writes: 0 | Production OFF' -ForegroundColor Green
      Write-Host '==============================================================' -ForegroundColor Green
      break
    }

    if($runnerExit -eq 10){
      Write-Host '15-os blokk kesz -> tervezett Qwen ujrainditas.' -ForegroundColor Yellow
      Start-Sleep -Seconds 3
      continue
    }
    if($runnerExit -eq 42){
      Write-Host 'Runtime/memoria vedelmi ujrainditas -> kovetkezo leveltol folytatas.' -ForegroundColor Yellow
      Start-Sleep -Seconds 5
      continue
    }
    if($runnerExit -eq 43){
      Write-Host 'Gmail token frissites kert -> ugyanattol az indextol folytatas.' -ForegroundColor Yellow
      Start-Sleep -Seconds 2
      continue
    }
    Fail "REAL120_RUNNER_UNEXPECTED_EXIT:$runnerExit"
  }

  exit 0
}catch{
  Write-Host ''
  Write-Host ('REAL120 CHUNK+JUDGE BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  if(Test-Path -LiteralPath $checkpointPath){Write-Host ('Checkpoint megmaradt: ' + $checkpointPath) -ForegroundColor Yellow}
  Write-Host 'Semmi nincs elesitve. Gmail/BuyFlow production modositas nem tortent.' -ForegroundColor Yellow
  if($script:stderr -and (Test-Path $script:stderr)){Get-Content $script:stderr -Tail 30}
  exit 1
}finally{
  $env:N8N_USER_FOLDER=$originalUserFolder
  Remove-Item Env:BUYFLOW_GMAIL_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_RUNTIME_URL -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_ADAPTER_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:BUYFLOW_EVENTMIND_V11_TIMEOUT_MS -ErrorAction SilentlyContinue
  Stop-Qwen
  if($nodeJunction){Remove-Junction (Join-Path $codeRoot 'node_modules')}
  if($localDataJunction){Remove-Junction (Join-Path $codeRoot 'local-data')}
  if($repoRoot -and (Test-Path -LiteralPath $codeRoot)){
    try{& cmd.exe /d /s /c ('git.exe -C "' + $repoRoot + '" worktree remove --force "' + $codeRoot + '" >nul 2>&1')|Out-Null}catch{}
    try{& cmd.exe /d /s /c ('git.exe -C "' + $repoRoot + '" worktree prune >nul 2>&1')|Out-Null}catch{}
  }
  if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
}
