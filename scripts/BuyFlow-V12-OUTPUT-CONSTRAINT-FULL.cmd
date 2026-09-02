@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v12-output-constraint-full-v1.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" echo V12 OUTPUT CONSTRAINT FULL FAILED: %EXITCODE%
pause
exit /b %EXITCODE%
