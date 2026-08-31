@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title BuyFlow V11 Fresh Blind Test V1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-v11-fresh-blind-v1.ps1"
if errorlevel 1 (
  echo.
  echo HIBA tortent. Kuldd el nekem ezt az ablakot.
)
echo.
pause
