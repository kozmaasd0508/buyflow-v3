@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v12-teacher-review-openai-v1.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" echo V12 OPENAI TEACHER REVIEW FAILED: %EXITCODE%
pause
exit /b %EXITCODE%
