$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "train-v12-retention-qwen-v1.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V12 - RETENTION ROBUSTNESS QLORA" -ForegroundColor Cyan
Write-Host "V11 best adapter -> kulon V12 child adapter" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "EZ MAR VALODI MODELL-TANITAS." -ForegroundColor Yellow
Write-Host "1296 TRAIN = 1152 V11 retention replay + 144 uj hard sibling." -ForegroundColor Green
Write-Host "360 VALIDATION = 288 V11 retention + 72 hard sibling; validation sor nem kerul trainbe." -ForegroundColor Green
Write-Host "A V11 best adaptert forraskent betolti, de NEM irja felul; uj V12 run mappaba ment." -ForegroundColor Green
Write-Host "Fresh Blind / Input View Holdout / frozen108 / BLIND50 nincs olvasva vagy tanitva." -ForegroundColor Gray
Write-Host "Alapertelmezett: 1 epoch, LR=2e-5, grad_accum=4, MAX_SEQ=768." -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path $project)) { throw "PROJECT_NOT_FOUND: $project" }
if (-not (Test-Path $runner)) { throw "RUNNER_NOT_FOUND: $runner" }

function Convert-ToWslPath([string]$p) {
    $full = [System.IO.Path]::GetFullPath($p)
    if ($full -notmatch '^([A-Za-z]):\\(.*)$') { throw "WSL_PATH_UNSUPPORTED: $full" }
    $drive = $Matches[1].ToLowerInvariant()
    $rest = $Matches[2].Replace('\','/')
    return "/mnt/$drive/$rest"
}

$wslProject = Convert-ToWslPath $project
$wslRunner = Convert-ToWslPath $runner
$wslHome = (& wsl.exe -d $distro -- sh -c 'printf %s "$HOME"').Trim()
if ([string]::IsNullOrWhiteSpace($wslHome)) { throw "WSL_HOME_NOT_FOUND" }
$wslPython = "$wslHome/.venvs/buyflow-lora/bin/python"

& wsl.exe -d $distro -- test -x $wslPython
if ($LASTEXITCODE -ne 0) { throw "LORA_PYTHON_NOT_FOUND: $wslPython" }

$env:HSA_ENABLE_DXG_DETECTION = "1"
$env:TOKENIZERS_PARALLELISM = "false"
$env:BUYFLOW_V12_EPOCHS = "1"
$env:BUYFLOW_V12_GRAD_ACCUM = "4"
$env:BUYFLOW_V12_LR = "0.00002"
$env:BUYFLOW_V12_MAX_SEQ = "768"
$priorWslEnv = $env:WSLENV
$add = "HSA_ENABLE_DXG_DETECTION:TOKENIZERS_PARALLELISM:BUYFLOW_V12_EPOCHS:BUYFLOW_V12_GRAD_ACCUM:BUYFLOW_V12_LR:BUYFLOW_V12_MAX_SEQ"
if ([string]::IsNullOrWhiteSpace($priorWslEnv)) { $env:WSLENV = $add } else { $env:WSLENV = "$priorWslEnv`:$add" }

try {
    & wsl.exe -d $distro -- $wslPython $wslRunner $wslProject
    if ($LASTEXITCODE -ne 0) { throw "V12_RETENTION_TRAIN_FAILED" }
} finally {
    $env:WSLENV = $priorWslEnv
}

Write-Host ""
Write-Host "Kesz. Kuldd el a # BUYFLOW V12 QWEN3-8B RETENTION ROBUSTNESS QLORA elejet es a vegso [6/6] blokkot." -ForegroundColor Cyan
