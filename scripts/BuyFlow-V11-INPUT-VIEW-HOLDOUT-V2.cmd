@echo off
setlocal
set HERE=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HERE%run-v11-input-view-holdout-v2.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" echo HIBA: %EXITCODE%
pause
exit /b %EXITCODE%
