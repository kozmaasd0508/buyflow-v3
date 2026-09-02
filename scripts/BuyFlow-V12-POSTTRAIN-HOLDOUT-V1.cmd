@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v12-posttrain-holdout-v1.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" echo V12 POSTTRAIN HOLDOUT V1 FAILED: %EXITCODE%
pause
exit /b %EXITCODE%
