@echo off
setlocal EnableExtensions
title BuyFlow Local AI - Proba

echo BuyFlow AI Decision proba...
echo.

set "PAYLOAD=%TEMP%\buyflow-n8n-test.json"
set "RESPONSE=%TEMP%\buyflow-n8n-test-response.json"
>"%PAYLOAD%" echo {"request_id":"local-smoke-001","email":{"from":"shipping@example.hu","subject":"Csomagod feladva - #12345","body":"A #12345 rendelest ma fizikailag atadtuk a GLS futaranak. Nyomkovetes: GLS998877."},"candidates":[{"purchase_id":"purchase-12345","merchant":"Example Shop","order_ids":["12345"],"tracking_ids":[]}]}

curl.exe -sS -X POST "http://127.0.0.1:5678/webhook/buyflow-ai-decision" -H "Content-Type: application/json" --data-binary "@%PAYLOAD%" > "%RESPONSE%"
if errorlevel 1 goto :fail

type "%RESPONSE%"
echo.
echo.

powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; try { $j = Get-Content -Raw '%RESPONSE%' | ConvertFrom-Json; if ($j.ok -eq $true -and $j.ruleset -eq 'agent-critic-v1' -and $j.decision.event_type -eq 'SHIPPED' -and $j.decision.action -eq 'LINK_EXISTING' -and $j.decision.selected_purchase_id -eq 'purchase-12345') { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 goto :semanticfail

echo ========================================
echo PASS - BUYFLOW AI DONTES HELYES
echo ========================================
echo ruleset: agent-critic-v1
echo event_type: SHIPPED
echo action: LINK_EXISTING
echo purchase: purchase-12345
goto :end

:semanticfail
echo ========================================
echo FAIL - AI DONTES VAGY RULESET NEM HELYES
echo ========================================
echo Elvart: ruleset=agent-critic-v1, SHIPPED, LINK_EXISTING, purchase-12345.
goto :end

:fail
echo ========================================
echo HIBA - A WEBHOOK HIVAS SIKERTELEN
echo ========================================

:end
del "%PAYLOAD%" >nul 2>&1
del "%RESPONSE%" >nul 2>&1
echo.
echo Az utolso AI hivas keep_alive=0 miatt kiuriti a modellt a memoriabol.
pause
