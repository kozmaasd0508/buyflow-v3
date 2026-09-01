$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "v11-semantic-view-ab-v1.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V11 - SEMANTIC EMAIL VIEW A/B V1" -ForegroundColor Cyan
Write-Host "Ugyanaz a 180 lezart eset | regi teljes dokumentum vs uj AI-nezet" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez a teszt NEM tanit es NEM modositja a V11 adaptert." -ForegroundColor Green
Write-Host "A korabbi Fresh Blind eredmenyt baseline-kent ujrahasznalja." -ForegroundColor Green
Write-Host "Csak az uj SemanticEmailView oldalt futtatja, igy kb. egy Fresh Blind futas ideje." -ForegroundColor Green
Write-Host "Ha bezarod az ablakot, az eredmenyek esetenkent mentodnek es ujrainditasnal folytatja." -ForegroundColor Green
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

Write-Host "[1/3] Korabbi Fresh Blind baseline ellenorzese..." -ForegroundColor Yellow
$baselineLatest = Join-Path $project "local-data\lora-v11\fresh-blind-v1\LATEST_EVAL.txt"
if (-not (Test-Path $baselineLatest)) { throw "FRESH_BLIND_BASELINE_MISSING: $baselineLatest" }
$baselineWsl = (Get-Content $baselineLatest -Raw).Trim()
$baselineWin = Convert-FromWslPath $baselineWsl
$baselineMetrics = Join-Path $baselineWin "metrics.json"
$baselinePredictions = Join-Path $baselineWin "predictions.jsonl"
if (-not (Test-Path $baselineMetrics)) { throw "FRESH_BLIND_METRICS_MISSING: $baselineMetrics" }
if (-not (Test-Path $baselinePredictions)) { throw "FRESH_BLIND_PREDICTIONS_MISSING: $baselinePredictions" }
$b = Get-Content $baselineMetrics -Raw | ConvertFrom-Json
if ($b.status -ne "V11_FRESH_BLIND_V1_COMPLETE") { throw "FRESH_BLIND_STATUS_UNEXPECTED: $($b.status)" }
Write-Host "Baseline: $($b.exact_correct)/$($b.total) exact ($([Math]::Round(100*$b.exact_accuracy,2))%)" -ForegroundColor Green
Write-Host "Fixture SHA: $($b.fixture_sha256)" -ForegroundColor Gray

Write-Host ""
Write-Host "[2/3] SemanticEmailView futtatasa..." -ForegroundColor Yellow
Write-Host "A teljes technikai dokumentum helyett csak a jelentest hordozó mezoket kapja a Qwen." -ForegroundColor Gray
Write-Host "A prompt utasitasa ugyanaz marad; csak a bemeneti nezete valtozik." -ForegroundColor Gray
Write-Host ""

& wsl.exe -d $distro -- env HSA_ENABLE_DXG_DETECTION=1 TOKENIZERS_PARALLELISM=false $wslPython $wslRunner $wslProject
if ($LASTEXITCODE -ne 0) { throw "V11_SEMANTIC_VIEW_AB_FAILED" }

Write-Host ""
Write-Host "[3/3] A/B eredmeny..." -ForegroundColor Yellow
$latest = Join-Path $project "local-data\lora-v11\semantic-view-ab-v1\LATEST_EVAL.txt"
if (-not (Test-Path $latest)) { throw "SEMANTIC_VIEW_LATEST_MISSING" }
$evalWsl = (Get-Content $latest -Raw).Trim()
$evalWin = Convert-FromWslPath $evalWsl
$resultFile = Join-Path $evalWin "metrics.json"
if (-not (Test-Path $resultFile)) { throw "SEMANTIC_VIEW_METRICS_MISSING: $resultFile" }
$r = Get-Content $resultFile -Raw | ConvertFrom-Json

Write-Host ""
Write-Host "REGI TELJES DOKUMENTUM" -ForegroundColor Cyan
Write-Host "  Exact: $($r.baseline.exact_correct)/$($r.baseline.total) ($([Math]::Round(100*$r.baseline.exact_accuracy,2))%)"
Write-Host "  Invalid: $($r.baseline.invalid_output_count)"
Write-Host "  Unsafe: $($r.baseline.unsafe_promotion_count)"
Write-Host "  Critical boundary: $($r.baseline.critical_boundary_error_count)"
Write-Host ""
Write-Host "UJ SEMANTIC EMAIL VIEW" -ForegroundColor Cyan
Write-Host "  Exact: $($r.semantic.exact_correct)/$($r.semantic.total) ($([Math]::Round(100*$r.semantic.exact_accuracy,2))%)"
Write-Host "  Macro: $([Math]::Round(100*$r.semantic.macro_event_accuracy,2))%"
Write-Host "  Invalid: $($r.semantic.invalid_output_count)"
Write-Host "  Unsafe: $($r.semantic.unsafe_promotion_count)"
Write-Host "  Critical boundary: $($r.semantic.critical_boundary_error_count)"
Write-Host ""
Write-Host "Paros osszehasonlitas:" -ForegroundColor Cyan
Write-Host "  Semantic-only helyes: $($r.paired.semantic_only_correct)"
Write-Host "  Baseline-only helyes: $($r.paired.baseline_only_correct)"
Write-Host "  Netto nyeres: $($r.paired.net_exact_wins)"
Write-Host ""
Write-Host "Javaslat: $($r.recommendation)" -ForegroundColor Yellow
Write-Host "Metrics: $resultFile" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez diagnosztikai A/B teszt. A 180 lezart esetre tovabbra sem tanitunk ra." -ForegroundColor Green
