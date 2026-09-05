param(
  [Parameter(Mandatory=$true)][string]$IdFile,
  [Parameter(Mandatory=$true)][string]$ExpectedIdSha256
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$CodeCommit='106dcc679d6f611a6f8206bfc707f7ae9a7980b3'
$InnerUrl='https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/106dcc679d6f611a6f8206bfc707f7ae9a7980b3/scripts/run-eventmind-v11-real-gmail-blind120.ps1'
$tempRoot=Join-Path $env:TEMP ('buyflow-blind120-v2-' + [guid]::NewGuid().ToString('N'))
$codeRoot=Join-Path $tempRoot 'code'
$inner=Join-Path $tempRoot 'inner.ps1'
$repoRoot=$null
$modelRoot=$null
$nodeJunction=$false
$localDataJunction=$false

function Fail([string]$m){ throw $m }
function Run-Git([string[]]$args){
  $out=& git.exe @args 2>&1
  if($LASTEXITCODE -ne 0){ throw ('GIT_FAILED: git ' + ($args -join ' ') + "`n" + ($out -join "`n")) }
  return @($out)
}
function Is-BuyFlowRepo([string]$p){
  if(-not (Test-Path -LiteralPath $p)){ return $false }
  try {
    $remote=(& git.exe -C $p remote get-url origin 2>$null | Select-Object -First 1)
    return ([string]$remote -match 'kozmaasd0508[\\/]buyflow-v3(?:\.git)?$')
  } catch { return $false }
}
function Find-RepoRoot {
  $known=@(
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation'),
    (Join-Path $env:USERPROFILE 'Desktop\buyflow\buyflow-v3')
  )
  foreach($p in $known){ if(Is-BuyFlowRepo $p){ return $p } }
  $base=Join-Path $env:USERPROFILE 'Desktop\buyflow'
  if(-not (Test-Path $base)){ return $null }
  $packages=@(Get-ChildItem -LiteralPath $base -Filter package.json -File -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\\/]apps[\\/]api[\\/]package\.json$' })
  foreach($pkg in $packages){
    $api=Split-Path -Parent $pkg.FullName
    $apps=Split-Path -Parent $api
    $candidate=Split-Path -Parent $apps
    if(Is-BuyFlowRepo $candidate){ return $candidate }
  }
  return $null
}
function Find-ModelRoot([string]$preferred){
  if(Test-Path -LiteralPath (Join-Path $preferred 'local-data\lora-v11\LATEST.txt')){ return $preferred }
  $base=Join-Path $env:USERPROFILE 'Desktop\buyflow'
  $hits=@(Get-ChildItem -LiteralPath $base -Filter LATEST.txt -File -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Directory.Name -eq 'lora-v11' })
  foreach($hit in $hits){
    $lora=Split-Path -Parent $hit.FullName
    $localData=Split-Path -Parent $lora
    $candidate=Split-Path -Parent $localData
    if(Test-Path -LiteralPath (Join-Path $candidate 'local-data\lora-v11\LATEST.txt')){ return $candidate }
  }
  return $null
}
function Remove-Junction([string]$p){
  if(Test-Path -LiteralPath $p){ cmd.exe /d /c "rmdir `"$p`"" | Out-Null }
}

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
  Write-Host ''
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'BUYFLOW EVENTMIND V11 - REAL GMAIL BLIND120 V2' -ForegroundColor Cyan
  Write-Host 'EXACT CODE WORKTREE + EXISTING LOCAL V11 MODEL' -ForegroundColor Cyan
  Write-Host '==============================================================' -ForegroundColor Cyan
  Write-Host 'Semmit nem kapcsol elesre es nem ir a Gmailbe/BuyFlow DB-be.' -ForegroundColor Green
  Write-Host ''

  if(-not (Get-Command git.exe -ErrorAction SilentlyContinue)){ Fail 'GIT_NOT_FOUND' }
  if(-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)){ Fail 'NPM_NOT_FOUND' }
  if(-not (Test-Path -LiteralPath $IdFile)){ Fail "ID_FILE_NOT_FOUND: $IdFile" }

  $repoRoot=Find-RepoRoot
  if(-not $repoRoot){ Fail 'BUYFLOW_GIT_REPOSITORY_NOT_FOUND' }
  $modelRoot=Find-ModelRoot $repoRoot
  if(-not $modelRoot){ Fail 'V11_MODEL_ROOT_NOT_FOUND' }

  Write-Host ('Local BuyFlow repo: ' + $repoRoot)
  Write-Host ('V11 model root:    ' + $modelRoot)

  $hasCommit=$false
  & git.exe -C $repoRoot cat-file -e ($CodeCommit + '^{commit}') 2>$null
  if($LASTEXITCODE -eq 0){ $hasCommit=$true }
  if(-not $hasCommit){
    Write-Host 'A pontos V11 kod letoltese GitHubrol...' -ForegroundColor Yellow
    Run-Git @('-C',$repoRoot,'fetch','origin','codex/modern-email-source-foundation-v1') | Out-Null
    & git.exe -C $repoRoot cat-file -e ($CodeCommit + '^{commit}') 2>$null
    if($LASTEXITCODE -ne 0){ Fail 'EXACT_V11_CODE_COMMIT_NOT_AVAILABLE_AFTER_FETCH' }
  }

  Write-Host 'Ideiglenes pontos kod-worktree letrehozasa...' -ForegroundColor Yellow
  Run-Git @('-C',$repoRoot,'worktree','add','--detach',$codeRoot,$CodeCommit) | Out-Null

  $localDataSource=Join-Path $modelRoot 'local-data'
  if(-not (Test-Path -LiteralPath $localDataSource)){ Fail 'LOCAL_DATA_NOT_FOUND' }
  $localDataTarget=Join-Path $codeRoot 'local-data'
  if(Test-Path -LiteralPath $localDataTarget){ Remove-Item -LiteralPath $localDataTarget -Recurse -Force }
  cmd.exe /d /c "mklink /J `"$localDataTarget`" `"$localDataSource`"" | Out-Null
  if($LASTEXITCODE -ne 0){ Fail 'LOCAL_DATA_JUNCTION_FAILED' }
  $localDataJunction=$true

  $nodeSource=Join-Path $repoRoot 'node_modules'
  $nodeTarget=Join-Path $codeRoot 'node_modules'
  if(Test-Path -LiteralPath $nodeSource){
    cmd.exe /d /c "mklink /J `"$nodeTarget`" `"$nodeSource`"" | Out-Null
    if($LASTEXITCODE -ne 0){ Fail 'NODE_MODULES_JUNCTION_FAILED' }
    $nodeJunction=$true
  } else {
    Write-Host 'node_modules nincs a fo repoban; ideiglenes npm ci indul...' -ForegroundColor Yellow
    Push-Location $codeRoot
    try {
      & npm.cmd ci --ignore-scripts --no-audit --no-fund
      if($LASTEXITCODE -ne 0){ Fail 'NPM_CI_FAILED' }
    } finally { Pop-Location }
  }

  Invoke-WebRequest -UseBasicParsing -Uri $InnerUrl -OutFile $inner -TimeoutSec 30
  $raw=Get-Content -Raw -LiteralPath $inner
  $needle='$known = @('
  if(-not $raw.Contains($needle)){ Fail 'INNER_PROJECT_PATCH_POINT_NOT_FOUND' }
  $replacement="`$known = @(`r`n        `$env:BUYFLOW_BLIND120_EXACT_PROJECT,"
  $raw=$raw.Replace($needle,$replacement)
  [IO.File]::WriteAllText($inner,$raw,(New-Object Text.UTF8Encoding($false)))

  $env:BUYFLOW_BLIND120_EXACT_PROJECT=$codeRoot
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $inner -IdFile $IdFile -ExpectedIdSha256 $ExpectedIdSha256
  $exit=$LASTEXITCODE
  if($exit -ne 0){ exit $exit }
} catch {
  Write-Host ''
  Write-Host ('BLIND120 V2 BLOCKED/FAIL - ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Semmi nincs elesitve. Gmail/BuyFlow production modositas nem tortent.' -ForegroundColor Yellow
  exit 1
} finally {
  Remove-Item Env:BUYFLOW_BLIND120_EXACT_PROJECT -ErrorAction SilentlyContinue
  if($nodeJunction){ Remove-Junction (Join-Path $codeRoot 'node_modules') }
  if($localDataJunction){ Remove-Junction (Join-Path $codeRoot 'local-data') }
  if($repoRoot -and (Test-Path -LiteralPath $codeRoot)){
    try { & git.exe -C $repoRoot worktree remove --force $codeRoot 2>$null | Out-Null } catch {}
    try { & git.exe -C $repoRoot worktree prune 2>$null | Out-Null } catch {}
  }
  if(Test-Path -LiteralPath $tempRoot){ Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
