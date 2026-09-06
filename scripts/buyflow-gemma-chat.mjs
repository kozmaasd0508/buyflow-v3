import readline from 'node:readline';

const OLLAMA = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.BUYFLOW_CHAT_MODEL || 'gemma3:12b';

const system = `You are the local BuyFlow AI assistant running on the user's computer.
You can have a normal conversation in Hungarian or in the user's language.
Your specialty is understanding purchase, webshop, payment, invoice, shipping, delivery, pickup, return, refund and warranty emails.
Reason from the meaning of the text instead of memorizing exact phrases.
Important BuyFlow boundaries:
- A shipping label or shipment record being created is SHIPMENT_CREATED, not proof that the courier physically received the parcel.
- SHIPPED requires evidence that the seller handed/sent the parcel into the delivery flow.
- IN_TRANSIT means the parcel is moving through the carrier network.
- OUT_FOR_DELIVERY means the parcel is with the courier for delivery to the recipient now/today.
- READY_FOR_PICKUP means the parcel is waiting for the recipient at a pickup point/locker/store.
- DELIVERED means delivery/receipt is completed.
- Distinguish a buyer's incoming purchase from a merchant/mailbox-owner sending an outbound parcel.
- Marketing, surveys and account-security messages are not purchase lifecycle events unless the current message also contains real current lifecycle evidence.
If uncertain, say what evidence is missing. Do not invent facts.
This is an exploratory chat, not production BuyFlow decision logic.`;

const messages = [{ role: 'system', content: system }];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

let pasteMode = false;
let pasteLines = [];
let busy = false;

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
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      options: { temperature: 0.3, num_ctx: 16384 }
    })
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const answer = j?.message?.content?.trim();
  if (!answer) throw new Error('Empty model response');
  messages.push({ role: 'assistant', content: answer });
  return answer;
}

function showPrompt() {
  if (!busy && !pasteMode) process.stdout.write('\nTe > ');
}

async function sendToGemma(text) {
  const q = text.trim();
  if (!q || busy) return;
  busy = true;
  try {
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

rl.on('line', async line => {
  const trimmed = line.trim();

  if (pasteMode) {
    if (trimmed.toLowerCase() === '/send') {
      const text = pasteLines.join('\n');
      pasteLines = [];
      pasteMode = false;
      console.log(`\n[${text.length} karakter elküldése a Gemmának]`);
      await sendToGemma(text);
      return;
    }
    if (trimmed.toLowerCase() === '/cancel') {
      pasteLines = [];
      pasteMode = false;
      console.log('\nBeillesztés megszakítva.');
      showPrompt();
      return;
    }
    pasteLines.push(line);
    return;
  }

  if (busy) return;
  if (!trimmed) { showPrompt(); return; }

  const lower = trimmed.toLowerCase();
  if (['/exit','exit','kilep','kilép','quit'].includes(lower)) {
    rl.close();
    return;
  }
  if (lower === '/clear') {
    messages.splice(1);
    console.log('\nBeszélgetés törölve.');
    showPrompt();
    return;
  }
  if (lower === '/paste') {
    pasteMode = true;
    pasteLines = [];
    console.log('\nBEILLESZTÉSI MÓD');
    console.log('Illeszd be most a teljes hosszú szöveget / e-maileket.');
    console.log('Ha kész, egy új sorba írd: /send');
    console.log('Megszakítás: /cancel\n');
    return;
  }

  await sendToGemma(line);
});

rl.on('close', () => {
  console.log('\nBuyFlow AI Chat bezárva.');
});

try {
  await health();
  console.log('==============================================================');
  console.log('BUYFLOW AI CHAT - LOCAL GEMMA 3 12B');
  console.log(`Model: ${MODEL}`);
  console.log('Ollama: READY');
  console.log('Ez csak helyi chat. Gmail 0 | BuyFlow writes 0 | Production OFF');
  console.log('Parancsok:');
  console.log('  /paste = hosszú, többsoros szöveg beillesztése');
  console.log('  /send  = beillesztett szöveg elküldése');
  console.log('  /clear = új beszélgetés');
  console.log('  /exit  = kilépés');
  console.log('==============================================================');
  showPrompt();
} catch (e) {
  console.error(`BUYFLOW AI CHAT: BLOCKED - ${e.message}`);
  process.exitCode = 1;
  rl.close();
}
