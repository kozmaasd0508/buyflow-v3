@echo off
setlocal
title BuyFlow EventMind REAL120 - Gemma 3 12B FULL V4

set "RUNNER_COMMIT=928312ada7da652377a641ce4fbb31464789d76e"
set "RUNNER_URL=https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/%RUNNER_COMMIT%/scripts/run-eventmind-v13-gemma3-12b-real120-full-direct.ps1"
set "RUNNER=%TEMP%\buyflow-eventmind-gemma3-12b-real120-full-%RANDOM%%RANDOM%.ps1"

echo.
echo ==============================================================
echo BUYFLOW EVENTMIND - REAL120 GEMMA 3 12B FULL EMAIL / V4
echo NO CHUNKS / NO FINAL JUDGE / JSON OUTPUT
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
  echo GEMMA FULL REAL120 RUN COMPLETE.
  echo Report: Desktop\BuyFlow-EVENTMIND-REAL120-GEMMA3-12B-FULL-V4-*.json
) else (
  echo GEMMA FULL REAL120 RUN FAILED/BLOCKED. Exit code: %RC%
)
echo.
pause
exit /b %RC%
