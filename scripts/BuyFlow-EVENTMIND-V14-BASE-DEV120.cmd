@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"
set "REPORT_DIR=%REPO_ROOT%\local-data\testlab-reports\eventmind-v14-base-dev120"
if not exist "%REPORT_DIR%" mkdir "%REPORT_DIR%"

echo ==============================================================
echo BuyFlow EventMind V14 - BASE Qwen3-8B - REAL120 DEV
echo NO LORA - READ ONLY - PRODUCTION OFF
echo ==============================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%\scripts\testlab\run-eventmind-v14-base-dev120.ps1" -ReportDir "%REPORT_DIR%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo V14 DEV120 futas befejezve.
  echo Report: %REPORT_DIR%
) else (
  echo V14 DEV120 BLOCKED/FAIL. Exit code: %EXIT_CODE%
)
echo.
pause
exit /b %EXIT_CODE%
