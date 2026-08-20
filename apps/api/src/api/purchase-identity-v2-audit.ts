import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { createEmailProvider } from '../email/factory.js';
import type { NormalizedEmail } from '../email/types.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';
import { PurchaseIdentityGraph } from '../purchase-identity-v2/graph.js';
import { normalizeStableIdentifier } from '../purchase-identity-v2/identifier-normalizer.js';
import {
  canonicalEventFromNormalizedInbound,
  type MerchantIdentityResolver,
} from '../purchase-identity-v2/normalized-inbound-adapter.js';
import type { CanonicalEvent, PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';
import { resolveAuthenticatedApiUser } from './auth.js';

const PAGE_SIZE = 100;
const MAX_SCAN = 4_000;
const PURCHASE_COUNT = 21;
const PURCHASE_LABEL_PREFIX = 'BuyFlow Lifecycle Audit/v1.1/P';
const NOISE_LABEL = 'BuyFlow Lifecycle Audit/v1.1/Noise';
const PURCHASE_LABELS = Array.from({ length: PURCHASE_COUNT }, (_, index) =>
  `${PURCHASE_LABEL_PREFIX}${String(index + 1).padStart(2, '0')}`,
);

type ExpectedKind = 'purchase' | 'noise';

interface AuditRow {
  email: NormalizedEmail;
  expectedGroupId: string | null;
  expectedKind: ExpectedKind;
  plan: ReturnType<typeof planNormalizedInboundEmail>;
  event: CanonicalEvent | null;
}

const genericMerchantResolver: MerchantIdentityResolver = {
  resolve({ merchantRaw, senderDomain }) {
    const source = merchantRaw ?? senderDomain;
    if (!source) return null;
    const slug = source
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || null;
  },
};

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveAuthenticatedApiUser(request.headers.authorization);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return user;
}

function purchaseIdForEvent(snapshot: PurchaseIdentitySnapshot, event: CanonicalEvent): string | null {
  const orderId = normalizeStableIdentifier(event.orderIdNormalized ?? event.orderIdRaw);
  if (!orderId) return null;
  const matches = snapshot.orders.filter((order) =>
    normalizeStableIdentifier(order.orderId) === orderId
    && (!event.merchantId || order.merchantId === event.merchantId),
  );
  const ids = [...new Set(matches.map((order) => order.purchaseId))];
  return ids.length === 1 ? ids[0]! : null;
}

function reasonText(event: CanonicalEvent | null, decision: any): string {
  if (!event) return 'not_recognized';
  if (!decision) return 'not_processed';
  const evidence = Array.isArray(decision.reasons)
    ? decision.reasons.map((item: any) => item.evidenceType).filter(Boolean)
    : [];
  return evidence.length ? evidence.join(',') : decision.kind;
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

  const rows: AuditRow[] = [];
  const missingLabels: string[] = [];
  let scanned = 0;

  async function scanLabel(label: string, expectedGroupId: string | null, expectedKind: ExpectedKind) {
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
          email,
          expectedGroupId,
          expectedKind,
          plan,
          event: canonicalEventFromNormalizedInbound({
            userId,
            email,
            plan,
            merchantResolver: genericMerchantResolver,
          }),
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

  const graph = new PurchaseIdentityGraph();
  const assignments = new Map<string, {
    decision: string;
    purchaseId: string | null;
    reason: string;
  }>();

  const orderedRows = [...rows].sort((a, b) => a.email.receivedAt.localeCompare(b.email.receivedAt));
  for (const row of orderedRows) {
    if (!row.event) continue;
    const applied = graph.applyEvent(row.event);
    const purchaseId = applied.decision.kind === 'LINKED'
      ? applied.decision.purchaseId
      : applied.decision.kind === 'NEW_PURCHASE'
        ? purchaseIdForEvent(applied.snapshot, row.event)
        : null;
    assignments.set(row.email.providerMessageId, {
      decision: applied.decision.kind,
      purchaseId,
      reason: reasonText(row.event, applied.decision),
    });
  }

  const groupAnchors = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.expectedGroupId || row.event?.eventType !== 'order_created') continue;
    const purchaseId = assignments.get(row.email.providerMessageId)?.purchaseId;
    if (!purchaseId) continue;
    const set = groupAnchors.get(row.expectedGroupId) ?? new Set<string>();
    set.add(purchaseId);
    groupAnchors.set(row.expectedGroupId, set);
  }

  let linkedCorrect = 0;
  let linkedIncorrect = 0;
  let review = 0;
  let orphan = 0;
  let noiseFalsePositive = 0;

  const details = rows.map((row) => {
    const assignment = assignments.get(row.email.providerMessageId) ?? null;
    if (row.expectedKind === 'noise') {
      const detected = Boolean(row.event && row.event.eventType !== 'other');
      if (detected) noiseFalsePositive += 1;
      return {
        sourceEmailId: row.email.providerMessageId,
        expectedGroupId: null,
        expectedKind: 'noise',
        subject: row.email.subject ?? null,
        sender: row.email.from[0]?.email ?? null,
        classification: row.plan.classification,
        eventType: row.event?.eventType ?? null,
        decision: detected ? 'noise_false_positive' : 'noise_true_negative',
        reason: detected ? 'commerce_event_emitted_in_noise' : 'no_commerce_event',
        purchaseId: assignment?.purchaseId ?? null,
      };
    }

    const anchors = row.expectedGroupId ? groupAnchors.get(row.expectedGroupId) ?? new Set<string>() : new Set<string>();
    let verdict: 'linked_correct' | 'linked_incorrect' | 'review' | 'orphan';
    if (!row.event) {
      verdict = 'orphan';
      orphan += 1;
    } else if (!assignment || assignment.decision === 'UNLINKED') {
      verdict = 'orphan';
      orphan += 1;
    } else if (assignment.decision === 'REVIEW' || !assignment.purchaseId) {
      verdict = 'review';
      review += 1;
    } else if (anchors.size === 1 && anchors.has(assignment.purchaseId)) {
      verdict = 'linked_correct';
      linkedCorrect += 1;
    } else {
      verdict = 'linked_incorrect';
      linkedIncorrect += 1;
    }

    return {
      sourceEmailId: row.email.providerMessageId,
      expectedGroupId: row.expectedGroupId,
      expectedKind: 'purchase',
      subject: row.email.subject ?? null,
      sender: row.email.from[0]?.email ?? null,
      classification: row.plan.classification,
      eventType: row.event?.eventType ?? null,
      decision: verdict,
      reason: assignment?.reason ?? 'not_recognized',
      purchaseId: assignment?.purchaseId ?? null,
    };
  });

  const purchaseRows = rows.filter((row) => row.expectedKind === 'purchase');
  const noiseRows = rows.filter((row) => row.expectedKind === 'noise');
  const snapshot = graph.snapshot();

  const mergeErrors = snapshot.purchases.filter((purchase) => {
    const expectedGroups = new Set(
      details
        .filter((row) => row.purchaseId === purchase.purchaseId && row.expectedGroupId)
        .map((row) => row.expectedGroupId as string),
    );
    return expectedGroups.size > 1;
  }).length;

  const splitErrors = [...groupAnchors.values()].filter((ids) => ids.size > 1).length;
  const expectedGroupsWithNoAnchor = PURCHASE_LABELS.map((_, index) =>
    `P${String(index + 1).padStart(2, '0')}`,
  ).filter((groupId) => (groupAnchors.get(groupId)?.size ?? 0) === 0).length;

  const correlationPrecision = linkedCorrect + linkedIncorrect > 0
    ? linkedCorrect / (linkedCorrect + linkedIncorrect)
    : null;
  const correlationRecall = purchaseRows.length > 0 ? linkedCorrect / purchaseRows.length : null;

  return {
    ok: true,
    mode: 'shadow',
    engine: 'purchase-identity-graph-v2',
    source: 'nylas-lifecycle-v1.1-diagnostic-replay',
    scanned,
    matchedTotal: rows.length,
    purchaseEmails: purchaseRows.length,
    noiseEmails: noiseRows.length,
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
      graphPurchases: snapshot.purchases.length,
      graphOrders: snapshot.orders.length,
      graphShipments: snapshot.shipments.length,
      graphPayments: snapshot.payments.length,
      graphInvoices: snapshot.invoices.length,
    },
    productionWrites: 0,
    aiCalls: 0,
    rows: details,
  };
}

function pageHtml() {
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyFlow Purchase Identity v2 Audit</title><style>:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#071020;color:#f7f8ff}*{box-sizing:border-box}body{margin:0;background:#071020}main{width:min(1180px,calc(100% - 28px));margin:auto;padding:32px 0 70px}.card{background:#0d1830;border:1px solid #ffffff18;border-radius:22px;padding:22px;margin-bottom:16px}h1{font-size:38px;margin:8px 0 10px}p,.muted{color:#9eacd0}.eyebrow{font-size:12px;font-weight:800;color:#d86cff;letter-spacing:.13em}button{border:0;border-radius:14px;padding:13px 18px;font-weight:800;background:linear-gradient(135deg,#764cff,#e84f9b);color:#fff;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.metric{padding:15px;background:#ffffff08;border-radius:16px}.metric strong{font-size:25px;display:block}.good{color:#62dfaa}.bad{color:#ff7d9d}.warn{color:#ffd27d}.row{display:grid;grid-template-columns:120px 90px 1fr;gap:12px;padding:13px;border-top:1px solid #ffffff10}.meta{font-size:12px;color:#8f9ec3}@media(max-width:760px){.metrics{grid-template-columns:repeat(2,1fr)}.row{grid-template-columns:1fr}}</style></head><body><main><section class="card"><div class="eyebrow">V2 GRAPH · DIAGNOSTIC REPLAY · SHADOW · 0 WRITE · 0 AI</div><h1>Purchase Identity Graph v2</h1><p>A v1.1 fagyasztott Gmail készlet csak regressziós diagnosztika. A v2 szabályait nem ehhez hangoljuk tovább; a valódi gate egy új fresh blind holdout lesz.</p><button id="run">V2 diagnosztikai audit futtatása</button> <span id="status" class="muted">Bejelentkezés ellenőrzése…</span></section><section id="results" class="card" hidden></section></main><script type="module">import{createClient}from'https://esm.sh/@supabase/supabase-js@2';const supabase=createClient('https://acjenqkrvnkdvvgordry.supabase.co','sb_publishable_aFkSa0y3YHzgBAxRx3nwxg_o5_8shFp');const run=document.querySelector('#run'),status=document.querySelector('#status'),results=document.querySelector('#results');const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const pct=v=>typeof v==='number'?(v*100).toFixed(1)+'%':'—';async function session(){const{data}=await supabase.auth.getSession();return data.session}function render(d){const s=d.summary||{},rows=(d.rows||[]).map(r=>'<div class="row"><span class="'+(r.decision==='linked_correct'||r.decision==='noise_true_negative'?'good':r.decision==='review'?'warn':'bad')+'">'+esc(r.decision)+'</span><span>'+esc(r.expectedGroupId||r.expectedKind)+'</span><div><strong>'+esc(r.subject)+'</strong><div class="meta">'+esc(r.sender)+' · '+esc(r.eventType||'nincs event')+' · '+esc(r.reason)+' · '+esc(r.purchaseId||'—')+'</div></div></div>').join('');results.hidden=false;results.innerHTML='<div class="eyebrow">EREDMÉNY</div><div class="metrics"><div class="metric"><strong>'+pct(s.correlationPrecision)+'</strong><span>precision</span></div><div class="metric"><strong>'+pct(s.correlationRecall)+'</strong><span>recall</span></div><div class="metric"><strong class="'+(s.mergeErrors?'bad':'good')+'">'+esc(s.mergeErrors)+'</strong><span>merge error</span></div><div class="metric"><strong class="'+(s.splitErrors?'bad':'good')+'">'+esc(s.splitErrors)+'</strong><span>split error</span></div></div><p class="muted">Correct '+esc(s.linkedCorrect)+' · Wrong '+esc(s.linkedIncorrect)+' · Review '+esc(s.review)+' · Orphan '+esc(s.orphan)+' · Noise FP '+esc(s.noiseFalsePositive)+' · Purchases '+esc(s.graphPurchases)+' · Shipments '+esc(s.graphShipments)+'</p>'+rows}const initial=await session();status.textContent=initial?'Kész.':'Jelentkezz be az appban.';run.disabled=!initial;run.onclick=async()=>{const s=await session();if(!s)return;run.disabled=true;status.textContent='V2 audit fut…';try{const res=await fetch('/api/audit/purchase-identity-v2',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,Accept:'application/json'}}),data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));render(data);status.textContent='Kész. 0 production write · 0 AI call.'}catch(e){status.textContent='Hiba: '+(e instanceof Error?e.message:String(e))}finally{run.disabled=false}};</script></body></html>`;
}

export async function registerPurchaseIdentityV2Audit(app: FastifyInstance) {
  app.get('/audit-purchase-identity-v2', async (_request, reply) =>
    reply.code(200).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(pageHtml()),
  );
  app.post('/api/audit/purchase-identity-v2', async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    try {
      const result = await runAudit(user.id);
      request.log.info(
        { userId: user.id, scanned: result.scanned, ...result.summary, productionWrites: 0, aiCalls: 0 },
        'Purchase Identity Graph v2 diagnostic audit completed',
      );
      return reply.code(200).send(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'purchase_identity_v2_audit_failed';
      request.log.error({ code }, 'Purchase Identity Graph v2 diagnostic audit failed');
      return reply.code(code === 'active_nylas_connection_not_found' ? 404 : 503).send({ ok: false, error: code });
    }
  });
}
