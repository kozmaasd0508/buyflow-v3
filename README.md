# BuyFlow V3

Clean rebuild of BuyFlow.

## M1 goal

`Email -> AI extraction -> Purchase -> Product -> Shipment -> Document -> UI`

## Architecture principles

- Fresh implementation: no old BuyFlow code or database migration.
- Email access is provider-agnostic through an `EmailProvider` adapter.
- Nylas is the temporary development provider; direct Gmail API can replace it later.
- Email is evidence/source data, not the primary product model.
- AI interprets email content into structured data; normal backend code performs safe create/update/link decisions.
- Shipment/document events never fabricate a Purchase when a safe match does not exist.
- Every processed provider message is idempotent by provider message ID.
- Store structured results and reuse them; do not repeatedly call AI for the same facts.

## Initial data model

The first migration contains only the M1 core:

- `users`
- `email_connections`
- `source_emails`
- `purchases`
- `products`
- `shipments`
- `documents`
- `purchase_sources`
- `ai_processing_runs`

Later phases can add returns, refunds, warranties, family sharing, discovery and other features without changing the M1 ingestion contract.

## Supabase

Database changes live in `supabase/migrations/`.
