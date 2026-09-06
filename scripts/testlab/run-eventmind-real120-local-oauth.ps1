param(
  [Parameter(Mandatory=$true)][string]$ReportDir
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$inner = Join-Path $PSScriptRoot 'run-eventmind-real120.ps1'
$tempRoot = Join-Path $env:TEMP ('buyflow-testlab-oauth-' + [guid]::NewGuid().ToString('N'))
$workflowPath = Join-Path $tempRoot 'workflow.json'
$credentialPath = Join-Path $tempRoot 'credential.json'
$originalUserFolder = $env:N8N_USER_FOLDER
$hadClientId = Test-Path Env:BUYFLOW_TESTLAB_GMAIL_CLIENT_ID
$hadClientSecret = Test-Path Env:BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET
$hadRefreshToken = Test-Path Env:BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN
$oldClientId = $env:BUYFLOW_TESTLAB_GMAIL_CLIENT_ID
$oldClientSecret = $env:BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET
$oldRefreshToken = $env:BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN

function Fail([string]$Message){ throw $Message }
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
  if(-not (Test-Path -LiteralPath $Path)){Fail "TESTLAB_OAUTH_EXPECTED_FILE_MISSING:$Path"}
  $raw=Get-Content -Raw -LiteralPath $Path
  if([string]::IsNullOrWhiteSpace($raw)){Fail "TESTLAB_OAUTH_EMPTY_FILE:$Path"}
  return ($raw | ConvertFrom-Json)
}

$nodePath='C:\Program Files\nodejs\node.exe'
$n8nScript=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-runtime\node_modules\n8n\bin\n8n'
$n8nUserFolder=Join-Path $env:USERPROFILE 'Desktop\buyflow\.n8n-local-ai-data'

function Invoke-N8n([string[]]$Arguments){
  $output=& $nodePath $n8nScript @Arguments 2>&1
  $exit=$LASTEXITCODE
  if($exit -ne 0){throw ("TESTLAB_N8N_COMMAND_FAILED: {0}" -f ($Arguments -join ' '))}
  return @($output)
}

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
  $hasInjected = -not [string]::IsNullOrWhiteSpace($env:BUYFLOW_TESTLAB_GMAIL_CLIENT_ID) -and
                 -not [string]::IsNullOrWhiteSpace($env:BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET) -and
                 -not [string]::IsNullOrWhiteSpace($env:BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN)

  if(-not $hasInjected){
    if(-not (Test-Path -LiteralPath $nodePath -PathType Leaf)){Fail 'TESTLAB_LOCAL_NODE_NOT_FOUND'}
    if(-not (Test-Path -LiteralPath $n8nScript -PathType Leaf)){Fail 'TESTLAB_LOCAL_N8N_RUNTIME_NOT_FOUND'}
    $env:N8N_USER_FOLDER=$n8nUserFolder

    Invoke-N8n @('export:workflow','--all',"--output=$workflowPath") | Out-Null
    $workflows=@(As-Array (Read-JsonFile $workflowPath))
    $workflow=$null
    foreach($candidate in $workflows){
      $nodes=@(As-Array (Get-PropertyValue $candidate @('nodes')))
      foreach($node in $nodes){
        $parameters=Get-PropertyValue $node @('parameters')
        $path=[string](Get-PropertyValue $parameters @('path'))
        if($path -eq 'buyflow-gmail-targeted-test-v2'){$workflow=$candidate;break}
      }
      if($workflow){break}
    }
    if(-not $workflow){Fail 'TESTLAB_TARGETED_GMAIL_WORKFLOW_NOT_FOUND'}

    $credentialId=$null
    foreach($node in @(As-Array (Get-PropertyValue $workflow @('nodes')))){
      $credentials=Get-PropertyValue $node @('credentials')
      if($null -eq $credentials){continue}
      foreach($prop in $credentials.PSObject.Properties){
        if($prop.Name -notmatch 'gmail|google.*oauth|oauth.*google'){continue}
        $credentialId=[string](Get-PropertyValue $prop.Value @('id'))
        if($credentialId){break}
      }
      if($credentialId){break}
    }
    if(-not $credentialId){Fail 'TESTLAB_GMAIL_CREDENTIAL_REFERENCE_NOT_FOUND'}

    Invoke-N8n @('export:credentials',"--id=$credentialId",'--decrypted',"--output=$credentialPath") | Out-Null
    $credential=(@(As-Array (Read-JsonFile $credentialPath)) | Select-Object -First 1)
    $data=Get-PropertyValue $credential @('data')
    if($null -eq $data){Fail 'TESTLAB_GMAIL_CREDENTIAL_DATA_MISSING'}

    $clientId=[string](Get-PropertyValue $data @('clientId','client_id'))
    $clientSecret=[string](Get-PropertyValue $data @('clientSecret','client_secret'))
    $refreshToken=[string](Get-PropertyValue $data @('refreshToken','refresh_token'))
    $tokenData=Get-PropertyValue $data @('oauthTokenData','oauth_token_data','tokenData','token_data')
    if($tokenData){
      $parsed=$null
      if($tokenData -is [string]){try{$parsed=$tokenData|ConvertFrom-Json}catch{}}else{$parsed=$tokenData}
      if($parsed -and -not $refreshToken){$refreshToken=[string](Get-PropertyValue $parsed @('refresh_token','refreshToken'))}
    }
    if(-not $clientId -or -not $clientSecret -or -not $refreshToken){Fail 'TESTLAB_LOCAL_GMAIL_REFRESH_CREDENTIAL_INCOMPLETE'}

    $env:BUYFLOW_TESTLAB_GMAIL_CLIENT_ID=$clientId
    $env:BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET=$clientSecret
    $env:BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN=$refreshToken
    Write-Host 'TestLab Gmail OAuth: existing local n8n credential loaded (values hidden).' -ForegroundColor Green
  } else {
    Write-Host 'TestLab Gmail OAuth: injected credential available (values hidden).' -ForegroundColor Green
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $inner -ReportDir $ReportDir
  exit $LASTEXITCODE
} finally {
  if(Test-Path -LiteralPath $credentialPath){try{Clear-Content -LiteralPath $credentialPath -Force -ErrorAction SilentlyContinue}catch{}}
  if(Test-Path -LiteralPath $tempRoot){Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue}
  if($null -eq $originalUserFolder){Remove-Item Env:N8N_USER_FOLDER -ErrorAction SilentlyContinue}else{$env:N8N_USER_FOLDER=$originalUserFolder}
  if($hadClientId){$env:BUYFLOW_TESTLAB_GMAIL_CLIENT_ID=$oldClientId}else{Remove-Item Env:BUYFLOW_TESTLAB_GMAIL_CLIENT_ID -ErrorAction SilentlyContinue}
  if($hadClientSecret){$env:BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET=$oldClientSecret}else{Remove-Item Env:BUYFLOW_TESTLAB_GMAIL_CLIENT_SECRET -ErrorAction SilentlyContinue}
  if($hadRefreshToken){$env:BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN=$oldRefreshToken}else{Remove-Item Env:BUYFLOW_TESTLAB_GMAIL_REFRESH_TOKEN -ErrorAction SilentlyContinue}
}
