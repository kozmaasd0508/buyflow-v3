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
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

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
      options: { temperature: 0.3, num_ctx: 8192 }
    })
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const answer = j?.message?.content?.trim();
  if (!answer) throw new Error('Empty model response');
  messages.push({ role: 'assistant', content: answer });
  return answer;
}

function prompt() {
  rl.question('\nTe > ', async text => {
    const q = text.trim();
    if (!q) return prompt();
    if (['/exit','exit','kilep','kilép','quit'].includes(q.toLowerCase())) return rl.close();
    if (q.toLowerCase() === '/clear') {
      messages.splice(1);
      console.log('Beszélgetés törölve.');
      return prompt();
    }
    try {
      process.stdout.write('\nGemma > gondolkodik...\r');
      const a = await ask(q);
      process.stdout.write(' '.repeat(80) + '\r');
      console.log(`Gemma > ${a}`);
    } catch (e) {
      console.error(`\nHIBA: ${e.message}`);
    }
    prompt();
  });
}

try {
  await health();
  console.log('==============================================================');
  console.log('BUYFLOW AI CHAT - LOCAL GEMMA 3 12B');
  console.log(`Model: ${MODEL}`);
  console.log('Ollama: READY');
  console.log('Ez csak helyi chat. Gmail 0 | BuyFlow writes 0 | Production OFF');
  console.log('Parancsok: /clear = új beszélgetés | /exit = kilépés');
  console.log('==============================================================');
  prompt();
} catch (e) {
  console.error(`BUYFLOW AI CHAT: BLOCKED - ${e.message}`);
  process.exitCode = 1;
  rl.close();
}
