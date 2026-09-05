param(
  [switch]$SkipBackendInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Join-Path $env:USERPROFILE 'Desktop\buyflow\.lemonade-setup'
$msi = Join-Path $root 'lemonade-server-minimal.msi'
$summaryPath = Join-Path $env:USERPROFILE 'Desktop\BuyFlow-LEMONADE-SETUP-SUMMARY.json'
$systemInfoPath = Join-Path $env:USERPROFILE 'Desktop\BuyFlow-LEMONADE-SYSTEM-INFO.json'
$downloadUrl = 'https://github.com/lemonade-sdk/lemonade/releases/latest/download/lemonade-server-minimal.msi'
$apiBase = 'http://127.0.0.1:13305'

function Write-Step([string]$text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Cyan
}

function Test-LemonadeApi {
  try {
    $null = Invoke-RestMethod -Uri "$apiBase/v1/models" -Method Get -TimeoutSec 3
    return $true
  } catch {
    return $false
  }
}

function Find-LemonadeExe([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "lemonade_server\$name"),
    (Join-Path $env:LOCALAPPDATA "Lemonade Server\$name"),
    (Join-Path $env:ProgramFiles "Lemonade Server\$name")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

New-Item -ItemType Directory -Force -Path $root | Out-Null

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'BUYFLOW - LEMONADE LOCAL AI SETUP (WINDOWS / AMD)' -ForegroundColor Green
Write-Host 'Ollama es n8n valtozatlan marad.' -ForegroundColor Yellow
Write-Host 'Lemonade kulon helyi API: 127.0.0.1:13305' -ForegroundColor Yellow
Write-Host '==============================================================' -ForegroundColor Green

if (-not (Test-LemonadeApi)) {
  Write-Step '[1/5] Hivatalos Lemonade Server MSI letoltese...'
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $msi -TimeoutSec 180
  if (-not (Test-Path -LiteralPath $msi)) { throw 'LEMONADE_MSI_DOWNLOAD_FAILED' }
  $size = (Get-Item -LiteralPath $msi).Length
  if ($size -lt 1000000) { throw "LEMONADE_MSI_TOO_SMALL:$size" }
  Write-Host ("MSI letoltve: {0:N1} MB" -f ($size / 1MB)) -ForegroundColor Green

  Write-Step '[2/5] Lemonade Server csendes telepitese...'
  $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', ('"' + $msi + '"'), 'MSIINSTALLPERUSER=1', '/qn', '/norestart') -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    throw "LEMONADE_MSI_INSTALL_FAILED:$($p.ExitCode)"
  }
  Write-Host ('MSI telepites kesz. Exit: ' + $p.ExitCode) -ForegroundColor Green
} else {
  Write-Step '[1-2/5] Lemonade mar fut - ujratelepites kihagyva.'
}

Write-Step '[3/5] Lemonade helyi API inditasa / ellenorzese...'
$lemonadeExe = Find-LemonadeExe 'lemonade.exe'
$lemondExe = Find-LemonadeExe 'lemond.exe'
$desktopExe = Find-LemonadeExe 'LemonadeServer.exe'

for ($i = 0; $i -lt 20 -and -not (Test-LemonadeApi); $i++) {
  Start-Sleep -Seconds 1
}

if (-not (Test-LemonadeApi)) {
  if ($lemondExe) {
    Start-Process -FilePath $lemondExe -WindowStyle Hidden | Out-Null
  } elseif ($desktopExe) {
    Start-Process -FilePath $desktopExe | Out-Null
  } else {
    throw 'LEMONADE_SERVER_EXECUTABLE_NOT_FOUND'
  }
  for ($i = 0; $i -lt 30 -and -not (Test-LemonadeApi); $i++) {
    Start-Sleep -Seconds 1
  }
}

if (-not (Test-LemonadeApi)) { throw 'LEMONADE_API_NOT_READY' }
Write-Host ('Lemonade API READY: ' + $apiBase) -ForegroundColor Green

Write-Step '[4/5] AMD rendszerinfo es gyorsitasi backend...'
$systemInfo = Invoke-RestMethod -Uri "$apiBase/v1/system-info" -Method Get -TimeoutSec 20
$systemInfo | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $systemInfoPath -Encoding UTF8
Write-Host ('System info: ' + $systemInfoPath) -ForegroundColor DarkGray

$backend = 'not-installed'
if (-not $SkipBackendInstall) {
  if (-not $lemonadeExe) { $lemonadeExe = Find-LemonadeExe 'lemonade.exe' }
  if (-not $lemonadeExe) { throw 'LEMONADE_CLI_NOT_FOUND' }

  Write-Host 'ROCm backend probalasa AMD GPU-hoz...' -ForegroundColor Yellow
  & $lemonadeExe backends install 'llamacpp:rocm'
  if ($LASTEXITCODE -eq 0) {
    $backend = 'llamacpp:rocm'
  } else {
    Write-Host 'ROCm nem telepult; Vulkan fallback indul...' -ForegroundColor Yellow
    & $lemonadeExe backends install 'llamacpp:vulkan'
    if ($LASTEXITCODE -ne 0) { throw 'LEMONADE_GPU_BACKEND_INSTALL_FAILED' }
    $backend = 'llamacpp:vulkan'
  }
}
Write-Host ('Kivalasztott backend: ' + $backend) -ForegroundColor Green

Write-Step '[5/5] n8n-kompatibilis helyi vegpont ellenorzese...'
$models = Invoke-RestMethod -Uri "$apiBase/v1/models?show_all=true" -Method Get -TimeoutSec 20
$modelCount = if ($models.data) { @($models.data).Count } else { 0 }

$summary = [ordered]@{
  completed_at = (Get-Date).ToString('o')
  lemonade_api = $apiBase
  openai_compatible_base = "$apiBase/v1"
  n8n_target = 'Lemonade Chat Model / Lemonade credentials'
  n8n_changed = $false
  ollama_changed = $false
  gpu_backend = $backend
  model_download_started = $false
  visible_catalog_models = $modelCount
  system_info_file = $systemInfoPath
  next_step = 'After V16 finishes: choose one fixed GGUF model and create an n8n Lemonade test workflow.'
}
$summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding UTF8

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host 'LEMONADE SETUP: READY' -ForegroundColor Green
Write-Host ('API: ' + $apiBase) -ForegroundColor Cyan
Write-Host ('OpenAI-compatible: ' + $apiBase + '/v1') -ForegroundColor Cyan
Write-Host ('AMD backend: ' + $backend) -ForegroundColor Cyan
Write-Host ('Summary: ' + $summaryPath) -ForegroundColor DarkGray
Write-Host 'Ollama: valtozatlan | n8n: valtozatlan | BuyFlow production: OFF' -ForegroundColor Green
Write-Host 'Modellt most szandekosan nem toltottunk le, hogy ne zavarja a V16 GPU-futast.' -ForegroundColor Yellow
Write-Host '==============================================================' -ForegroundColor Green
