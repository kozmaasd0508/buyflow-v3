@echo off
setlocal
title BuyFlow EventMind REAL120 - Gemma V16 Hierarchical

set "RUNNER_COMMIT=bbd832941f9a317dc2ddd61ff6af0b1ca3f59c70"
set "RUNNER_URL=https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/%RUNNER_COMMIT%/scripts/run-eventmind-v16-gemma-hierarchical-real120-bootstrap.ps1"
set "RUNNER=%TEMP%\buyflow-eventmind-v16-hierarchical-%RANDOM%%RANDOM%.ps1"

echo.
echo ==============================================================
echo BUYFLOW EVENTMIND V16 - HIERARCHICAL GENERALIZATION
echo BUYER GATE ^> FAMILY GATE ^> FAMILY-RESTRICTED EVENT
echo REAL120 DEVELOPMENT ONLY / BLIND40 V1 SEALED
echo Gmail GET-only / BuyFlow production OFF
echo Baseline REAL120: V15 = 92/120
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
  echo GEMMA V16 HIERARCHICAL REAL120 COMPLETE.
  echo A report a Desktopon van: BuyFlow-EVENTMIND-REAL120-GEMMA3-V16-HIERARCHICAL-*.json
) else (
  echo GEMMA V16 HIERARCHICAL REAL120 FAILED/BLOCKED. Exit code: %RC%
)
echo.
pause
exit /b %RC%
