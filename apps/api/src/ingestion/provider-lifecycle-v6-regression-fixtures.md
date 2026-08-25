# v6 regression fixture families

Positive lifecycle families from the frozen v4 audit:
- FOXPOST: `Csomagod megérkezett`, `Csomagod már a raktárunkban van`, `Át nem vett csomagodat visszaszállítottuk`
- MPL/Posta: `Csomagod a postán átvehető`, `Csomagod a kézbesítőnél van`, `Csomagot adtak fel neked`
- Packeta: `A szállítmányt elfogadták a szállításra`
- Gate: `Megrendelésének elküldése`, `Köszönjük, hogy a Gate-nél vásárolt.`
- Payment semantic correction: `tranzakció sikertelen volt` -> `order_updated` + `payment_status=failed`

Negative safety fixtures:
- Packeta ÁSZF/newsletter content
- generic free-shipping marketing
- support `Re:` threads without explicit lifecycle evidence
- same carrier-like subjects from unrelated sender domains
