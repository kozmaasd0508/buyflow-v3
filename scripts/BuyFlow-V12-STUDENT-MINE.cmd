@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v12-student-mine-v1.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" echo V12 STUDENT MINE FAILED: %EXITCODE%
pause
exit /b %EXITCODE%
