@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-eventmind-v11-gate.ps1"
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" echo A teszt hibaval allt le. Hibakod: %ERR%
pause
exit /b %ERR%
