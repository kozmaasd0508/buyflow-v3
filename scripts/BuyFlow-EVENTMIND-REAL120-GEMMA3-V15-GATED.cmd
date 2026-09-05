@echo off
setlocal
title BuyFlow EventMind REAL120 - Gemma V15 Gated

set "RUNNER_COMMIT=448a1aca5217a2b8129d3039fa6fe3664948a578"
set "RUNNER_URL=https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/%RUNNER_COMMIT%/scripts/run-eventmind-v15-gemma-gated-real120-bootstrap.ps1"
set "RUNNER=%TEMP%\buyflow-eventmind-v15-gated-%RANDOM%%RANDOM%.ps1"

echo.
echo ==============================================================
echo BUYFLOW EVENTMIND V15 - GEMMA BUYER GATE + EVENT CLASSIFIER
echo V15 BOUNDARIES / 8192 CONTEXT / JSON SCHEMA / NO CHUNKS
echo Gmail GET-only / BuyFlow production OFF
echo Baseline: V14 = 85/120
echo ==============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%RUNNER_URL%' -OutFile '%RUNNER%' -TimeoutSec 30"
if errorlevel 1 (
  echo.
  echo RUNNER_DOWNLOAD_FAILED
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RUNNER%"
set "RC=%ERRORLEVEL%"
del /q "%RUNNER%" >nul 2>&1

echo.
if "%RC%"=="0" (
  echo GEMMA V15 GATED REAL120 COMPLETE.
  echo A report a Desktopon van: BuyFlow-EVENTMIND-REAL120-GEMMA3-V15-GATED-*.json
) else (
  echo GEMMA V15 GATED REAL120 FAILED/BLOCKED. Exit code: %RC%
)
echo.
pause
exit /b %RC%
