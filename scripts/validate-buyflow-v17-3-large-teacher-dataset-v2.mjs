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
function check(rows, expected, name) {
  if (rows.length !== expected) throw new Error(`${name}: expected ${expected}, got ${rows.length}`);
  const users = rows.map(userText);
  if (users.some(x => !x)) throw new Error(`${name}: missing user content`);
  const unique = new Set(users);
  if (unique.size !== rows.length) throw new Error(`${name}: exact duplicate remains: unique=${unique.size}/${rows.length}`);
  return unique;
}

const trainFile = path.join(dir, 'train.jsonl');
const valFile = path.join(dir, 'validation.jsonl');
if (!fs.existsSync(trainFile) || !fs.existsSync(valFile)) throw new Error('train.jsonl or validation.jsonl missing');

const train = readJsonl(trainFile);
const val = readJsonl(valFile);
const trainUsers = check(train, 3000, 'train');
const valUsers = check(val, 400, 'validation');
let overlap = 0;
for (const u of valUsers) if (trainUsers.has(u)) overlap++;
if (overlap !== 0) throw new Error(`train-validation exact user overlap=${overlap}`);

console.log('STRICT CORPUS VALIDATION: PASS');
console.log(`Train unique inputs: ${trainUsers.size}/3000`);
console.log(`Validation unique inputs: ${valUsers.size}/400`);
console.log(`Train-validation exact overlap: ${overlap}`);
console.log('External Blind V2: NOT READ / NOT MODIFIED');
console.log('Training: NOT STARTED');
console.log('Production: OFF');
