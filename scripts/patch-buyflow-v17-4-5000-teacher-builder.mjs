import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) throw new Error(`Builder file missing: ${file}`);
let s = fs.readFileSync(file, 'utf8');

const trainCounts = `const TRAIN_COUNTS = {
  ORDER_CREATED: 250,
  ORDER_PROCESSING: 250,
  PAYMENT: 200,
  INVOICE: 200,
  SHIPMENT_CREATED: 650,
  SHIPPED: 650,
  IN_TRANSIT: 550,
  OUT_FOR_DELIVERY: 550,
  READY_FOR_PICKUP: 250,
  DELIVERED: 250,
  CANCELLED: 200,
  REFUNDED: 200,
  RETURN: 150,
  OTHER: 650,
};`;
const valCounts = `const VAL_COUNTS = {
  ORDER_CREATED: 30,
  ORDER_PROCESSING: 30,
  PAYMENT: 25,
  INVOICE: 25,
  SHIPMENT_CREATED: 80,
  SHIPPED: 80,
  IN_TRANSIT: 70,
  OUT_FOR_DELIVERY: 70,
  READY_FOR_PICKUP: 30,
  DELIVERED: 30,
  CANCELLED: 25,
  REFUNDED: 25,
  RETURN: 20,
  OTHER: 60,
};`;

if (!/const TRAIN_COUNTS = \{[\s\S]*?\n\};/.test(s)) throw new Error('TRAIN_COUNTS block not found');
s = s.replace(/const TRAIN_COUNTS = \{[\s\S]*?\n\};/, trainCounts);
if (!/const VAL_COUNTS = \{[\s\S]*?\n\};/.test(s)) throw new Error('VAL_COUNTS block not found');
s = s.replace(/const VAL_COUNTS = \{[\s\S]*?\n\};/, valCounts);

s = s.replace("'training', 'v17-3-large'", "'training', 'v17-4-5000'");
s = s.replace('const SEED = 17032026;', 'const SEED = 17042026;');
s = s.replace("const base = split === 'train' ? 730000 : 930000;", "const base = split === 'train' ? 1730000 : 1930000;");
s = s.replace("880000000 + (split === 'train' ? i : 50000 + i)", "1880000000 + (split === 'train' ? i : 70000 + i)");

const oldPickup = `    return row('', email('pickup@carrier.example', 'Partner csomagfelvétel', text), target('OTHER', 'merchant_outbound', null, null, 'not_applicable', text), ['v17.3', split, 'merchant_outbound']);`;
const newPickup = `    const day = String((i % 27) + 1).padStart(2, '0');
    const hour = 7 + (i % 10);
    const pickupRef = \`PU4-\${split === 'train' ? 'TR' : 'VA'}-\${1700000 + i}\`;
    const enriched = \`\${text}\\nBegyűjtési ablak: 2026-10-\${day}, \${hour}:00-\${hour + 1}:00\\nPickup reference: \${pickupRef}\\nRaklap/csomagcsoport: BG-\${300000 + i}\`;
    return row('', email('pickup@carrier.example', 'Partner csomagfelvétel', enriched), target('OTHER', 'merchant_outbound', null, null, 'not_applicable', text), ['v17.3', split, 'merchant_outbound']);`;
if (!s.includes(oldPickup)) throw new Error('merchant_outbound source pattern not found');
s = s.replace(oldPickup, newPickup);

const oldSecurity = `    return row('', email(\`security@\${x.domain}\`, 'Biztonsági értesítés', text), target('OTHER', 'non_purchase', null, null, 'not_applicable', text), ['v17.3', split, 'security']);`;
const newSecurity = `    const device = ['Windows PC', 'Android phone', 'iPhone', 'Chrome browser', 'Edge browser', 'Safari browser'][i % 6];
    const minute = String(i % 60).padStart(2, '0');
    const secRef = \`SEC4-\${split === 'train' ? 'TR' : 'VA'}-\${1600000 + i}\`;
    const enriched = \`\${text}\\nEszköz: \${device}\\nIdőpont: 2026-10-\${String((i % 27) + 1).padStart(2, '0')} 1\${i % 10}:\${minute}\\nSecurity reference: \${secRef}\`;
    return row('', email(\`security@\${x.domain}\`, 'Biztonsági értesítés', enriched), target('OTHER', 'non_purchase', null, null, 'not_applicable', text), ['v17.3', split, 'security']);`;
if (!s.includes(oldSecurity)) throw new Error('security source pattern not found');
s = s.replace(oldSecurity, newSecurity);

const linkRegex = /function linkVariant\(x, i\) \{[\s\S]*?\n\}\n\nfunction orderSender/;
if (!linkRegex.test(s)) throw new Error('linkVariant block not found');
const newLink = `function linkVariant(x, i) {
  const v = i % 8;
  if (v === 0) return { prefix: \`Rendelés: \${x.order}\\nCsomagszám: \${x.tracking}\\n\`, order: x.order, status: 'linked', tag: 'exact-order-tracking' };
  if (v === 1) return { prefix: \`Csomagszám: \${x.tracking}\\nA levél nem tartalmaz rendelési azonosítót.\\n\`, order: null, status: 'unresolved', tag: 'tracking-only-unresolved' };
  if (v === 2) return { prefix: \`Ismert BuyFlow kapcsolat: \${x.order} rendelés trackingje \${x.tracking}.\\n\\nCsomagszám: \${x.tracking}\\n\`, order: x.order, status: 'linked', tag: 'verified-context' };
  if (v === 3) { const alt = \`ALT4-\${1810000 + i}\`; return { prefix: \`Lehetséges rendelések: \${x.order} vagy \${alt}. Nincs igazolt hozzárendelés.\\nCsomagszám: \${x.tracking}\\n\`, order: null, status: 'unresolved', tag: 'ambiguous-order' }; }
  if (v === 4) return { prefix: \`Order reference: \${x.order}\\nCarrier tracking: \${x.tracking}\\n\`, order: x.order, status: 'linked', tag: 'english-exact-pair' };
  if (v === 5) return { prefix: \`Carrier tracking: \${x.tracking}\\nKereskedő: \${x.merchant}\\nPurchase/order reference is missing.\\n\`, order: null, status: 'unresolved', tag: 'merchant-plus-tracking-no-order' };
  if (v === 6) return { prefix: \`Marketplace platform order: \${x.order}\\nSeller reference: SELL-\${1910000 + i}\\nTracking: \${x.tracking}\\n\`, order: x.order, status: 'linked', tag: 'marketplace-platform-order' };
  return { prefix: \`Tracking: \${x.tracking}\\nCustomer reference: CUST-\${1950000 + i}\\nA customer reference nem igazolt rendelési azonosító.\\n\`, order: null, status: 'unresolved', tag: 'fake-customer-reference' };
}

function orderSender`;
s = s.replace(linkRegex, newLink);

s = s.replaceAll('v17.3', 'v17.4');
s = s.replaceAll('v17-3-tr', 'v17-4-tr');
s = s.replaceAll('v17-3-va', 'v17-4-va');
s = s.replace("validateRows(train, 3000, 'train')", "validateRows(train, 5000, 'train')");
s = s.replace("validateRows(validation, 400, 'validation')", "validateRows(validation, 600, 'validation')");
s = s.replace("dataset: 'buyflow-v17-3-large-teacher'", "dataset: 'buyflow-v17-4-5000-teacher'");
s = s.replace("purpose: 'large diverse QLoRA continuation corpus after V17 initial 240-row proof-of-learning run'", "purpose: '5000-row V17.4 continuation corpus focused on lifecycle boundaries and link-status hardening after the V17.3 3000-row run'");
s = s.replaceAll('External Blind V2', 'External Blind V3');
s = s.replaceAll('external_blind_v2_read', 'external_blind_v3_read');
s = s.replaceAll('external_blind_v2_modified', 'external_blind_v3_modified');
s = s.replace("console.log('BUYFLOW V17.4 LARGE TEACHER DATASET READY');", "console.log('BUYFLOW V17.4 5000 TEACHER DATASET READY');");

fs.writeFileSync(file, s, 'utf8');
console.log('V17.4 BUILDER PATCH: PASS');
console.log('Target: 5000 train + 600 validation');
console.log('Link-status hardening: ENABLED | 8 shipping link variants');
console.log('Duplicate-prone OTHER families: natural variable context ENABLED');
console.log('External Blind V3: NOT READ / NOT MODIFIED');
