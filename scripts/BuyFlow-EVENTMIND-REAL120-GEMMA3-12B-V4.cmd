@echo off
setlocal
title BuyFlow EventMind REAL120 - Gemma 3 12B V4

set "RUNNER_COMMIT=3bf4273609a634f926a1a90a11799a97a6c255e8"
set "RUNNER_URL=https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/%RUNNER_COMMIT%/scripts/run-eventmind-v13-gemma3-12b-real120-direct.ps1"
set "RUNNER=%TEMP%\buyflow-eventmind-gemma3-12b-real120-%RANDOM%%RANDOM%.ps1"

echo.
echo ==============================================================
echo BUYFLOW EVENTMIND - REAL120 GEMMA 3 12B / PROMPT V4
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
  echo GEMMA REAL120 RUN COMPLETE.
  echo A report a Desktopon van: BuyFlow-EVENTMIND-REAL120-GEMMA3-12B-V4-*.json
) else (
  echo GEMMA REAL120 RUN FAILED/BLOCKED. Exit code: %RC%
)
echo.
pause
exit /b %RC%
