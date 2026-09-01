$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "v11-input-view-holdout-v2.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V11 - INPUT VIEW HOLDOUT V2" -ForegroundColor Cyan
Write-Host "180 uj erintetlen eset | FULL vs SEMANTIC vs MINIMAL" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez a teszt NEM tanit. Uj fixture-t hasznal, nem a korabbi 180-at." -ForegroundColor Green
Write-Host "A frozen108, BLIND50 es valodi Gmail holdout tovabbra sincs beolvasva." -ForegroundColor Green
Write-Host "Harom nezettel fut, ez kb. 3 Fresh Blind futas ideje lehet." -ForegroundColor Gray
Write-Host "Minden eset utan checkpointol, megszakitas utan folytathato." -ForegroundColor Gray
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

Write-Host "[1/2] Uj fixture + V11 adapter ellenorzese..." -ForegroundColor Yellow
Write-Host "Frozen fixture SHA: 8ef40626b99b5ff1bc567829f484f74f6b539320ec13f9728bba648ef605b352" -ForegroundColor Gray
Write-Host ""
Write-Host "[2/2] FULL -> SEMANTIC -> MINIMAL futtatasa..." -ForegroundColor Yellow
Write-Host ""

& wsl.exe -d $distro -- env HSA_ENABLE_DXG_DETECTION=1 TOKENIZERS_PARALLELISM=false $wslPython $wslRunner $wslProject
if ($LASTEXITCODE -ne 0) { throw "V11_INPUT_VIEW_HOLDOUT_V2_FAILED" }

Write-Host ""
Write-Host "Kesz. Kuldd el a # RESULT reszt." -ForegroundColor Cyan
