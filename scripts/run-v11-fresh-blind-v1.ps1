$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "v11-fresh-blind-v1.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V11 - FRESH BLIND TEST V1" -ForegroundColor Cyan
Write-Host "180 uj vak eset | 18 event | production NormalizedEmailDocumentV1" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez a teszt NEM tanit. A V11 adapterhez nem nyul." -ForegroundColor Green
Write-Host "A frozen108, BLIND50 es valodi Gmail holdout nincs beolvasva." -ForegroundColor Green
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

function Convert-FromWslPath([string]$p) {
    if ($p -notmatch '^/mnt/([a-zA-Z])/(.*)$') { throw "WINDOWS_PATH_UNSUPPORTED: $p" }
    return ($Matches[1].ToUpperInvariant() + ':\' + ($Matches[2] -replace '/','\'))
}

$wslProject = Convert-ToWslPath $project
$wslRunner = Convert-ToWslPath $runner
$wslHome = (& wsl.exe -d $distro -- sh -c 'printf %s "$HOME"').Trim()
if ([string]::IsNullOrWhiteSpace($wslHome)) { throw "WSL_HOME_NOT_FOUND" }
$wslPython = "$wslHome/.venvs/buyflow-lora/bin/python"

& wsl.exe -d $distro -- test -x $wslPython
if ($LASTEXITCODE -ne 0) { throw "LORA_PYTHON_NOT_FOUND: $wslPython" }

Write-Host "[1/3] V11 adapter + isolation gate ellenorzese..." -ForegroundColor Yellow
$latest = Join-Path $project "local-data\lora-v11\LATEST.txt"
if (-not (Test-Path $latest)) { throw "V11_LATEST_MISSING: $latest" }
$runWsl = (Get-Content $latest -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($runWsl)) { throw "V11_LATEST_EMPTY" }
$runWin = Convert-FromWslPath $runWsl
$metricsPath = Join-Path $runWin "metrics.json"
$adapterPath = Join-Path $runWin "best\adapter_model.safetensors"
if (-not (Test-Path $metricsPath)) { throw "V11_METRICS_MISSING: $metricsPath" }
if (-not (Test-Path $adapterPath)) { throw "V11_ADAPTER_MISSING: $adapterPath" }
$m = Get-Content $metricsPath -Raw | ConvertFrom-Json
if ($m.status -ne "LORA_V11_NORMALIZED_SEMANTIC_TRAIN_COMPLETE") { throw "V11_STATUS_UNEXPECTED: $($m.status)" }
if ($m.frozen_108_trained -ne $false -or $m.blind_50_trained -ne $false -or $m.locked_test_read -ne $false -or $m.locked_test_trained -ne $false) {
    throw "V11_ISOLATION_GATE_FAILED"
}
Write-Host "V11 adapter: OK" -ForegroundColor Green
Write-Host "Training isolation: PASS" -ForegroundColor Green

Write-Host ""
Write-Host "[2/3] Fresh blind v1 futtatasa..." -ForegroundColor Yellow
Write-Host "180 szintetikus, teljesen uj eset. A fixture elobb lezarodik SHA-256-tal, utana indul a modell." -ForegroundColor Gray
Write-Host "Ez nehany percig tarthat." -ForegroundColor Gray
Write-Host ""

& wsl.exe -d $distro -- env HSA_ENABLE_DXG_DETECTION=1 TOKENIZERS_PARALLELISM=false $wslPython $wslRunner $wslProject
if ($LASTEXITCODE -ne 0) { throw "V11_FRESH_BLIND_FAILED" }

Write-Host ""
Write-Host "[3/3] Eredmeny ellenorzese..." -ForegroundColor Yellow
$latestEval = Join-Path $project "local-data\lora-v11\fresh-blind-v1\LATEST_EVAL.txt"
if (-not (Test-Path $latestEval)) { throw "V11_FRESH_BLIND_LATEST_MISSING" }
$evalWsl = (Get-Content $latestEval -Raw).Trim()
$evalWin = Convert-FromWslPath $evalWsl
$resultFile = Join-Path $evalWin "metrics.json"
if (-not (Test-Path $resultFile)) { throw "V11_FRESH_BLIND_METRICS_MISSING: $resultFile" }
$r = Get-Content $resultFile -Raw | ConvertFrom-Json

Write-Host ""
if ($r.gate -eq "PASS") {
    Write-Host "FRESH BLIND GATE: PASS" -ForegroundColor Green
} else {
    Write-Host "FRESH BLIND GATE: FAIL" -ForegroundColor Red
}
Write-Host "Exact: $($r.exact_correct)/$($r.total) ($([Math]::Round(100*$r.exact_accuracy,2))%)"
Write-Host "Commerce: $($r.commerce_correct)/$($r.total) ($([Math]::Round(100*$r.commerce_accuracy,2))%)"
Write-Host "Macro event: $([Math]::Round(100*$r.macro_event_accuracy,2))%"
Write-Host "Invalid output: $($r.invalid_output_count)"
Write-Host "Unsafe promotion: $($r.unsafe_promotion_count)"
Write-Host "OTHER -> commerce FP: $($r.other_false_commerce_count)"
Write-Host "Critical boundary errors: $($r.critical_boundary_error_count)"
Write-Host ""
Write-Host "Metrics: $resultFile" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ne tanitsunk ra. Kuldd el nekem ezt az eredmenyt, es utana jon a frozen108 / BLIND50 dontes." -ForegroundColor Cyan
