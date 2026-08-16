# Billingo invoicing shadow profile — 1.0.0-test.1

Status: **test/shadow only**

Production registry impact: **none**

## Goal

Model direct Billingo recipient emails conservatively without allowing invoice-like wording to create purchases, mark payments, or turn a proforma into an invoice.

This V1 intentionally uses two separate protocol profiles:

- `invoicing.hu.billingo` — verified invoice notifications
- `invoicing.hu.billingo.proforma` — verified díjbekérő/proforma notifications

The split is required because an observed Billingo proforma email reuses invoice-like field names such as `A számla végösszege` and `Számla sorszáma` even though the document is explicitly a díjbekérő.

## Verified direct sender infrastructure

Observed recipient messages:

- From: `noreply@billingo.hu`
- DKIM: `billingo.hu` — pass
- SPF: pass
- DMARC: pass
- Return-Path: under `mail.billingo.hu`
- transport observed through Amazon SES

The transport provider is not used as the identity boundary.

Billingo's current support documentation also states that invoices sent through Billingo always go out from `noreply@billingo.hu`; a configured sender email changes the Reply-To address, not the actual From address.

## Invoice notification

Observed subject:

`Számlája érkezett`

Observed body structure includes:

- `Önnek számlája érkezett ...`
- or `Önnek elektronikus számlája érkezett ...`
- `A számla végösszege: ...`
- `Számla sorszáma: ...`
- `Fizetési mód: ...`
- Billingo-hosted document-access/download link

Examples of observed invoice-number shapes include:

- `2026-52`
- `BT / 2026-009222`

Safe mapping:

`INVOICE`

Extracted identifier:

- `invoice_id` only from the explicit `Számla sorszáma:` field

Safety prohibitions:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`

Why: Billingo invoices can represent webshop purchases, subscriptions, services, education, B2B expenses or other non-shopping contexts. The invoice is authoritative evidence that an invoice document exists, but not that a specific BuyFlow purchase identity has already been proven.

## Billingo document delivery is often link-based

The verified Gmail examples had no PDF attachment. Instead, the email contained a Billingo-hosted document-access link.

Therefore:

`no PDF attachment != not an invoice`

Attachment presence must not be required for Billingo invoice recognition.

## Díjbekérő / proforma

Observed subject:

`Díjbekérője érkezett`

Observed body includes:

- `Önnek díjbekérője érkezett ...`
- payment-request instructions
- `DÍJBEKÉRŐ LETÖLTÉSE`
- Billingo-hosted document-access link

Critically, the same observed proforma email also contains:

- `A számla végösszege: ...`
- `Számla sorszáma: ...`
- footer wording referring generically to `számla`

This makes a global keyword parser unsafe.

Safe mapping:

`OTHER`

The proforma profile intentionally has **no `invoice_id` extractor**, even though the email contains the misleading label `Számla sorszáma`.

Safety prohibitions:

- `DO_NOT_CREATE_PURCHASE`
- `DO_NOT_AUTO_LINK`
- `DO_NOT_MARK_REFUNDED`

Billingo's official documentation confirms that a díjbekérő/proforma may resemble a számla but is not itself an invoice, is not booked as an invoice and does not by itself create the same tax/NAV invoice obligations.

## Payment semantics

Neither an invoice nor a proforma email proves payment success.

Do not infer `PAYMENT_SUCCESS` from:

- `Fizetési mód: Bankkártya`
- `Fizetési mód: Átutalás`
- invoice total
- payment deadline
- invoice existence
- proforma existence

Payment authority remains with the authenticated payment provider or another direct settlement source.

## Account/subscription hard negative

Observed Billingo sender:

`noreply@billingo.hu`

Observed non-invoice subject:

`Előfizetés hosszabbítása 7 nap múlva lesz esedékes`

This proves that authenticated Billingo sender identity alone is insufficient. Document semantics are required in addition to sender + DKIM.

## Correction / cancellation documents

Billingo currently distinguishes document types including:

- Számla
- Díjbekérő
- Módosító számla
- Sztornó
- Nyugta
- Piszkozat

Official Billingo documentation also explains that a sztornószámla is a separate negative document used to invalidate an original invoice.

However, targeted mailbox research did not find a sufficiently strong direct recipient email example for:

- `Módosító számla`
- `Helyesbítő számla`
- `Sztornó számla`

Therefore V1 implements **no positive recipient-email parser** for those document types.

Do not invent their exact email template from product documentation alone.

## Hard negatives / rejection rules

The test suite protects against:

1. `Számlája érkezett` subject without required body structure
2. Billingo account/subscription notices
3. lookalike DKIM such as `billingo.hu.attacker.example`
4. merchant-origin emails merely mentioning Billingo
5. proforma emails containing invoice-like field names
6. invented sztornó/módosító recipient templates
7. treating invoice existence as payment success

## Authority and linking

Suggested authority order for invoice identity:

1. authenticated direct invoice provider email / invoice document
2. verified invoice PDF/document content
3. merchant email claiming an invoice exists

But invoice authority does not automatically equal purchase-link authority.

Auto-linking should require independent identity evidence such as a proven merchant order reference, explicit purchase relation, or another safe deterministic bridge.

## Source set

Official Billingo sources used for V1:

- Billingo support — bizonylattömb email sender settings
- Billingo support — invoice email sending
- Billingo support — document list/types
- Billingo — díjbekérő/proforma documentation
- Billingo — sztornószámla documentation

Observed sources used for V1:

- multiple real direct Billingo invoice notifications across different issuers
- one direct díjbekérő/proforma notification
- direct Billingo subscription-renewal notice as a hard negative
- raw MIME authentication from invoice and proforma examples

Only sanitized structural facts and synthetic identifiers are committed. No private recipient, issuer or invoice data is stored in test fixtures.

## Production promotion gate

Do not move this profile into the production registry until at minimum:

- live ingestion supplies trustworthy DKIM-domain evidence
- shadow evaluation shows acceptable precision on real incoming Billingo mail
- invoice/proforma hard-negative regressions remain green
- any future sztornó/módosító parser is backed by direct authenticated recipient examples
- purchase-link logic remains independently guarded
