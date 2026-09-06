import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('Dataset directory argument is required');

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}
function userText(row) {
  return row.messages?.find(m => m.role === 'user')?.content ?? null;
}
function assistant(row) {
  const t = row.messages?.find(m => m.role === 'assistant')?.content;
  return t ? JSON.parse(t) : null;
}
function check(rows, expected, name) {
  if (rows.length !== expected) throw new Error(`${name}: expected ${expected}, got ${rows.length}`);
  const users = rows.map(userText);
  if (users.some(x => !x)) throw new Error(`${name}: missing user content`);
  const unique = new Set(users);
  if (unique.size !== rows.length) throw new Error(`${name}: exact duplicate remains: unique=${unique.size}/${rows.length}`);
  const links = { linked: 0, unresolved: 0, not_applicable: 0 };
  const events = {};
  for (const r of rows) {
    const a = assistant(r);
    if (!a) throw new Error(`${name}: missing assistant target`);
    if (!(a.link_status in links)) throw new Error(`${name}: bad link_status ${a.link_status}`);
    links[a.link_status]++;
    events[a.event_type] = (events[a.event_type] || 0) + 1;
  }
  return { unique, links, events };
}

const trainFile = path.join(dir, 'train.jsonl');
const valFile = path.join(dir, 'validation.jsonl');
const manifestFile = path.join(dir, 'manifest.json');
if (!fs.existsSync(trainFile) || !fs.existsSync(valFile) || !fs.existsSync(manifestFile)) throw new Error('train.jsonl, validation.jsonl or manifest.json missing');

const train = check(readJsonl(trainFile), 5000, 'train');
const val = check(readJsonl(valFile), 600, 'validation');
let overlap = 0;
for (const u of val.unique) if (train.unique.has(u)) overlap++;
if (overlap !== 0) throw new Error(`train-validation exact user overlap=${overlap}`);

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (manifest.dataset !== 'buyflow-v17-4-5000-teacher') throw new Error(`Unexpected manifest dataset: ${manifest.dataset}`);
if (manifest.train_rows !== 5000 || manifest.validation_rows !== 600) throw new Error('Manifest row counts mismatch');

console.log('STRICT V17.4 CORPUS VALIDATION: PASS');
console.log(`Train unique inputs: ${train.unique.size}/5000`);
console.log(`Validation unique inputs: ${val.unique.size}/600`);
console.log(`Train-validation exact overlap: ${overlap}`);
console.log(`Train link_status: linked=${train.links.linked} | unresolved=${train.links.unresolved} | not_applicable=${train.links.not_applicable}`);
console.log(`Validation link_status: linked=${val.links.linked} | unresolved=${val.links.unresolved} | not_applicable=${val.links.not_applicable}`);
console.log('External Blind V3: NOT READ / NOT MODIFIED');
console.log('Training: NOT STARTED');
console.log('Production: OFF');
