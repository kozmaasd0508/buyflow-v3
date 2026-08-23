# Real Gmail Ground Truth v1

## Cél

Valódi Gmail vásárlási leveleken mérni az Extraction Engine v2 pontosságát úgy, hogy a motor saját kimenete soha ne váljon ground truth-á, és nyers privát e-mail tartalom ne kerüljön a repositoryba.

## Adatvédelmi szabályok

- A repository publikus, ezért nyers Gmail subject/body/header/MIME/attachment tartalom TILOS.
- Valódi Gmail message ID, order ID, tracking ID, invoice ID, payment reference és személyes cím/adat TILOS a repositoryban.
- Privát fixture csak `private-ground-truth/` alatt vagy `*.real-gmail-private.*` formában létezhet helyi, nem követett környezetben.
- Repo-safe case ID kizárólag SHA-256 alapú opaque azonosító.
- A riport csak opaque case ID-t, státuszokat és metrikákat tartalmazhat.

## Ground truth szabály

A helyes választ ember állapítja meg a valódi levélből, MIELŐTT az adott eset engine outputját megnézzük.

Állapotok mezőnként:

- `known(value)` – a levélből egyértelműen megállapítható.
- `not_applicable` – a mező ehhez az e-mail eseményhez nem tartozik.
- `unknown` – az e-mailből nem állapítható meg biztonságosan.

`engine output != ground truth`.

## Dataset besorolás

Az a Gmail-levél, amelyet a fejlesztő/annotátor már megvizsgált, `development_ground_truth` vagy később `regression_only`.

Ilyen levél NEM használható későbbi fresh blind accuracy claimhez.

Fresh blind holdouthoz új, addig nem megvizsgált Gmail-levelek kellenek, és a ground truth-ot az engine eredmény megtekintése előtt kell lefagyasztani.

## Első fejlesztési életutak

V1-ben két valódi, több e-mailes vásárlási életút szolgál fejlesztési GT-ként:

1. webshop rendelés -> webshop státusz -> külső futár értesítés;
2. webshop rendelés -> webshop shipped -> külső futár feldolgozás -> kézbesítés -> számla.

A konkrét message/order/tracking/invoice azonosítók csak privát fixture-ben létezhetnek.

## Fontos correlation-szabály

A `real-world same purchase` és az `allowed automatic LINK` nem ugyanaz.

Ha emberileg tudjuk, hogy két levél ugyanahhoz a vásárláshoz tartozik, de a motor számára csak soft evidence áll rendelkezésre, a helyes biztonságos döntés lehet `REVIEW` vagy `PENDING`.

TILOS false merge-et elfogadni csak azért, hogy a motor minden valódi életutat automatikusan összekössön.

Különösen:

- amount/currency/time/sender similarity önmagában nem hard link;
- kis COD/order-total eltérés nem konfliktus, de nem is hard identity;
- carrier lifecycle-only levél nem hozhat létre új Purchase-t;
- hard conflict esetén nincs auto-link.

## V1 mérés

Az Extraction Engine v2 esetén mérjük:

- commerce detection precision/recall;
- field exact match;
- field precision/recall;
- conflicts;
- critical mismatches;
- REVIEW arány.

A következő correlation GT rétegben külön mérjük majd:

- false merge;
- false split;
- correct LINK;
- correct REVIEW/PENDING;
- premature NEW_PURCHASE;
- lifecycle-only NEW_PURCHASE mint critical failure.

## Safety invariants

- `0 AI calls`
- `0 production writes`
- `0 Purchase writes`
- `0 Shipment writes`
- `0 Document writes`
- raw Gmail content never committed
- current Extraction Engine v2 remains regression baseline
- no tuning against a fresh blind holdout after result reveal
