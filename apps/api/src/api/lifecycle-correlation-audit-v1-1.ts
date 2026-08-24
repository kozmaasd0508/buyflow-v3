import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import {
  correlateLifecycleShadow,
  type CorrelationEvidence,
  type CorrelationEventType,
} from '../resolution/lifecycle-correlation-shadow.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const PAGE_SIZE = 100;
const MAX_SCAN = 4_000;
const PURCHASE_LABEL_PREFIX = 'BuyFlow Lifecycle Audit/v1.1/P';
const HOLDOUT_LABEL = 'BuyFlow Lifecycle Audit/v1.1/Holdout';
const NOISE_LABEL = 'BuyFlow Lifecycle Audit/v1.1/Noise';
const PURCHASE_COUNT = 21;
const PURCHASE_LABELS = Array.from({ length: PURCHASE_COUNT }, (_, index) =>
  `${PURCHASE_LABEL_PREFIX}${String(index + 1).padStart(2, '0')}`,
);

type GroundTruthKind = 'purchase' | 'noise';

interface GroundTruthEmail {
  sourceEmailId: string;
  expectedGroupId: string | null;
  expectedKind: GroundTruthKind;
  sender: string | null;
  subject: string | null;
  receivedAt: string;
  plan: ReturnType<typeof planNormalizedInboundEmail>;
  evidence: CorrelationEvidence | null;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function eventType(value: string | null): CorrelationEventType {
  switch (value) {
    case 'order_created':
    case 'order_updated':
    case 'payment_completed':
    case 'shipment':
    case 'delivery':
    case 'invoice_or_receipt':
    case 'refund':
    case 'return':
      return value;
    default:
      return 'other';
  }
}

function toEvidence(
  userId: string,
  email: NormalizedEmail,
  plan: ReturnType<typeof planNormalizedInboundEmail>,
): CorrelationEvidence | null {
  if (!plan.classification || plan.classification.startsWith('security_')) return null;
  const result = plan.validatedResult ?? plan.structuredResult;
  return {
    sourceEmailId: email.providerMessageId,
    userId,
    eventType: eventType(plan.classification),
    senderDomain: (email.from[0]?.email?.split('@').pop() ?? '').toLowerCase(),
    merchant: stringOrNull(result.merchant),
    orderNumber: stringOrNull(result.order_number),
    trackingNumber: stringOrNull(result.tracking_number),
    invoiceNumber: stringOrNull(result.invoice_number),
    receivedAt: email.receivedAt,
  };
}

async function runAudit(userId: string) {
  const db = getSupabaseAdmin() as any;
  const { data: connection, error } = await db
    .from('email_connections')
    .select('provider_account_id')
    .eq('user_id', userId)
    .eq('provider', 'nylas')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error('email_connection_lookup_failed');
  if (!connection?.provider_account_id) throw new Error('active_nylas_connection_not_found');

  const provider = createEmailProvider({
    provider: 'nylas',
    providerAccountId: connection.provider_account_id,
  });
  const rows: GroundTruthEmail[] = [];
  const missingLabels: string[] = [];
  let scanned = 0;

  async function scanLabel(label: string, expectedGroupId: string | null, expectedKind: GroundTruthKind) {
    let cursor: string | undefined;
    let count = 0;
    do {
      const page = await provider.searchMessages({
        query: `label:\"${label}\" -in:spam -in:trash`,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
      for (const email of page.messages) {
        scanned += 1;
        count += 1;
        const plan = planNormalizedInboundEmail({ email });
        rows.push({
          sourceEmailId: email.providerMessageId,
          expectedGroupId,
          expectedKind,
          sender: email.from[0]?.email ?? null,
          subject: email.subject ?? null,
          receivedAt: email.receivedAt,
          plan,
          evidence: expectedKind === 'purchase' ? toEvidence(userId, email, plan) : null,
        });
        if (scanned >= MAX_SCAN) break;
      }
      if (scanned >= MAX_SCAN) break;
      cursor = page.nextCursor;
    } while (cursor);
    if (count === 0) missingLabels.push(label);
  }

  for (let index = 0; index < PURCHASE_LABELS.length; index += 1) {
    await scanLabel(PURCHASE_LABELS[index]!, `P${String(index + 1).padStart(2, '0')}`, 'purchase');
  }
  await scanLabel(NOISE_LABEL, null, 'noise');

  const evidence = rows.flatMap((row) => (row.evidence ? [row.evidence] : []));
  const result = correlateLifecycleShadow(evidence);
  const assignmentBySource = new Map(
    result.assignments.map((assignment) => [assignment.sourceEmailId, assignment]),
  );

  const expectedGroupToPurchaseKeys = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.expectedGroupId || row.plan.classification !== 'order_created') continue;
    const assignment = assignmentBySource.get(row.sourceEmailId);
    if (!assignment?.purchaseKey) continue;
    const set = expectedGroupToPurchaseKeys.get(row.expectedGroupId) ?? new Set<string>();
    set.add(assignment.purchaseKey);
    expectedGroupToPurchaseKeys.set(row.expectedGroupId, set);
  }

  let linkedCorrect = 0;
  let linkedIncorrect = 0;
  let review = 0;
  let orphan = 0;
  let recognizedPurchaseEmails = 0;

  const detailRows = rows.map((row) => {
    if (row.expectedKind === 'noise') {
      const detected = Boolean(
        row.plan.classification
        && row.plan.classification !== 'other'
        && !row.plan.classification.startsWith('security_'),
      );
      return {
        sourceEmailId: row.sourceEmailId,
        expectedGroupId: null,
        expectedKind: 'noise',
        subject: row.subject,
        sender: row.sender,
        classification: row.plan.classification,
        parserVersion: row.plan.parserVersion,
        decision: detected ? 'noise_false_positive' : 'noise_true_negative',
        reason: detected ? 'commerce_detected_in_noise' : 'no_commerce_detection',
        purchaseKey: null,
      };
    }

    if (row.evidence) recognizedPurchaseEmails += 1;
    const assignment = assignmentBySource.get(row.sourceEmailId);
    const expectedKeys = row.expectedGroupId
      ? expectedGroupToPurchaseKeys.get(row.expectedGroupId) ?? new Set<string>()
      : new Set<string>();

    let verdict: 'linked_correct' | 'linked_incorrect' | 'review' | 'orphan';
    if (!assignment || !row.evidence) {
      verdict = 'orphan';
      orphan += 1;
    } else if (assignment.decision === 'review' || !assignment.purchaseKey) {
      verdict = 'review';
      review += 1;
    } else if (expectedKeys.size === 1 && expectedKeys.has(assignment.purchaseKey)) {
      verdict = 'linked_correct';
      linkedCorrect += 1;
    } else {
      verdict = 'linked_incorrect';
      linkedIncorrect += 1;
    }

    return {
      sourceEmailId: row.sourceEmailId,
      expectedGroupId: row.expectedGroupId,
      expectedKind: 'purchase',
      subject: row.subject,
      sender: row.sender,
      classification: row.plan.classification,
      parserVersion: row.plan.parserVersion,
      decision: verdict,
      reason: assignment?.reason ?? 'not_recognized',
      purchaseKey: assignment?.purchaseKey ?? null,
    };
  });

  const purchaseRows = rows.filter((row) => row.expectedKind === 'purchase');
  const noiseRows = rows.filter((row) => row.expectedKind === 'noise');
  const noiseFalsePositive = detailRows.filter((row) => row.decision === 'noise_false_positive').length;
  const mergeErrors = result.groups.filter((group) => {
    const expected = new Set(
      detailRows
        .filter((row) => row.purchaseKey === group.purchaseKey && row.expectedGroupId)
        .map((row) => row.expectedGroupId as string),
    );
    return expected.size > 1;
  }).length;
  const splitErrors = [...expectedGroupToPurchaseKeys.entries()].filter(([, keys]) => keys.size > 1).length;
  const expectedGroupsWithNoAnchor = PURCHASE_LABELS.map((_, index) =>
    `P${String(index + 1).padStart(2, '0')}`,
  ).filter((groupId) => (expectedGroupToPurchaseKeys.get(groupId)?.size ?? 0) === 0).length;

  const correlationPrecision = linkedCorrect + linkedIncorrect > 0
    ? linkedCorrect / (linkedCorrect + linkedIncorrect)
    : null;
  const correlationRecall = purchaseRows.length > 0 ? linkedCorrect / purchaseRows.length : null;

  return {
    ok: true,
    mode: 'shadow',
    source: 'nylas-lifecycle-correlation-v1.1-holdout',
    groundTruth: {
      purchaseGroups: PURCHASE_COUNT,
      purchaseLabels: PURCHASE_LABELS,
      holdoutLabel: HOLDOUT_LABEL,
      noiseLabel: NOISE_LABEL,
      originalV1Preserved: true,
      correctedAfterGroundTruthReview: true,
      fixtureMetadataStoredInRepository: false,
    },
    scanned,
    matchedTotal: rows.length,
    purchaseEmails: purchaseRows.length,
    noiseEmails: noiseRows.length,
    recognizedPurchaseEmails,
    missingLabels,
    summary: {
      linkedCorrect,
      linkedIncorrect,
      review,
      orphan,
      correlationPrecision,
      correlationRecall,
      mergeErrors,
      splitErrors,
      expectedGroupsWithNoAnchor,
      noiseFalsePositive,
      noiseTrueNegative: noiseRows.length - noiseFalsePositive,
    },
    engine: {
      groups: result.groups.length,
      assignments: result.assignments.length,
      productionWrites: result.productionWrites,
      aiCalls: result.aiCalls,
    },
    productionWrites: 0,
    aiCalls: 0,
    rows: detailRows,
  };
}

function pageHtml() {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Lifecycle Audit v1.1</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#071020;color:#f7f8ff}*{box-sizing:border-box}body{margin:0;background:#071020}main{width:min(1180px,calc(100% - 28px));margin:auto;padding:32px 0 70px}.card{background:#0d1830;border:1px solid #ffffff18;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:40px;margin:8px 0 10px}p,.muted{color:#9eacd0}.eyebrow{font-size:12px;font-weight:800;color:#d86cff;letter-spacing:.13em}.top{display:flex;justify-content:space-between;gap:16px}.back{color:#d8ddff;text-decoration:none}button{border:0;border-radius:14px;padding:13px 18px;font-weight:800;background:linear-gradient(135deg,#764cff,#e84f9b);color:#fff;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metric{padding:15px;background:#ffffff08;border-radius:16px}.metric strong{font-size:25px;display:block}.good{color:#62dfaa}.bad{color:#ff7d9d}.warn{color:#ffd27d}.row{display:grid;grid-template-columns:120px 90px 1fr;gap:12px;padding:13px;border-top:1px solid #ffffff10}.pill{font-size:11px;font-weight:800}.meta{font-size:12px;color:#8f9ec3}@media(max-width:760px){.metrics{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}}</style></head><body><main><div class="top"><strong>BuyFlow · Lifecycle Correlation Audit v1.1</strong><a class="back" href="/audit-lifecycle-v1">eredeti v1</a></div><section class="card"><div class="eyebrow">CLEAN GROUND TRUTH · SHADOW · 0 WRITE · 0 AI</div><h1>21 tisztított rendeléstörténet</h1><p>Az eredeti v1 megmarad audit trailnek. A v1.1 külön Gmail label namespace-ben fut, a hibás P03 két külön GymBeam rendelésre bontva. A correlation engine változatlan.</p><button id="run">Lifecycle v1.1 audit futtatása</button> <span id="status" class="muted">Bejelentkezés ellenőrzése…</span></section><section id="results" class="card" hidden></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const supabase=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const run=document.querySelector('#run'),status=document.querySelector('#status'),results=document.querySelector('#results');const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pct=v=>typeof v==='number'?(v*100).toFixed(1)+'%':'—';async function session(){const{data}=await supabase.auth.getSession();return data.session}function render(d){const s=d.summary||{},rows=(d.rows||[]).map(r=>'<div class="row"><span class="pill '+(r.decision==='linked_correct'||r.decision==='noise_true_negative'?'good':r.decision==='review'?'warn':'bad')+'">'+esc(r.decision)+'</span><span class="pill">'+esc(r.expectedGroupId||r.expectedKind)+'</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+' · '+esc(r.classification||'nincs felismerés')+' · '+esc(r.reason)+' · '+esc(r.purchaseKey||'—')+'</div></div></div>').join('');results.hidden=false;results.innerHTML='<div class="eyebrow">EREDMÉNY</div><div class="metrics"><div class="metric"><strong>'+pct(s.correlationPrecision)+'</strong><span>correlation precision</span></div><div class="metric"><strong>'+pct(s.correlationRecall)+'</strong><span>correlation recall</span></div><div class="metric"><strong class="'+(s.mergeErrors?'bad':'good')+'">'+esc(s.mergeErrors)+'</strong><span>merge error</span></div><div class="metric"><strong class="'+(s.splitErrors?'bad':'good')+'">'+esc(s.splitErrors)+'</strong><span>split error</span></div></div><p class="muted">Correct '+esc(s.linkedCorrect)+' · Wrong '+esc(s.linkedIncorrect)+' · Review '+esc(s.review)+' · Orphan '+esc(s.orphan)+' · Noise FP '+esc(s.noiseFalsePositive)+' · Groups without anchor '+esc(s.expectedGroupsWithNoAnchor)+' · Scanned '+esc(d.scanned)+'</p>'+rows}const initial=await session();status.textContent=initial?'Kész.':'Jelentkezz be az appban.';run.disabled=!initial;run.onclick=async()=>{const s=await session();if(!s)return;run.disabled=true;status.textContent='Lifecycle v1.1 audit fut…';try{const res=await fetch('/api/audit/lifecycle-correlation-v1-1',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,Accept:'application/json'}}),data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));render(data);status.textContent='Kész. 0 production write · 0 AI call.'}catch(e){status.textContent='Hiba: '+(e instanceof Error?e.message:String(e))}finally{run.disabled=false}};</script></body></html>`;
}

export async function registerLifecycleCorrelationAuditV11(app: FastifyInstance) {
  app.get('/audit-lifecycle-v1-1', async (_request, reply) =>
    reply.code(200).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(pageHtml()),
  );
  app.post('/api/audit/lifecycle-correlation-v1-1', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      const result = await runAudit(user.id);
      request.log.info(
        { userId: user.id, scanned: result.scanned, ...result.summary, productionWrites: 0, aiCalls: 0 },
        'Lifecycle correlation clean-ground-truth audit v1.1 completed',
      );
      return reply.code(200).send(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'lifecycle_correlation_audit_v1_1_failed';
      request.log.error({ code }, 'Lifecycle correlation clean-ground-truth audit v1.1 failed');
      return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code });
    }
  });
}
