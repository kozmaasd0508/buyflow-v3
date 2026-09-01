@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v11-semantic-view-ab-v1.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo HIBA: SemanticEmailView A/B futas sikertelen. Exit code: %EXITCODE%
) else (
  echo Kesz. Kuldd el a # RESULT reszt vagy a PowerShell osszegzest.
)
echo.
pause
exit /b %EXITCODE%
