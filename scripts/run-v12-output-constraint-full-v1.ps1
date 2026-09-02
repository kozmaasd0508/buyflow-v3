$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "v12-output-constraint-probe-v1.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V12 - OUTPUT CONSTRAINT FULL V1" -ForegroundColor Cyan
Write-Host "Teljes 180-as FULL holdout -> kenyszeritett ervenyes cimke" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez NEM tanit. Ugyanaz a V11 adapter es ugyanaz a frozen holdout." -ForegroundColor Green
Write-Host "Most mind a 180 esetet ujrafuttatja constrained decodinggal." -ForegroundColor Green
Write-Host "Cel: bizonyitani, hogy a 6 invalid eltunik ugy, hogy a korabban ervenyes valaszok nem romlanak." -ForegroundColor Gray
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

& wsl.exe -d $distro -- env HSA_ENABLE_DXG_DETECTION=1 TOKENIZERS_PARALLELISM=false $wslPython $wslRunner $wslProject --all
if ($LASTEXITCODE -ne 0) { throw "V12_OUTPUT_CONSTRAINT_FULL_FAILED" }

Write-Host ""
Write-Host "Kesz. Kuldd el a # SUMMARY reszt." -ForegroundColor Cyan
