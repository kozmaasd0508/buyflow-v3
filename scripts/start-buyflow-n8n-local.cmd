@echo off
setlocal EnableExtensions
title BuyFlow Local AI - n8n + Ollama

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PS1=%ROOT%\scripts\start-buyflow-n8n-local.ps1"

if not exist "%PS1%" (
  echo HIBA: Nem talalom: %PS1%
  pause
  exit /b 1
)

if /I "%~1"=="/refresh" (
  echo BuyFlow workflow kenyszeritett frissitese...
  del "%USERPROFILE%\Desktop\buyflow\.n8n-local-ai-data\.buyflow-workflows-imported-v*" >nul 2>&1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
exit /b %ERRORLEVEL%
