@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v12-hard-siblings-baseline-v2.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" echo V12 HARD SIBLINGS BASELINE FAILED: %EXITCODE%
pause
exit /b %EXITCODE%
