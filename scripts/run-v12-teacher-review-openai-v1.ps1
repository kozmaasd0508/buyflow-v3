$ErrorActionPreference = "Stop"

$project = "$env:USERPROFILE\Desktop\buyflow\01_AKTUALIS_PROJEKT\BuyFlow_V2_6_Smart_Home_Automation"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$distro = "Ubuntu-24.04"
$runner = Join-Path $here "v12-teacher-review-openai-v1.py"

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "BUYFLOW V12 - OPENAI TEACHER REVIEW V1" -ForegroundColor Cyan
Write-Host "Sol teacher | csak synthetic/deidentified review queue" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ez 14 koruli synthetic teacher-review esetet kuld az OpenAI Responses API-nak." -ForegroundColor Yellow
Write-Host "A seed cimke es a Qwen valasza NINCS megmutatva a teachernek." -ForegroundColor Green
Write-Host "store=false, nincs trening, nincs Purchase/Identity/Gmail/DB iras." -ForegroundColor Green
Write-Host ""

if (-not (Test-Path $project)) { throw "PROJECT_NOT_FOUND: $project" }
if (-not (Test-Path $runner)) { throw "RUNNER_NOT_FOUND: $runner" }
if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) {
    throw "OPENAI_API_KEY_MISSING - allitsd be csak a sajat PowerShell ablakodban; SOHA ne kuldd el a kulcsot chatben."
}

if ([string]::IsNullOrWhiteSpace($env:BUYFLOW_TEACHER_MODEL)) {
    $env:BUYFLOW_TEACHER_MODEL = "gpt-5.6-sol"
}
if ([string]::IsNullOrWhiteSpace($env:BUYFLOW_TEACHER_REASONING)) {
    $env:BUYFLOW_TEACHER_REASONING = "high"
}

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

$oldWslEnv = $env:WSLENV
try {
    $names = @()
    if (-not [string]::IsNullOrWhiteSpace($oldWslEnv)) { $names += ($oldWslEnv -split ':') }
    foreach ($name in @("OPENAI_API_KEY", "BUYFLOW_TEACHER_MODEL", "BUYFLOW_TEACHER_REASONING")) {
        if ($names -notcontains $name) { $names += $name }
    }
    $env:WSLENV = ($names | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ':'

    & wsl.exe -d $distro -- $wslPython $wslRunner $wslProject
    if ($LASTEXITCODE -ne 0) { throw "V12_OPENAI_TEACHER_REVIEW_FAILED" }
}
finally {
    $env:WSLENV = $oldWslEnv
}

Write-Host ""
Write-Host "Kesz. Kuldd el a # SUMMARY reszt. API kulcsot SOHA ne kuldj." -ForegroundColor Cyan
