@echo off
setlocal EnableExtensions
title BuyFlow Local AI - Leallitas
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PS1=%ROOT%\scripts\stop-buyflow-n8n-local.ps1"

if not exist "%PS1%" (
  echo HIBA: Nem talalom: %PS1%
  timeout /t 3 /nobreak >nul
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
exit /b %ERRORLEVEL%
