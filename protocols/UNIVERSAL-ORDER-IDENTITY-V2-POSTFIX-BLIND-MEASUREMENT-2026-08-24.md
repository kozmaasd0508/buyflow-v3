# Universal Order Identity v2 — post-fix blind measurement — 2026-08-24

## Frozen gate

- Implementation SHA before this holdout was opened: `4a9315907acd50d11acdb946045e1f879a1ffbf3`
- CI #988: GREEN
- Holdout hashes were committed before message content was opened in `UNIVERSAL-ORDER-IDENTITY-V2-POSTFIX-BLIND-FREEZE-2026-08-24.md`.
- No rule/code changes were made between freeze and first score.

## Ground truth

30 messages total:

- 21 retail purchase-related messages/documents/support lifecycle messages
- 9 service, legal/document, sent or other non-Purchase controls

Among the 21 retail-related messages:

- 16 contained an explicit hard order identifier in visible text
- 5 contained no explicit hard order identifier and should remain without a hard order anchor

The 16 identity-bearing messages represented 6 merchant/template families. The sample is not family-balanced: one SportVision lifecycle template appears repeatedly, so message-level accuracy must not be confused with broad global coverage.

## Post-fix blind result

### Hard order identity extraction

- Identity-bearing retail messages: **16**
- Correctly recognized: **16**
- Missed: **0**
- Message-level hard-identity recall on this frozen holdout: **100% (16/16)**
- Merchant/template-family coverage for the identity-bearing subset: **6/6 families recognized**

### Independent validation of the blind-gap fix

The previous blind holdout exposed one unseen Hungarian abbreviation form conceptually equivalent to:

`<id> sz. rendelés ...`

After adding that generic form, this new holdout independently contained a different unseen retail invoice whose subject used:

`... <id> sz. rendeléshez`

Universal Order Identity v2 recognized it. This is a real cross-merchant validation of the generic fix, not a replay of the original failure email.

### Fail-closed retail cases

- Retail-related messages with no explicit hard order ID: **5**
- Correctly left without a hard order anchor: **5/5**

Examples included real e-invoices and a warranty/support exchange. Invoice numbers, customer identifiers or document context were not promoted to order IDs.

### Non-Purchase safety controls

- Non-Purchase/service/legal/sent controls: **9**
- Unsafe automatic Purchase create/attach decisions attributable to Order Identity v2: **0/9**

Controls included utility/service billing, telecom invoices, a legal accounting document, document-update notice and a sent financial-document message.

## Important limitation

The 16/16 score is encouraging but is not global accuracy. Half of the identity-bearing messages came from repeated instances of one lifecycle template family. The family-level view (6/6) is therefore the more honest diversity signal, but it is still a small sample.

## Conclusion

The post-fix blind test supports the current Universal Order Identity v2 direction:

1. the generic `sz.` fix generalized to a different unseen merchant;
2. all explicit order identities in this new frozen set were recovered;
3. messages with no hard order identity remained fail-closed;
4. no non-Purchase control gained unsafe Purchase authority;
5. EmailDocument, Extraction v2 and Ownership now share the same order-identity source.

Next safe step: feed the shared hard identities into Purchase Identity Graph v2 and measure end-to-end correlation (correct Purchase link vs REVIEW vs wrong link), not just identity extraction.