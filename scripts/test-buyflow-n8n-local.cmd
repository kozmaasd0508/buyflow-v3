@echo off
setlocal EnableExtensions
title BuyFlow Local AI - Proba

echo BuyFlow AI Decision proba...
echo.

set "PAYLOAD=%TEMP%\buyflow-n8n-test.json"
>"%PAYLOAD%" echo {"request_id":"local-smoke-001","email":{"from":"shipping@example.hu","subject":"Csomagod feladva - #12345","body":"A #12345 rendelest ma fizikailag atadtuk a GLS futaranak. Nyomkovetes: GLS998877."},"candidates":[{"purchase_id":"purchase-12345","merchant":"Example Shop","order_ids":["12345"],"tracking_ids":[]}]}

curl.exe -sS -X POST "http://127.0.0.1:5678/webhook/buyflow-ai-decision" -H "Content-Type: application/json" --data-binary "@%PAYLOAD%"
echo.
echo.
echo Elvart lenyeg: event_type SHIPPED, action LINK_EXISTING, purchase-12345.
echo A valasz utan az Ollama modell keep_alive=0 miatt kiurul a memoriabol.
del "%PAYLOAD%" >nul 2>&1
pause
