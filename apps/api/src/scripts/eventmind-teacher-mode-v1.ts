import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { normalizeGmailMessage } from '../email/gmail-incremental-provider.js';
import { normalizeEmailDocumentV1 } from '../email/normalize-document-v1.js';
import {
  EVENTMIND_V11_MAX_NEW_TOKENS,
  EVENTMIND_V11_MODEL_ID,
  EVENTMIND_V11_RUNTIME_PROTOCOL,
  EVENTMIND_V11_RUNTIME_VERSION,
  EVENTMIND_V11_TEMPLATE_VERSION,
  eventMindV11RuntimeConfigFromEnvironment,
} from '../ai/eventmind-v11-runtime.js';

interface GmailBodyLike { attachmentId?: string; size?: number; data?: string }
interface GmailHeaderLike { name?: string; value?: string }
interface GmailPartLike { mimeType?: string; filename?: string; headers?: GmailHeaderLike[]; body?: GmailBodyLike; parts?: GmailPartLike[] }
interface GmailMessageLike { id?: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPartLike }

type Target = { index: number; expected: string; previous: string | null };
type DialogueTurn = { teacher: string; student: string };

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const EXPECTED_COUNT = 120;
const EXPECTED_ID_SHA256 = '88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470';
const MAX_CASE_PACKET_CHARS = 4_200;
const MAX_STUDENT_PROMPT_CHARS = 7_000;
const MAX_HISTORY_TURNS = 3;

// Active-learning order from the 2026-09-04 REAL120 development errors.
// Start with the dominant failure groups: OTHER/merchant-outbound, then
// SHIPMENT_CREATED and SHIPPED. No Gmail ids or message content are committed.
const TARGETS: Target[] = [
  { index: 3, expected: 'OTHER', previous: 'READY_FOR_PICKUP' },
  { index: 5, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 10, expected: 'OTHER', previous: 'READY_FOR_PICKUP' },
  { index: 11, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 15, expected: 'OTHER', previous: 'OUT_FOR_DELIVERY' },
  { index: 16, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 18, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 21, expected: 'OTHER', previous: 'OUT_FOR_DELIVERY' },
  { index: 22, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 26, expected: 'OTHER', previous: 'OUT_FOR_DELIVERY' },
  { index: 27, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 34, expected: 'OTHER', previous: 'OUT_FOR_DELIVERY' },
  { index: 35, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 43, expected: 'OTHER', previous: 'OUT_FOR_DELIVERY' },
  { index: 44, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 49, expected: 'OTHER', previous: 'OUT_FOR_DELIVERY' },
  { index: 50, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 52, expected: 'OTHER', previous: 'OUT_FOR_DELIVERY' },
  { index: 53, expected: 'OTHER', previous: 'ORDER_CREATED' },
  { index: 54, expected: 'OTHER', previous: 'OUT_FOR_DELIVERY' },
  { index: 25, expected: 'SHIPMENT_CREATED', previous: 'READY_FOR_PICKUP' },
  { index: 30, expected: 'SHIPMENT_CREATED', previous: 'OUT_FOR_DELIVERY' },
  { index: 37, expected: 'SHIPMENT_CREATED', previous: 'ORDER_PACKING' },
  { index: 40, expected: 'SHIPMENT_CREATED', previous: 'READY_FOR_PICKUP' },
  { index: 92, expected: 'SHIPMENT_CREATED', previous: 'READY_FOR_PICKUP' },
  { index: 96, expected: 'SHIPMENT_CREATED', previous: 'ORDER_PACKING' },
  { index: 99, expected: 'SHIPMENT_CREATED', previous: 'ORDER_PACKING' },
  { index: 101, expected: 'SHIPMENT_CREATED', previous: 'ORDER_PACKING' },
  { index: 104, expected: 'SHIPMENT_CREATED', previous: 'READY_FOR_PICKUP' },
  { index: 108, expected: 'SHIPMENT_CREATED', previous: 'OUT_FOR_DELIVERY' },
  { index: 2, expected: 'SHIPPED', previous: null },
  { index: 7, expected: 'SHIPPED', previous: 'SHIPMENT_CREATED' },
  { index: 32, expected: 'SHIPPED', previous: 'ORDER_PACKING' },
  { index: 33, expected: 'SHIPPED', previous: 'SHIPMENT_CREATED' },
  { index: 47, expected: 'SHIPPED', previous: 'SHIPMENT_CREATED' },
  { index: 74, expected: 'SHIPPED', previous: 'SHIPMENT_CREATED' },
  { index: 85, expected: 'SHIPPED', previous: 'READY_FOR_PICKUP' },
  { index: 90, expected: 'SHIPPED', previous: 'READY_FOR_PICKUP' },
];

const LIFECYCLE_TERMS = [
  'out for delivery', 'delivering today', 'delivery today', 'arriving today', 'kézbesít', 'kézbesítés', 'futár',
  'shipped', 'dispatched', 'feladtuk', 'feladva', 'átadtuk a futárnak', 'in transit', 'úton van',
  'ready for pickup', 'pickup', 'locker', 'átvehető', 'automata', 'csomagpont', 'delivered', 'kézbesítve',
  'processing', 'feldolgozás', 'packing', 'csomagolás', 'invoice', 'számla', 'payment', 'fizetés',
  'return', 'visszaküldés', 'cancelled', 'törölve', 'felvétel', 'pickup request', 'collection request',
];

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }

async function gmailJson(path: string, accessToken: string): Promise<any> {
  const response = await fetch(`${GMAIL_BASE}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`GMAIL_HTTP_${response.status}`);
  return await response.json();
}

function headerValue(part: GmailPartLike, name: string): string | null {
  return (part.headers ?? []).find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}
function isDetachedRenderableBody(part: GmailPartLike): boolean {
  const mime = part.mimeType?.toLowerCase();
  if (mime !== 'text/plain' && mime !== 'text/html') return false;
  if (part.filename?.trim()) return false;
  if (/\battachment\b/.test(headerValue(part, 'Content-Disposition')?.toLowerCase() ?? '')) return false;
  return Boolean(part.body?.attachmentId?.trim() && !part.body?.data);
}
async function hydrateDetachedBodies(part: GmailPartLike | undefined, messageId: string, accessToken: string): Promise<void> {
  if (!part) return;
  if (isDetachedRenderableBody(part)) {
    const attachmentId = part.body!.attachmentId!.trim();
    const payload = await gmailJson(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, accessToken);
    if (typeof payload.data === 'string' && payload.data.length > 0) part.body = { ...part.body, data: payload.data };
  }
  for (const child of part.parts ?? []) await hydrateDetachedBodies(child, messageId, accessToken);
}

function compactWhitespace(value: string): string { return value.replace(/\s+/g, ' ').trim(); }

function evidenceWindows(text: string): string[] {
  const lower = text.toLowerCase();
  const windows: string[] = [];
  for (const term of LIFECYCLE_TERMS) {
    const at = lower.indexOf(term.toLowerCase());
    if (at < 0) continue;
    const start = Math.max(0, at - 260);
    const end = Math.min(text.length, at + term.length + 420);
    const value = compactWhitespace(text.slice(start, end));
    if (value && !windows.some((existing) => existing.includes(value) || value.includes(existing))) windows.push(value);
    if (windows.length >= 5) break;
  }
  return windows;
}

function buildCasePacket(subject: string, from: string, semanticText: string): string {
  if (semanticText.length <= 3_500) {
    return [`SUBJECT: ${subject}`, `FROM: ${from}`, '', semanticText].join('\n').slice(0, MAX_CASE_PACKET_CHARS);
  }
  const windows = evidenceWindows(semanticText);
  const pieces = [
    `SUBJECT: ${subject}`,
    `FROM: ${from}`,
    '',
    'BEGINNING:', semanticText.slice(0, 800),
    '',
    'LIFECYCLE EVIDENCE:', ...windows,
    '',
    'ENDING:', semanticText.slice(-700),
  ];
  return pieces.join('\n').slice(0, MAX_CASE_PACKET_CHARS);
}

function suggestedTeacherMessage(target: Target): string {
  if (target.expected === 'OTHER') {
    return 'Ez nem a postaláda tulajdonosának vásárlási életciklusa. Először döntsd el a szerepet: buyer-side vásárlásról van szó, vagy a feladó/kereskedő saját csomagfeladásáról, futárfelvételéről, operációjáról. Merchant/outbound pickup vagy collection = OTHER. Mondd el röviden, milyen jelből fogod ezt legközelebb felismerni.';
  }
  if (target.expected === 'SHIPMENT_CREATED') {
    return 'A helyes címke SHIPMENT_CREATED. Ez csak küldemény létrehozás, címke/adat rögzítés vagy előértesítés. Nincs bizonyíték arra, hogy a csomagot ténylegesen átadták a futárnak. SHIPPED csak fizikai feladás/átadás után lehet. Fogalmazd meg a különbséget egy szabályként.';
  }
  if (target.expected === 'SHIPPED') {
    return 'A helyes címke SHIPPED. Itt már tényleges feladás vagy futárnak átadás történt, nem csak szállítási adat/címke létrehozása. Fogalmazd meg, milyen bizonyíték kell a SHIPPED-hez, és miért nem SHIPMENT_CREATED.';
  }
  return `A helyes címke ${target.expected}. A korábbi válaszod ${target.previous ?? 'érvénytelen'} volt. Magyarázd el röviden, milyen konkrét bizonyíték választja el ezt a két állapotot.`;
}

async function rawStudentReply(prompt: string): Promise<string> {
  const config = eventMindV11RuntimeConfigFromEnvironment();
  if (!config.enabled) throw new Error('RUNTIME_DISABLED');
  if (prompt.length > MAX_STUDENT_PROMPT_CHARS) throw new Error(`TEACHER_PROMPT_TOO_LARGE:${prompt.length}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: EVENTMIND_V11_RUNTIME_PROTOCOL,
        prompt,
        generation: { do_sample: false, enable_thinking: false, max_new_tokens: EVENTMIND_V11_MAX_NEW_TOKENS },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RUNTIME_HTTP_${response.status}`);
    const payload = await response.json() as any;
    if (
      payload?.protocol_version !== EVENTMIND_V11_RUNTIME_PROTOCOL
      || payload?.model_id !== EVENTMIND_V11_MODEL_ID
      || String(payload?.adapter_sha256 ?? '').toLowerCase() !== config.expectedAdapterSha256
      || payload?.runtime_version !== EVENTMIND_V11_RUNTIME_VERSION
      || payload?.template_version !== EVENTMIND_V11_TEMPLATE_VERSION
      || payload?.thinking_enabled !== false
      || payload?.deterministic !== true
      || typeof payload?.output !== 'string'
    ) throw new Error('INVALID_RUNTIME_RESPONSE');
    return payload.output.trim();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('RUNTIME_TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); }
}

function initialPrompt(packet: string): string {
  return [
    'You are the BuyFlow EventMind student. Inspect this buyer-mailbox email excerpt.',
    'State the single best event label and one short reason. Do not discuss Purchase identity.',
    'Be concise.', '', 'EMAIL:', packet,
  ].join('\n');
}

function teachingPrompt(packet: string, target: Target, dialogue: DialogueTurn[], teacher: string): string {
  const history = dialogue.slice(-MAX_HISTORY_TURNS).map((turn) => `TEACHER: ${turn.teacher}\nSTUDENT: ${turn.student}`).join('\n');
  return [
    'You are the BuyFlow EventMind student in a supervised teaching session.',
    `The verified correct event label for this development example is ${target.expected}.`,
    `Your previous production-style result was ${target.previous ?? 'invalid/no final result'}.`,
    'Learn the generalizable distinction from the teacher. Do not merely repeat the label.',
    'Reply in at most two short sentences: the rule you learned, or one clarifying question.',
    'Do not make Purchase identity/link/create/merge decisions.',
    '', 'EMAIL EXCERPT:', packet,
    ...(history ? ['', 'RECENT DIALOGUE:', history] : []),
    '', `TEACHER: ${teacher}`, 'STUDENT:',
  ].join('\n').slice(0, MAX_STUDENT_PROMPT_CHARS);
}

async function main() {
  const idFile = process.argv[2];
  const summaryPath = process.argv[3];
  if (!idFile || !summaryPath) throw new Error('USAGE: <real120-id-file.json> <safe-summary.json>');

  const ids = JSON.parse(await readFile(idFile, 'utf8')) as unknown;
  if (!Array.isArray(ids) || ids.length !== EXPECTED_COUNT || ids.some((value) => typeof value !== 'string')) throw new Error('REAL120_ID_FILE_INVALID');
  const normalizedIds = (ids as string[]).map((value) => value.trim());
  const actualSha = sha256(normalizedIds.join('\n'));
  if (actualSha !== EXPECTED_ID_SHA256) throw new Error(`FROZEN_ID_SHA_MISMATCH:${actualSha}`);
  const accessToken = process.env.BUYFLOW_GMAIL_TEST_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error('BUYFLOW_GMAIL_TEST_ACCESS_TOKEN_MISSING');

  const home = process.env.USERPROFILE || process.env.HOME || '.';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const privatePath = join(home, 'Desktop', 'buyflow', 'local-data', 'teacher-mode', `BuyFlow-TEACHER-PRIVATE-${stamp}.jsonl`);
  await mkdir(dirname(privatePath), { recursive: true });

  const safeSummary: any = {
    suite: 'EVENTMIND_TEACHER_MODE_V1',
    created_at: new Date().toISOString(),
    development_set: true,
    frozen_id_sha256: actualSha,
    safety: {
      gmail_http_methods: ['GET'], mailbox_mutations: 0, buyflow_db_writes: 0, production_flags_enabled: false,
      raw_gmail_ids_persisted_in_safe_summary: false, message_content_persisted_in_safe_summary: false,
      private_session_committed_to_git: false,
    },
    priority_groups: ['OTHER/merchant-outbound', 'SHIPMENT_CREATED', 'SHIPPED'],
    accepted: [], skipped: [],
  };

  const rl = createInterface({ input, output });
  console.log('');
  console.log('==============================================================');
  console.log('BUYFLOW EVENTMIND - INTERACTIVE TEACHER MODE V1');
  console.log('REAL120 DEVELOPMENT ERRORS / LOCAL PRIVATE SESSION');
  console.log('==============================================================');
  console.log('Parancsok: /accept  /skip  /full  /done  /help');
  console.log('Üres ENTER = a javasolt tanári üzenet automatikus elküldése.');
  console.log(`Privát tanítófájl: ${privatePath}`);
  console.log(`Megosztható összegzés: ${summaryPath}`);

  try {
    for (const target of TARGETS) {
      const gmailId = normalizedIds[target.index - 1]!;
      const message = await gmailJson(`/messages/${encodeURIComponent(gmailId)}?format=full`, accessToken) as GmailMessageLike;
      await hydrateDetachedBodies(message.payload, gmailId, accessToken);
      const document = normalizeEmailDocumentV1(normalizeGmailMessage(message as any));
      const semanticText = document.semanticText ?? '';
      const subject = document.subject ?? '';
      const from = document.from.map((item) => item.email).join(', ');
      const packet = buildCasePacket(subject, from, semanticText);
      const dialogue: DialogueTurn[] = [];
      const suggestion = suggestedTeacherMessage(target);

      console.log('');
      console.log('--------------------------------------------------------------');
      console.log(`CASE #${target.index} | HELYES: ${target.expected} | ELŐZŐ: ${target.previous ?? 'NINCS/INVALID'}`);
      console.log(`Tárgy: ${subject}`);
      console.log(`Feladó: ${from}`);
      console.log(`semanticText: ${semanticText.length} karakter | AI packet: ${packet.length} karakter`);
      console.log('--------------------------------------------------------------');
      console.log(packet);
      console.log('--------------------------------------------------------------');

      let initial = '';
      try {
        initial = await rawStudentReply(initialPrompt(packet));
        console.log(`AI első válasza: ${initial || '<üres>'}`);
      } catch (error) {
        initial = `ERROR:${error instanceof Error ? error.message : String(error)}`;
        console.log(`AI első válasz HIBA: ${initial}`);
      }
      console.log('');
      console.log('Javasolt tanári üzenet:');
      console.log(suggestion);

      let finishedCase = false;
      while (!finishedCase) {
        const raw = await rl.question('\nTanár> ');
        const command = raw.trim();
        if (command === '/help') {
          console.log('/accept = jó tanítóbeszélgetés mentése | /skip = kihagyás | /full = teljes semanticText | /done = kilépés');
          continue;
        }
        if (command === '/full') { console.log(semanticText); continue; }
        if (command === '/done') {
          safeSummary.stopped_by_user = true;
          await writeFile(summaryPath, JSON.stringify(safeSummary, null, 2), 'utf8');
          return;
        }
        if (command === '/skip') {
          safeSummary.skipped.push({ index: target.index, expected: target.expected, previous: target.previous, gmail_id_sha256: sha256(gmailId) });
          await writeFile(summaryPath, JSON.stringify(safeSummary, null, 2), 'utf8');
          finishedCase = true;
          continue;
        }
        if (command === '/accept') {
          const privateRecord = {
            version: 1,
            accepted_at: new Date().toISOString(),
            index: target.index,
            gmail_id_sha256: sha256(gmailId),
            expected_event_type: target.expected,
            previous_prediction: target.previous,
            subject,
            from,
            semantic_text: semanticText,
            case_packet: packet,
            initial_student_reply: initial,
            dialogue,
          };
          await appendFile(privatePath, `${JSON.stringify(privateRecord)}\n`, 'utf8');
          safeSummary.accepted.push({
            index: target.index, expected: target.expected, previous: target.previous,
            gmail_id_sha256: sha256(gmailId), turns: dialogue.length, semantic_text_chars: semanticText.length,
          });
          await writeFile(summaryPath, JSON.stringify(safeSummary, null, 2), 'utf8');
          console.log('MENTVE. Ez a privát session később tanítóadattá alakítható.');
          finishedCase = true;
          continue;
        }

        const teacher = command || suggestion;
        try {
          const student = await rawStudentReply(teachingPrompt(packet, target, dialogue, teacher));
          dialogue.push({ teacher, student });
          console.log(`AI> ${student || '<üres>'}`);
        } catch (error) {
          const student = `ERROR:${error instanceof Error ? error.message : String(error)}`;
          dialogue.push({ teacher, student });
          console.log(`AI HIBA> ${student}`);
        }
      }
    }
  } finally {
    rl.close();
    safeSummary.completed_targets = safeSummary.accepted.length + safeSummary.skipped.length;
    safeSummary.updated_at = new Date().toISOString();
    await writeFile(summaryPath, JSON.stringify(safeSummary, null, 2), 'utf8');
  }
}

main().catch((error) => {
  console.error(`TEACHER_MODE_FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
