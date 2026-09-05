@echo off
setlocal
title BuyFlow EventMind REAL120 - Gemma V14 Gated

set "RUNNER_COMMIT=a1122398edc516cea49a9da69598283a41087069"
set "RUNNER_URL=https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/%RUNNER_COMMIT%/scripts/run-eventmind-v14-gemma-gated-real120-direct.ps1"
set "RUNNER=%TEMP%\buyflow-eventmind-v14-gated-%RANDOM%%RANDOM%.ps1"

echo.
echo ==============================================================
echo BUYFLOW EVENTMIND V14 - GEMMA BUYER GATE + EVENT CLASSIFIER
echo FULL EMAIL / 8192 CONTEXT / JSON SCHEMA / NO CHUNKS
echo Gmail GET-only / BuyFlow production OFF
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
  echo GEMMA V14 GATED REAL120 COMPLETE.
  echo A report a Desktopon van: BuyFlow-EVENTMIND-REAL120-GEMMA3-V14-GATED-*.json
) else (
  echo GEMMA V14 GATED REAL120 FAILED/BLOCKED. Exit code: %RC%
)
echo.
pause
exit /b %RC%
