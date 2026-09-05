# MailGate real Gmail historyId/history.list smoke — 2026-09-02

## Verdict

**PASS — read-only real Gmail history gate completed.**

This smoke used the already-authorized local n8n Gmail OAuth credential and the verified BuyFlow n8n data profile. It exercised Gmail read-only API paths only and did not enable Direct Gmail production runtime.

## Environment

- n8n version: `2.37.3`
- n8n data profile: `C:\Users\kozma\Desktop\buyflow\.n8n-local-ai-data`
- n8n workflow DB: `C:\Users\kozma\Desktop\buyflow\.n8n-local-ai-data\.n8n\database.sqlite`
- targeted Gmail workflow: FOUND
- Gmail credential: existing local n8n OAuth credential
- mode: read-only / no checkpoint commit / no BuyFlow persistence

## Result

- RAW MIME: **6/6**
- Gmail `historyId` capture: **PASS**
- Gmail `users.history.list` call: **PASS**
- observed history records: **0**
- mailbox writes: **0**
- BuyFlow DB writes: **0**
- AI calls: **0**
- overall gate: **PASS**

Zero history records are valid for this smoke: the gate proves a successful authenticated `history.list` replay from a real Gmail `historyId`; it does not require a mailbox mutation to manufacture a history event.

## Safety notes

- Only Gmail GET/read operations were used for the smoke.
- No Gmail message was archived, labeled, marked read, deleted, sent or otherwise mutated by the runner.
- No durable Gmail cursor/checkpoint was committed.
- No `source_emails`, source archive, Purchase, Shipment, Document or Identity writes were performed by the smoke.
- No AI call was made.
- The decrypted credential export existed only in a random temporary folder and was removed by the runner cleanup path.
- Direct Gmail production runtime remains OFF.

## Conclusion

The previously blocked environment-dependent MailGate cursor/history gate is now closed. MailGate can be treated as **PASS** for pre-production readiness. This does **not** authorize a production provider cutover or production writes; those remain subject to the final cutover review.
