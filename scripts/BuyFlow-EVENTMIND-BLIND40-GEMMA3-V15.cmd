@echo off
setlocal
title BuyFlow EventMind TRUE BLIND40 - Gemma V15

set "RUNNER_COMMIT=95beb6ec5b4092e69f175e88288d5061313689a5"
set "RUNNER_URL=https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/%RUNNER_COMMIT%/scripts/run-eventmind-v15-gemma-blind40-bootstrap.ps1"
set "RUNNER=%TEMP%\buyflow-eventmind-blind40-%RANDOM%%RANDOM%.ps1"

echo.
echo ==============================================================
echo BUYFLOW EVENTMIND V15 - TRUE BLIND40 HOLDOUT
echo 40 UNSEEN REAL GMAIL / FROZEN BEFORE MODEL RUN
echo V15 / 8192 CONTEXT / JSON SCHEMA / NO CHUNKS
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
  echo TRUE BLIND40 V15 COMPLETE.
  echo A report a Desktopon van: BuyFlow-EVENTMIND-BLIND40-GEMMA3-V15-*.json
) else (
  echo TRUE BLIND40 V15 FAILED/BLOCKED. Exit code: %RC%
)
echo.
pause
exit /b %RC%
