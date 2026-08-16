# Evidence notes

Observed mailbox evidence used for this shadow profile was sanitized before committing.

Key findings:
- two WebArena order confirmations shared the Shoprenter rendered order structure
- at least two WebArena orders later emitted merchant status `Elküldve`
- one observed order later emitted merchant status `Teljesítve`
- the inspected status-only emails contained no direct carrier tracking id and no explicit physical handoff/delivery wording
- the newer order confirmation used a different verified Shoprenter delivery route than the status emails

No private customer data or real order identifiers are stored here.
