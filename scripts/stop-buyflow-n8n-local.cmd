@echo off
setlocal EnableExtensions
title BuyFlow Local AI - Leallitas
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "STACK=%ROOT%\infra\n8n-local"

echo BuyFlow n8n leallitasa...
if exist "%STACK%\docker-compose.yml" (
  pushd "%STACK%"
  docker compose --env-file .env -f docker-compose.yml down
  popd
)

where ollama.exe >nul 2>&1
if not errorlevel 1 ollama stop qwen3:8b >nul 2>&1

echo KESZ. A PostgreSQL/n8n adatok megmaradtak, a model memoriabol ki lett rakva.
timeout /t 3 /nobreak >nul
exit /b 0
