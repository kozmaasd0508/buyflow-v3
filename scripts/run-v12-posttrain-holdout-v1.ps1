$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "v12-posttrain-holdout-v1.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V12 - POSTTRAIN UNTOUCHED HOLDOUT V1" -ForegroundColor Cyan
Write-Host "108 fresh cases | 18 events | 6 languages | freeze only" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez NEM tanit es NEM futtat modellt." -ForegroundColor Green
Write-Host "Most csak letrehozza es SHA-val befagyasztja az uj, training utan keszult holdoutot." -ForegroundColor Green
Write-Host "Fresh Blind / Input View Holdout / frozen108 / BLIND50 / training corpus nincs olvasva." -ForegroundColor Gray
Write-Host "A fagyasztott corpus utolag nem szerkesztheto; konfliktus eseten fail-closed." -ForegroundColor Gray
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

& wsl.exe -d $distro -- env TOKENIZERS_PARALLELISM=false $wslPython $wslRunner $wslProject
if ($LASTEXITCODE -ne 0) { throw "V12_POSTTRAIN_HOLDOUT_V1_FAILED" }

Write-Host ""
Write-Host "Kesz. Kuldd el a # BUYFLOW V12 POSTTRAIN UNTOUCHED HOLDOUT V1 blokkot, foleg a holdout_sha256 sort." -ForegroundColor Cyan
