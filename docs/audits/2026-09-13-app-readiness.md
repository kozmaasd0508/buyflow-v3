# BuyFlow alkalmazáspróba — 2026-09-13

Vizsgált verzió: bc52a72cef4d6b972d8c40c3b124c0ca6ce89f65.

## Mit futtattunk?

155 meglévő levélmintát három tesztkészletből, a tényleges szabályalapú felismerőkkel. A demópróba rendelés- és csomagkapcsolási döntéseket, valamint sikertelen fizetés → törlés állapotváltozást is futtat. Külön lefutottak a közös feldolgozási sorrend, az automatikus írási korlátozás és a MailLens/AI válaszszerződés tesztjei; az AI-válaszok ezekben szimuláltak.

Hét vásárlási állapottal meghívtuk a felület tényleges currentMessage/humanState függvényeit. A teszt a TypeScript forrásból fordítja őket, nem másolja át a logikájukat. Ez üzenetképzési próba, nem böngészős megjelenítési vizsgálat.

## Eredmények

| Próba | Eredmény | Mit jelent? |
|---|---|---|
| Ismert demóminták | 20/20 elvárt pozitív felismerve; 8 negatívból 0 téves pozitív | A lefedett minták működnek. |
| Demó rendelés–Express One életút | 3 bizonyítékból összekapcsolható, kézbesített jelölt | A kapcsolási döntés ebben az esetben megfelelő. Adatbázisírás nem történt. |
| Sikertelen fizetés → törlés | cancelled / failed | A vizsgált állapotváltás megfelelő. |
| Változatos 100 levél | 70 vásárlási levélből 9 felismerve a vizsgált felismerőkkel | Jelentős lefedettségi hiány ezen a komponensútvonalon. |
| Webes mintákból készített 24 levél | 3 felismerve | A többi esetet a vizsgált felismerők nem fedik le. |
| Felületi üzenetek | 4 megfelelő, 3 hibás | A fő üzenet ellentmondhat az aktuális állapotnak. |

## Reprodukált hibák

- Visszatérített, korábban kézbesített vásárlás: a cím „A rendelés megérkezett”, miközben az állapotcímke „Visszatérítve”.
- Átvehető csomag: a cím „A csomag úton van”, miközben az állapotcímke „Átvehető”.
- Címke/szállítási adatok létrehozása: a cím már „A csomag úton van”; az állapotcímke lefordítatlan „shipment created”.

## Korlátok

Ez komponensszintű offline alkalmazáspróba, nem teljes, bejelentkezett felhasználói E2E. A régi levélbenchmarkok két felismerőt közvetlenül hívnak, nem a teljes aktuális preprocesszor-láncot. A demó vásárlási jelöltjei nem bizonyítják a mai írási kapukon át létrejövő rekordokat. A 9/70 és 3/24 ezért sem Luna-, sem teljesapp-pontosságként nem közölhető.

Nem történt valódi Luna-hívás, élő postafiók- vagy adatbázisírás, számlaletöltés, garancia/visszaküldés végrehajtás vagy böngészős vizsgálat. A teljes teszthez ezek ellenőrzése még szükséges. A sikeres régi tesztek biztonsági feltételeket is vizsgálnak; a sikerük nem jelenti a lefedettségi hiányok megszűnését.

## Újrafuttatás

```sh
node scripts/testlab/app-readiness-simulation.mjs
node scripts/testlab/app-readiness-simulation.mjs --strict
```

A normál futás diagnosztikai JSON-t készít, benne KNOWN_GAPS eredménnyel. A --strict mód a reprodukált felületi hibák miatt 2-es kilépési kóddal zár. A működési kódot ez a változtatás nem javítja vagy módosítja.
