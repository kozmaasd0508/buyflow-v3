import readline from 'node:readline';

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.BUYFLOW_CHAT_MODEL || 'gemma3:12b';

const system = `You are a helpful assistant analyzing commerce emails for BuyFlow.
Understand each email from its actual meaning and evidence. Do not invent missing facts or links.
Use these event labels when they fit: ORDER_CREATED, ORDER_PROCESSING, PAYMENT, INVOICE, SHIPMENT_CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, READY_FOR_PICKUP, DELIVERED, CANCELLED, REFUNDED, RETURN, OTHER.
If the text clearly says the seller handed the parcel to the carrier, classify it as SHIPPED rather than SHIPMENT_CREATED.
merchant_outbound means the mailbox owner is acting as the sender/seller and a carrier is collecting or transporting parcels the mailbox owner is sending to customers. Do not mark ordinary incoming buyer purchase emails as merchant_outbound just because the sender is a merchant, carrier, payment provider or invoicing service.
Link emails only when the text gives reliable evidence such as an exact order ID or exact tracking ID. If the link is uncertain, say so.
Keep the final summary consistent with the per-email classifications already given; do not reassign an email to a different purchase or event without explicit new evidence.
Answer in the user's language.`;

const messages = [{ role: 'system', content: system }];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

let busy = false;
let pendingLines = [];
let pendingTimer = null;
const GROUP_DELAY_MS = 900;

async function health() {
  const r = await fetch(`${OLLAMA}/api/tags`);
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const j = await r.json();
  const names = (j.models || []).map(x => x.name || x.model);
  if (!names.some(x => x === MODEL || x?.startsWith(`${MODEL}:`))) {
    throw new Error(`Model not found: ${MODEL}. Installed: ${names.join(', ')}`);
  }
}

async function ask(content) {
  messages.push({ role: 'user', content });
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, stream: false, options: { temperature: 0.3, num_ctx: 16384 } })
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const answer = j?.message?.content?.trim();
  if (!answer) throw new Error('Empty model response');
  messages.push({ role: 'assistant', content: answer });
  return answer;
}

function showPrompt() { if (!busy) process.stdout.write('\nTe > '); }

async function sendToGemma(text) {
  const q = text.trim();
  if (!q || busy) return;
  busy = true;
  try {
    if (q.includes('\n')) console.log(`\n[${q.length} karakter elküldése egy üzenetként]`);
    process.stdout.write('\nGemma > gondolkodik...\r');
    const a = await ask(q);
    process.stdout.write(' '.repeat(100) + '\r');
    console.log(`Gemma > ${a}`);
  } catch (e) {
    console.error(`\nHIBA: ${e.message}`);
  } finally {
    busy = false;
    showPrompt();
  }
}

async function flushPending() {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  if (!pendingLines.length) return;
  const text = pendingLines.join('\n');
  pendingLines = [];
  await sendToGemma(text);
}

rl.on('line', line => {
  if (busy) return;
  const trimmed = line.trim();
  const lower = trimmed.toLowerCase();
  if (pendingLines.length === 0 && ['exit','/exit','kilep','kilép','quit'].includes(lower)) { rl.close(); return; }
  if (pendingLines.length === 0 && lower === '/clear') {
    messages.splice(1);
    console.log('\nBeszélgetés törölve.');
    showPrompt();
    return;
  }
  pendingLines.push(line);
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { void flushPending(); }, GROUP_DELAY_MS);
});

rl.on('close', () => {
  if (pendingTimer) clearTimeout(pendingTimer);
  console.log('\nBuyFlow V17.1 Chat bezárva.');
});

try {
  await health();
  console.log('==============================================================');
  console.log('BUYFLOW V17.1 TEST - LOCAL GEMMA 3 12B');
  console.log(`Model: ${MODEL}`);
  console.log('Ollama: READY');
  console.log('Minimal prompt + 3 narrow fixes');
  console.log('Gmail 0 | BuyFlow writes 0 | Production OFF');
  console.log('Illeszd be a tesztet, automatikusan egy üzenetként elküldi.');
  console.log('/clear = új beszélgetés | /exit = kilépés');
  console.log('==============================================================');
  showPrompt();
} catch (e) {
  console.error(`BUYFLOW V17.1 CHAT: BLOCKED - ${e.message}`);
  process.exitCode = 1;
  rl.close();
}
