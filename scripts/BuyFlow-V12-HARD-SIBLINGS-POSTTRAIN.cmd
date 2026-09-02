@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v12-hard-siblings-posttrain-v1.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" echo V12 HARD SIBLINGS POSTTRAIN FAILED: %EXITCODE%
pause
exit /b %EXITCODE%
