@echo off
setlocal
chcp 65001 >nul
set "BF_PS1=%TEMP%\BuyFlow-MAILGATE-HISTORY-SMOKE-V4-%RANDOM%-%RANDOM%.ps1"
set "BF_URL=https://raw.githubusercontent.com/kozmaasd0508/buyflow-v3/ca4023f42da5dd77f977720fbb9a307084a53195/scripts/run-mailgate-n8n-gmail-history-smoke-v4.ps1"

echo.
echo ============================================================
echo BUYFLOW MAILGATE - GMAIL historyId/history.list SMOKE V4
echo Egy lepes - n8n database automatikus kereses - csak olvasas
echo ============================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%BF_URL%' -OutFile '%BF_PS1%' -TimeoutSec 30 } catch { Write-Host ('HIBA LETOLTES: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 goto :failed

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BF_PS1%"
set "BF_EXIT=%ERRORLEVEL%"
del /f /q "%BF_PS1%" >nul 2>&1
if not "%BF_EXIT%"=="0" goto :failed

echo.
echo KESZ. Masold be ide a SUMMARY reszt, vagy huzd be a Desktopra mentett
echo BuyFlow-MAILGATE-HISTORY-SMOKE-*.json fajlt.
echo.
pause
exit /b 0

:failed
del /f /q "%BF_PS1%" >nul 2>&1
echo.
echo A teszt nem futott vegig. Semmi nincs elesitve.
echo Masold be ide a piros hibat, es innen folytatom.
echo.
pause
exit /b 1
