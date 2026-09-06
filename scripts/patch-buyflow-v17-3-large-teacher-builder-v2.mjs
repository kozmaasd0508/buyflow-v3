import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) throw new Error(`Builder file missing: ${file}`);
let s = fs.readFileSync(file, 'utf8');

const oldPickup = `    return row('', email('pickup@carrier.example', 'Partner csomagfelvétel', text), target('OTHER', 'merchant_outbound', null, null, 'not_applicable', text), ['v17.3', split, 'merchant_outbound']);`;
const newPickup = `    const day = String((i % 27) + 1).padStart(2, '0');
    const hour = 8 + (i % 8);
    const pickupRef = \`PU-\${split === 'train' ? 'TR' : 'VA'}-\${700000 + i}\`;
    const enriched = \`\${text}\\nBegyűjtés: 2026-09-\${day}, \${hour}:00-\${hour + 1}:00\\nPickup reference: \${pickupRef}\`;
    return row('', email('pickup@carrier.example', 'Partner csomagfelvétel', enriched), target('OTHER', 'merchant_outbound', null, null, 'not_applicable', text), ['v17.3', split, 'merchant_outbound']);`;

const oldSecurity = `    return row('', email(\`security@\${x.domain}\`, 'Biztonsági értesítés', text), target('OTHER', 'non_purchase', null, null, 'not_applicable', text), ['v17.3', split, 'security']);`;
const newSecurity = `    const device = ['Windows PC', 'Android phone', 'iPhone', 'Chrome browser', 'Edge browser'][i % 5];
    const minute = String(i % 60).padStart(2, '0');
    const secRef = \`SEC-\${split === 'train' ? 'TR' : 'VA'}-\${600000 + i}\`;
    const enriched = \`\${text}\\nEszköz: \${device}\\nIdőpont: 2026-09-\${String((i % 27) + 1).padStart(2, '0')} 1\${i % 10}:\${minute}\\nSecurity reference: \${secRef}\`;
    return row('', email(\`security@\${x.domain}\`, 'Biztonsági értesítés', enriched), target('OTHER', 'non_purchase', null, null, 'not_applicable', text), ['v17.3', split, 'security']);`;

let replacements = 0;
if (!s.includes(oldPickup)) throw new Error('Expected merchant_outbound source pattern not found; refusing to patch unknown builder.');
s = s.replace(oldPickup, newPickup); replacements++;
if (!s.includes(oldSecurity)) throw new Error('Expected security source pattern not found; refusing to patch unknown builder.');
s = s.replace(oldSecurity, newSecurity); replacements++;

s = s.replace("console.log('BUYFLOW V17.3 LARGE TEACHER DATASET READY');", "console.log('BUYFLOW V17.3 LARGE TEACHER DATASET READY V2');");
fs.writeFileSync(file, s, 'utf8');
console.log(`BUILDER PATCH V2: PASS | replacements=${replacements}`);
console.log('Duplicate-prone OTHER families now use natural variable context.');
