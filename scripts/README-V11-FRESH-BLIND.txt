BUYFLOW V11 - FRESH BLIND TEST V1
==================================

Mit csinal?
- 180 teljesen uj, szintetikus vak esetet epit fel.
- Mind a 18 event tipusbol 10 esetet mer.
- 6 nyelvet hasznal: hu, en, de, pl, fr, es.
- A jelenlegi production NormalizedEmailDocumentV1 mezoket hasznalja.
- Kulon nehez hatarokat mer: packing/shipment, shipment-created/shipped, transit/last-mile, pickup/delivered, delay/failure, return/refund, payment/invoice, OTHER csapdak.
- A vak fixture-t SHA-256-tal lezarja a modell betoltese elott.

Biztonsag:
- NEM tanit.
- NEM modositja a V11 adaptert.
- NEM olvassa a frozen108, BLIND50 vagy valodi Gmail holdoutot.
- Nincs nyers ugyfeladat.
- Az eredmeny a local-data/lora-v11/fresh-blind-v1 alatt marad.

Futtatas:
1. Tedd a script fajlokat a repository scripts mappajaba, vagy hasznald a kulon ZIP csomagot.
2. Dupla kattintas: BuyFlow-V11-FRESH-BLIND.cmd
3. Hagyd lefutni.
4. A vegen kuldd el a konzol RESULT reszet vagy a metrics.json fajlt.

PASS gate:
- invalid output = 0
- incoherent output = 0
- unsafe lifecycle promotion = 0
- OTHER -> commerce false positive = 0
- exact >= 90%
- macro event accuracy >= 85%

A tesztet eredmeny utan NEM foltozzuk. Ha hibazik, a hibacsaladokat dokumentaljuk es csak kesobbi treninghez hasznaljuk.
