$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "v12-hard-siblings-posttrain-resolved-v2.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V12 - HARD SIBLINGS V2 / POST-TRAIN" -ForegroundColor Cyan
Write-Host "72 validation sibling | trained V12 + constrained output" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez NEM tanit es NEM modositja a corpust." -ForegroundColor Green
Write-Host "A 72 fix validation siblingen meri a most elmentett V12 best adaptert." -ForegroundColor Green
Write-Host "A V12 LATEST pointert, metrics statust, adapter SHA-t es a valtozatlan V11 parent SHA-t ellenorzi." -ForegroundColor Green
Write-Host "V11 baseline: 70/72. Frozen holdoutot nem olvas." -ForegroundColor Gray
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

& wsl.exe -d $distro -- env HSA_ENABLE_DXG_DETECTION=1 TOKENIZERS_PARALLELISM=false $wslPython $wslRunner $wslProject
if ($LASTEXITCODE -ne 0) { throw "V12_HARD_SIBLINGS_POSTTRAIN_FAILED" }

Write-Host ""
Write-Host "Kesz. Kuldd el a # SUMMARY + # BY_VARIANT + # WRONG_TRANSITIONS reszt." -ForegroundColor Cyan
