@echo off
setlocal EnableExtensions EnableDelayedExpansion
title BuyFlow Local AI - n8n + Ollama

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "STACK=%ROOT%\infra\n8n-local"
set "ENVFILE=%STACK%\.env"
set "COMPOSE=%STACK%\docker-compose.yml"
set "MODEL=qwen3:8b"

echo.
echo ========================================
echo BUYFLOW LOCAL AI
echo n8n + PostgreSQL + Windows Ollama
echo ========================================
echo.

if not exist "%COMPOSE%" goto :missing_stack

where docker.exe >nul 2>&1
if errorlevel 1 goto :docker_missing

docker info >nul 2>&1
if errorlevel 1 (
  echo Docker Desktop inditasa...
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  set /a WAIT=0
  :wait_docker
  timeout /t 3 /nobreak >nul
  docker info >nul 2>&1
  if not errorlevel 1 goto :docker_ready
  set /a WAIT+=3
  if !WAIT! LSS 120 goto :wait_docker
  goto :docker_not_ready
)
:docker_ready
echo Docker: OK

where ollama.exe >nul 2>&1
if errorlevel 1 goto :ollama_missing

curl.exe -fsS http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
  echo Ollama inditasa...
  start "BuyFlow Ollama" /min cmd /c "ollama serve"
  set /a OWAIT=0
  :wait_ollama
  timeout /t 2 /nobreak >nul
  curl.exe -fsS http://127.0.0.1:11434/api/tags >nul 2>&1
  if not errorlevel 1 goto :ollama_ready
  set /a OWAIT+=2
  if !OWAIT! LSS 60 goto :wait_ollama
  goto :ollama_not_ready
)
:ollama_ready
echo Ollama: OK

ollama list 2>nul | findstr /I /C:"%MODEL%" >nul
if errorlevel 1 (
  echo A %MODEL% modell nincs helyben. Letoltes indul...
  ollama pull %MODEL%
  if errorlevel 1 goto :model_pull_failed
)
echo Modell: %MODEL% OK

if not exist "%ENVFILE%" (
  echo Elso inditas: helyi titkos kulcsok generalasa...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$rng=[Security.Cryptography.RandomNumberGenerator]::Create(); function S { $b=New-Object byte[] 32; $rng.GetBytes($b); ([BitConverter]::ToString($b)-replace '-','').ToLower() }; $p=S; $e=S; $j=S; @('POSTGRES_USER=buyflow',('POSTGRES_PASSWORD='+$p),'POSTGRES_DB=buyflow_n8n',('N8N_ENCRYPTION_KEY='+$e),('N8N_USER_MANAGEMENT_JWT_SECRET='+$j),'BUYFLOW_OLLAMA_URL=http://host.docker.internal:11434/api/chat','BUYFLOW_OLLAMA_MODEL=qwen3:8b','BUYFLOW_AI_EXECUTE=false') | Set-Content -Encoding ASCII '%ENVFILE%'"
  if errorlevel 1 goto :env_failed
)

echo.
echo n8n + PostgreSQL inditasa...
pushd "%STACK%"
docker compose --env-file .env -f docker-compose.yml up -d
if errorlevel 1 (
  popd
  goto :compose_failed
)

echo n8n varakozas...
set /a NWAIT=0
:wait_n8n
timeout /t 3 /nobreak >nul
curl.exe -fsS http://127.0.0.1:5678/healthz >nul 2>&1
if not errorlevel 1 goto :n8n_ready
set /a NWAIT+=3
if !NWAIT! LSS 120 goto :wait_n8n
popd
goto :n8n_not_ready

:n8n_ready
echo n8n: OK

echo Docker -^> Windows Ollama kapcsolat ellenorzese...
docker compose --env-file .env -f docker-compose.yml exec -T n8n node -e "fetch('http://host.docker.internal:11434/api/tags').then(r=>{if(!r.ok)process.exit(2);return r.json()}).then(()=>console.log('Ollama bridge: OK')).catch(e=>{console.error(e);process.exit(3)})"
if errorlevel 1 (
  popd
  goto :bridge_failed
)
popd

echo.
echo ========================================
echo BUYFLOW LOCAL AI KESZ
echo ========================================
echo n8n: http://127.0.0.1:5678
echo Ollama: %MODEL%
echo Mod: SHADOW - adatbazis iras kikapcsolva
echo A modell minden AI valasz utan unloadolodik.
echo.
start "" http://127.0.0.1:5678
exit /b 0

:missing_stack
echo HIBA: n8n stack nem talalhato: %COMPOSE%
goto :fail
:docker_missing
echo HIBA: Docker nincs telepitve. A helyi n8n Docker Desktopot igenyel.
goto :fail
:docker_not_ready
echo HIBA: Docker Desktop 2 percen belul nem indult el.
goto :fail
:ollama_missing
echo HIBA: ollama.exe nem talalhato a PATH-ban.
goto :fail
:ollama_not_ready
echo HIBA: Ollama API nem indult el a 127.0.0.1:11434 cimen.
goto :fail
:model_pull_failed
echo HIBA: %MODEL% letoltese sikertelen.
goto :fail
:env_failed
echo HIBA: .env kulcsok generalasa sikertelen.
goto :fail
:compose_failed
echo HIBA: docker compose inditas sikertelen.
goto :fail
:n8n_not_ready
echo HIBA: n8n 2 percen belul nem lett elerheto.
goto :fail
:bridge_failed
echo HIBA: az n8n kontener nem eri el a Windows Ollamat.
echo Docker Desktop alatt a host.docker.internal kapcsolatot ellenorizni kell.
goto :fail

:fail
echo.
echo Ne talalgass. Kuldd el nekem ennek az ablaknak az utolso 20 sorat.
pause
exit /b 1
