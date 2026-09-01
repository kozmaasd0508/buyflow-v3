@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-v11-input-view-addback-v1.ps1"
if errorlevel 1 (
  echo.
  echo HIBA tortent az add-back diagnosztika kozben.
  pause
  exit /b 1
)
echo.
pause
