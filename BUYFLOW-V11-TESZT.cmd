@echo off
setlocal
cd /d "%~dp0"
call "%~dp0scripts\BuyFlow-EVENTMIND-V11-GATE.cmd"
exit /b %ERRORLEVEL%
