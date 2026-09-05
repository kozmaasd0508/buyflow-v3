@echo off
setlocal
title BuyFlow - Lemonade AMD Local AI Setup

set "RUNNER_COMMIT=a236de1c1a969b4a2457726a6b8b772c87e47ba3"
set "RUNNER_URL=https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/%RUNNER_COMMIT%/scripts/setup-buyflow-lemonade-amd-windows.ps1"
set "RUNNER=%TEMP%\buyflow-lemonade-setup-%RANDOM%%RANDOM%.ps1"

echo.
echo ==============================================================
echo BUYFLOW - LEMONADE LOCAL AI SETUP
echo Windows / AMD GPU
echo Ollama es n8n valtozatlan marad
echo ==============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%RUNNER_URL%' -OutFile '%RUNNER%' -TimeoutSec 60"
if errorlevel 1 (
  echo RUNNER_DOWNLOAD_FAILED
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RUNNER%"
set "RC=%ERRORLEVEL%"
del /q "%RUNNER%" >nul 2>&1

echo.
if "%RC%"=="0" (
  echo LEMONADE SETUP COMPLETE.
  echo Summary: %%USERPROFILE%%\Desktop\BuyFlow-LEMONADE-SETUP-SUMMARY.json
) else (
  echo LEMONADE SETUP FAILED/BLOCKED. Exit code: %RC%
)
echo.
pause
exit /b %RC%
