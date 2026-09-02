$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "v12-hard-siblings-v2.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V12 - HARD SIBLINGS V2" -ForegroundColor Cyan
Write-Host "Human-teacher rule -> uj synthetic robustness corpus" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez NEM tanit es NEM hiv kulso API-t." -ForegroundColor Green
Write-Host "216 uj synthetic/deidentified sibling: 144 TRAIN candidate + 72 VALIDATION." -ForegroundColor Green
Write-Host "Fokusz: ORDER_PROCESSING vs ORDER_PACKING + stale subject/snippet/layout invariancia." -ForegroundColor Gray
Write-Host "A korabbi 14 teacher queue sort es frozen holdoutokat NEM masolja." -ForegroundColor Gray
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

& wsl.exe -d $distro -- $wslPython $wslRunner $wslProject
if ($LASTEXITCODE -ne 0) { throw "V12_HARD_SIBLINGS_V2_FAILED" }

Write-Host ""
Write-Host "Kesz. Kuldd el a teljes # BUYFLOW V12 HARD SIBLINGS V2 blokkot." -ForegroundColor Cyan
