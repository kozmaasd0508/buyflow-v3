# BuyFlow Local AI v1

Local orchestration layer for BuyFlow using self-hosted n8n + PostgreSQL and the existing Windows Ollama runtime.

## Architecture

```text
email / test payload
        |
        v
      n8n
        |
        +--> BuyFlow Local AI Decision
        |      |
        |      +--> Windows Ollama (Qwen)
        |      +--> validate JSON / purchase id
        |      +--> SHADOW decision response
        |
        +--> BuyFlow Teacher Chat
               |
               +--> Windows Ollama (Qwen)
```

n8n and PostgreSQL run in Docker. Ollama is deliberately **not** duplicated in Docker. The n8n container reaches the existing Windows Ollama service through `host.docker.internal:11434`, which is the supported Docker-host pattern documented by Ollama/n8n.

## Current safety state

`BUYFLOW_AI_EXECUTE=false` is the default. The AI is allowed to make the full semantic decision (`CREATE_PURCHASE`, `LINK_EXISTING`, `REVIEW`, `IGNORE`), but this v1 workflow does not mutate BuyFlow or Supabase. It is a shadow decision layer so accuracy can be measured first.

For `LINK_EXISTING`, the workflow validates that `selected_purchase_id` exactly matches one of the candidate purchase IDs provided in the request. Invented IDs fail the execution.

Both Ollama calls use `keep_alive: 0`, so the Qwen model is unloaded from RAM/VRAM immediately after each response instead of remaining resident in the background.

## Services

- n8n: `http://127.0.0.1:5678`
- PostgreSQL: internal Docker network only
- Ollama: existing Windows service at `http://127.0.0.1:11434`
- n8n -> Ollama: `http://host.docker.internal:11434/api/chat`

## Imported workflows

### BuyFlow Local AI Decision

Webhook path:

`POST /webhook/buyflow-ai-decision`

Example request:

```json
{
  "request_id": "demo-1",
  "email": {
    "from": "shipping@example.hu",
    "subject": "Csomagod feladva – #12345",
    "body": "A #12345 rendelést ma átadtuk a GLS futárának. Tracking: GLS998877."
  },
  "candidates": [
    {
      "purchase_id": "purchase-12345",
      "merchant": "Example Shop",
      "order_ids": ["12345"],
      "tracking_ids": []
    }
  ]
}
```

Expected response shape:

```json
{
  "ok": true,
  "mode": "SHADOW",
  "execution_allowed": false,
  "decision": {
    "is_commerce": true,
    "event_type": "SHIPPED",
    "action": "LINK_EXISTING",
    "selected_purchase_id": "purchase-12345",
    "confidence": 0.98,
    "evidence": ["..."],
    "reason": "..."
  }
}
```

### BuyFlow Teacher Chat

Webhook path:

`POST /webhook/buyflow-teacher-chat`

```json
{
  "prompt": "Mi a különbség a SHIPMENT_CREATED és a SHIPPED között?",
  "history": []
}
```

The teacher workflow does not write training examples and does not update model weights live.

## One-click start / stop

From the repository:

- `scripts/start-buyflow-n8n-local.cmd`
- `scripts/stop-buyflow-n8n-local.cmd`

The start command checks Docker, starts Docker Desktop if needed, checks Ollama, pulls `qwen3:8b` if missing, generates local secrets on first run, starts PostgreSQL+n8n, verifies n8n can reach Windows Ollama, then opens `http://127.0.0.1:5678`.

On the first n8n launch, create the local owner account in the browser. The two BuyFlow workflows are imported automatically by the compose initialization service.

## Next phase

After shadow accuracy is acceptable:

1. Connect Gmail inside n8n.
2. Pull candidate purchases from the BuyFlow API/Identity Graph.
3. Feed email + candidates to the Local AI Decision workflow.
4. Add a separate, auditable execution node for approved AI decisions.
5. Keep corrections as candidate training data for later V11+ corpus audit/training.

Production writes must remain a separate step from model inference so every decision has an n8n execution trace and can be rolled back/audited.
