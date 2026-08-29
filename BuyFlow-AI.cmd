@echo off
setlocal
cd /d "%~dp0"
start "BuyFlow AI" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\start-v9-teacher-chat.ps1"
exit /b 0
