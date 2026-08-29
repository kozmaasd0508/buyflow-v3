import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1 } from '../ingestion/email-document.js';
import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import { normalizeStableIdentifier } from '../purchase-identity-v2/identifier-normalizer.js';
import { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';
import type { CorrelationDecision, PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';
import { semanticEventOverrideFromV9 } from '../purchase-identity-v2/v9-semantic-overlay.js';

const EXPECTED_STAGING_PROJECT = 'fsmhlexacbhnkdionpcg';
const V1_PREFIX = 'real-gmail-holdout-v1-v9-20260829-';
const ALL_V9_PATTERN = 'real-gmail-holdout-v%-v9-20260829-%';
const EXPECTED_V1 = 22;
const EXPECTED_ALL = 102;
const USER_ID = 'real-gmail-v9-shadow-user';
const OUTPUT_FILE = process.env.BUYFLOW_V9_IDENTITY_REPORT || 'BUYFLOW-V9-REAL-GMAIL-IDENTITY-SHADOW.json';

const envFile = process.env.BUYFLOW_ENV_FILE?.trim();
loadEnv(envFile ? { path: envFile } : { path: '.env.local' });

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/u, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!supabaseUrl || !serviceKey) throw new Error('V9_IDENTITY_AUDIT_MISSING_SUPABASE_ENV');
if (!supabaseUrl.includes(EXPECTED_STAGING_PROJECT)) {
  throw new Error(`V9_IDENTITY_AUDIT_REFUSES_NON_STAGING_SUPABASE:${supabaseUrl}`);
}

interface HoldoutRow {
  source_kind: string;
  privacy_status: string;
  source_fingerprint: string;
  sanitized_sender_domain: string | null;
  sanitized_subject: string;
  sanitized_body: string;
  target_is_commerce: boolean;
  target_event_type: string;
  model_is_commerce: boolean | null;
  model_event_type: string | null;
  model_schema_status: string | null;
  status: string;
  dataset_role: string;
  notes: Record<string, unknown> | null;
}

type AliasKind = 'ORDER' | 'TRACK' | 'INVOICE' | 'TX';
interface AliasToken {
  raw: string;
  kind: AliasKind;
  pseudo: string;
}

interface CaseAudit {
  caseId: string;
  chain: string | null;
  sequence: number | null;
  targetEventType: string;
  modelEventType: string | null;
  semanticCorrect: boolean;
  semanticOverrideAccepted: boolean;
  canonicalEventType: string | null;
  sourceRole: string | null;
  creationAuthority: string | null;
  creationReasons: string[];
  decision: CorrelationDecision['kind'] | null;
  hardEvidenceTypes: string[];
  mutated: boolean;
  orderAliasCount: number;
  trackingAliasCount: number;
  invoiceAliasCount: number;
  paymentAliasCount: number;
  falseMerge: boolean;
  falseShipmentMerge: boolean;
  unauthorizedCreate: boolean;
  duplicateOrderCreate: boolean;
  productionWrites: 0;
  graphAiCalls: 0;
}

function emptySnapshot(): PurchaseIdentitySnapshot {
  return { purchases: [], orders: [], shipments: [], payments: [], invoices: [] };
}

function opaqueCaseId(fingerprint: string): string {
  return createHash('sha256').update(`v9-real-gmail-identity-shadow\0${fingerprint}`).digest('hex').slice(0, 20);
}

function pseudonym(rawToken: string, kind: AliasKind): string {
  const digest = createHash('sha256').update(`buyflow-holdout-alias\0${rawToken}`).digest('hex').slice(0, 12).toUpperCase();
  const prefix = kind === 'ORDER' ? 'BFORD9'
    : kind === 'TRACK' ? 'BFTRK9'
      : kind === 'INVOICE' ? 'BFINV9'
        : 'BFTX9';
  return `${prefix}${digest}`;
}

function aliasTokens(text: string): AliasToken[] {
  const found = new Map<string, AliasToken>();
  const pattern = /\[(ORDER|TRACK|INVOICE|TX)_[A-Z0-9_]+\]/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const kind = match[1] as AliasKind;
    if (!found.has(raw)) found.set(raw, { raw, kind, pseudo: pseudonym(raw, kind) });
  }
  return [...found.values()].sort((a, b) => a.raw.localeCompare(b.raw));
}

function replaceAliases(value: string, aliases: AliasToken[]): string {
  let result = value;
  for (const alias of aliases) result = result.split(alias.raw).join(alias.pseudo);
  return result;
}

function aliasEvidenceLines(aliases: AliasToken[]): string[] {
  return aliases.map((alias) => {
    if (alias.kind === 'ORDER') return `Rendelés száma: ${alias.pseudo}`;
    if (alias.kind === 'TRACK') return `Nyomkövetési szám: ${alias.pseudo}`;
    if (alias.kind === 'INVOICE') return `Számlaszám: ${alias.pseudo}`;
    return `Payment reference: ${alias.pseudo}`;
  });
}

/**
 * Sanitization flattened some original HTML/table label boundaries into a
 * single sentence. Preserve only explicit label/value text that is already
 * present in the sanitized body and expose it on its own line so EmailDocument
 * can recover the same structure signal. No value is invented or inferred.
 */
function explicitStructureEvidenceLines(value: string): string[] {
  const lines = new Set<string>();
  const patterns = [
    /\b(?:Szállítási mód|Szallitasi mod|Shipping method|Delivery method)\s*[:：-]\s*[^.\n;]+/giu,
    /\b(?:Fizetési mód|Fizetesi mod|Payment method)\s*[:：-]\s*[^.\n;]+/giu,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const line = match[0]?.trim();
      if (line) lines.add(line);
    }
  }
  return [...lines];
}

const DISPLAY_BY_DOMAIN: Record<string, string> = {
  'service.gymbeam.hu': 'GymBeam',
  'expressone.hu': 'Express One',
  'suleiman.hu': 'Suleiman',
  'dpd.hu': 'DPD',
  'webshippy.com': 'Webshippy',
  'dorko.hu': 'Dorko',
  'playersroom.hu': 'Playersroom',
  'gls-hungary.com': 'GLS',
  'puellaillatok.hu': 'Puellaillatok',
};

function senderName(domain: string | null): string | undefined {
  if (!domain || domain === 'sanitized.real.gmail') return undefined;
  return DISPLAY_BY_DOMAIN[domain.toLowerCase()];
}

function buildDocument(row: HoldoutRow, sequence: number) {
  const combined = `${row.sanitized_subject}\n${row.sanitized_body}`;
  const aliases = aliasTokens(combined);
  const subject = replaceAliases(row.sanitized_subject, aliases);
  const sanitizedBodyWithAliases = replaceAliases(row.sanitized_body, aliases);
  const body = [
    sanitizedBodyWithAliases,
    ...explicitStructureEvidenceLines(sanitizedBodyWithAliases),
    ...aliasEvidenceLines(aliases),
  ].join('\n');
  const domain = (row.sanitized_sender_domain || 'sanitized.real.gmail').toLowerCase();
  const name = senderName(domain);
  const email: NormalizedEmail = {
    provider: 'gmail',
    providerMessageId: `holdout:${opaqueCaseId(row.source_fingerprint)}`,
    subject,
    from: [{ email: `notification@${domain}`, ...(name ? { name } : {}) }],
    to: [],
    cc: [],
    bcc: [],
    receivedAt: new Date(Date.UTC(2026, 7, 29, 12, 0, sequence)).toISOString(),
    snippet: body,
    folders: ['shadow-holdout'],
    attachments: [],
  };
  return { document: buildEmailDocumentV1(email), aliases };
}

function aliasesByKind(aliases: AliasToken[], kind: AliasKind): string[] {
  return aliases.filter((item) => item.kind === kind).map((item) => item.pseudo);
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map((value) => normalizeStableIdentifier(value)).filter((value): value is string => Boolean(value)));
}

function purchaseMatchesAnyAlias(snapshot: PurchaseIdentitySnapshot, purchaseId: string, aliases: AliasToken[]): boolean {
  const orderIds = normalizedSet(aliasesByKind(aliases, 'ORDER'));
  const trackingIds = normalizedSet(aliasesByKind(aliases, 'TRACK'));
  const invoiceIds = normalizedSet(aliasesByKind(aliases, 'INVOICE'));
  const paymentIds = normalizedSet(aliasesByKind(aliases, 'TX'));
  if (snapshot.orders.some((item) => item.purchaseId === purchaseId && orderIds.has(normalizeStableIdentifier(item.orderId) ?? ''))) return true;
  if (snapshot.shipments.some((item) => item.purchaseId === purchaseId && trackingIds.has(normalizeStableIdentifier(item.trackingId) ?? ''))) return true;
  if (snapshot.invoices.some((item) => item.purchaseId === purchaseId && invoiceIds.has(normalizeStableIdentifier(item.invoiceId) ?? ''))) return true;
  if (snapshot.payments.some((item) => item.purchaseId === purchaseId && paymentIds.has(normalizeStableIdentifier(item.paymentReference) ?? ''))) return true;
  return false;
}

function trackingOwnedElsewhere(snapshot: PurchaseIdentitySnapshot, purchaseId: string, aliases: AliasToken[]): boolean {
  const trackingIds = normalizedSet(aliasesByKind(aliases, 'TRACK'));
  if (trackingIds.size === 0) return false;
  const owners = new Set(snapshot.shipments
    .filter((item) => trackingIds.has(normalizeStableIdentifier(item.trackingId) ?? ''))
    .map((item) => item.purchaseId));
  return owners.size > 0 && !owners.has(purchaseId);
}

function orderAlreadyExists(snapshot: PurchaseIdentitySnapshot, aliases: AliasToken[]): boolean {
  const orderIds = normalizedSet(aliasesByKind(aliases, 'ORDER'));
  return snapshot.orders.some((item) => orderIds.has(normalizeStableIdentifier(item.orderId) ?? ''));
}

async function fetchRows(pattern: string): Promise<HoldoutRow[]> {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from('ai_teacher_examples')
    .select([
      'source_kind', 'privacy_status', 'source_fingerprint', 'sanitized_sender_domain',
      'sanitized_subject', 'sanitized_body', 'target_is_commerce', 'target_event_type',
      'model_is_commerce', 'model_event_type', 'model_schema_status', 'status',
      'dataset_role', 'notes',
    ].join(','))
    .like('source_fingerprint', pattern)
    .eq('dataset_role', 'HOLDOUT')
    .order('source_fingerprint', { ascending: true });
  if (error) throw new Error(`V9_IDENTITY_AUDIT_SUPABASE:${error.message}`);
  return (data ?? []) as unknown as HoldoutRow[];
}

function validateRows(rows: HoldoutRow[], expected: number, label: string): void {
  if (rows.length !== expected) throw new Error(`${label}_EXPECTED_${expected}_GOT_${rows.length}`);
  const fingerprints = new Set<string>();
  for (const row of rows) {
    if (row.source_kind !== 'REAL_EMAIL_SANITIZED') throw new Error(`${label}_SOURCE_KIND:${row.source_fingerprint}`);
    if (row.privacy_status !== 'SANITIZED') throw new Error(`${label}_PRIVACY:${row.source_fingerprint}`);
    if (row.status !== 'REVIEW' || row.dataset_role !== 'HOLDOUT') throw new Error(`${label}_HOLDOUT_SCOPE:${row.source_fingerprint}`);
    if (row.notes?.raw_gmail_id_stored !== false) throw new Error(`${label}_RAW_ID_NOT_PROVEN_FALSE:${row.source_fingerprint}`);
    if (row.notes?.training_safe !== false) throw new Error(`${label}_TRAINING_SAFE_NOT_FALSE:${row.source_fingerprint}`);
    if (fingerprints.has(row.source_fingerprint)) throw new Error(`${label}_DUPLICATE:${row.source_fingerprint}`);
    fingerprints.add(row.source_fingerprint);
  }
}

function semanticAccuracy(rows: HoldoutRow[]) {
  const correct = rows.filter((row) =>
    row.model_event_type === row.target_event_type
    && row.model_is_commerce === row.target_is_commerce
  ).length;
  const schemaFailures = rows.filter((row) => row.model_schema_status !== 'VALID').length;
  return { total: rows.length, correct, accuracy: Number((100 * correct / rows.length).toFixed(2)), schemaFailures };
}

const allRows = await fetchRows(ALL_V9_PATTERN);
validateRows(allRows, EXPECTED_ALL, 'ALL_V9_REAL_GMAIL');
const v1Rows = allRows.filter((row) => row.source_fingerprint.startsWith(V1_PREFIX));
validateRows(v1Rows, EXPECTED_V1, 'V1_V9_REAL_GMAIL');

const genericDomainRows = allRows.filter((row) => row.sanitized_sender_domain === 'sanitized.real.gmail').length;
if (genericDomainRows !== 80) throw new Error(`EXPECTED_80_GENERIC_DOMAIN_ROWS_GOT_${genericDomainRows}`);

const merchantRegistry = buildTestProtocolMerchantIdentityRegistry();
let snapshot = emptySnapshot();
const caseAudits: CaseAudit[] = [];
let totalProductionWrites = 0;
let totalGraphAiCalls = 0;

for (let i = 0; i < v1Rows.length; i += 1) {
  const row = v1Rows[i]!;
  const before = snapshot;
  const { document, aliases } = buildDocument(row, i + 1);
  const semantic = row.model_event_type && row.model_is_commerce !== null
    ? semanticEventOverrideFromV9({ eventType: row.model_event_type, isCommerce: row.model_is_commerce })
    : { ok: false as const, reason: 'INVALID_EVENT_TYPE' as const };

  if (!semantic.ok) {
    caseAudits.push({
      caseId: opaqueCaseId(row.source_fingerprint),
      chain: typeof row.notes?.chain === 'string' ? row.notes.chain : null,
      sequence: typeof row.notes?.sequence === 'number' ? row.notes.sequence : null,
      targetEventType: row.target_event_type,
      modelEventType: row.model_event_type,
      semanticCorrect: false,
      semanticOverrideAccepted: false,
      canonicalEventType: null,
      sourceRole: null,
      creationAuthority: null,
      creationReasons: [],
      decision: null,
      hardEvidenceTypes: [],
      mutated: false,
      orderAliasCount: aliasesByKind(aliases, 'ORDER').length,
      trackingAliasCount: aliasesByKind(aliases, 'TRACK').length,
      invoiceAliasCount: aliasesByKind(aliases, 'INVOICE').length,
      paymentAliasCount: aliasesByKind(aliases, 'TX').length,
      falseMerge: false,
      falseShipmentMerge: false,
      unauthorizedCreate: false,
      duplicateOrderCreate: false,
      productionWrites: 0,
      graphAiCalls: 0,
    });
    continue;
  }

  const result = runPurchaseIdentityShadow({
    userId: USER_ID,
    document,
    snapshot: before,
    merchantResolver: merchantRegistry,
    semanticEventOverride: semantic.override,
  });
  totalProductionWrites += result.productionWrites;
  totalGraphAiCalls += result.aiCalls;

  const hardReasons = result.decision && 'reasons' in result.decision
    ? result.decision.reasons.filter((reason) => reason.strength === 'hard')
    : [];
  const linkedPurchaseId = result.decision?.kind === 'LINKED' ? result.decision.purchaseId : null;
  const falseMerge = linkedPurchaseId
    ? hardReasons.length === 0 || !purchaseMatchesAnyAlias(before, linkedPurchaseId, aliases)
    : false;
  const falseShipmentMerge = linkedPurchaseId
    ? trackingOwnedElsewhere(before, linkedPurchaseId, aliases)
    : false;
  const duplicateOrderCreate = result.decision?.kind === 'NEW_PURCHASE' && orderAlreadyExists(before, aliases);
  const unauthorizedCreate = result.decision?.kind === 'NEW_PURCHASE'
    && result.canonicalEvent?.purchaseCreationAuthority !== 'authorized';

  caseAudits.push({
    caseId: opaqueCaseId(row.source_fingerprint),
    chain: typeof row.notes?.chain === 'string' ? row.notes.chain : null,
    sequence: typeof row.notes?.sequence === 'number' ? row.notes.sequence : null,
    targetEventType: row.target_event_type,
    modelEventType: row.model_event_type,
    semanticCorrect: row.model_event_type === row.target_event_type && row.model_is_commerce === row.target_is_commerce,
    semanticOverrideAccepted: true,
    canonicalEventType: result.canonicalEvent?.eventType ?? null,
    sourceRole: result.canonicalEvent?.sourceRole ?? null,
    creationAuthority: result.canonicalEvent?.purchaseCreationAuthority ?? null,
    creationReasons: [...(result.canonicalEvent?.purchaseCreationReasons ?? [])],
    decision: result.decision?.kind ?? null,
    hardEvidenceTypes: [...new Set(hardReasons.map((reason) => reason.evidenceType))].sort(),
    mutated: result.simulatedGraphMutated,
    orderAliasCount: aliasesByKind(aliases, 'ORDER').length,
    trackingAliasCount: aliasesByKind(aliases, 'TRACK').length,
    invoiceAliasCount: aliasesByKind(aliases, 'INVOICE').length,
    paymentAliasCount: aliasesByKind(aliases, 'TX').length,
    falseMerge,
    falseShipmentMerge,
    unauthorizedCreate,
    duplicateOrderCreate,
    productionWrites: 0,
    graphAiCalls: 0,
  });
  snapshot = result.simulatedSnapshot;
}

const decisions = Object.fromEntries(['NEW_PURCHASE', 'LINKED', 'REVIEW', 'PENDING', 'UNLINKED', 'NONE'].map((kind) => [
  kind,
  caseAudits.filter((item) => (item.decision ?? 'NONE') === kind).length,
]));
const sourceRoles = Object.fromEntries(['merchant', 'carrier', 'payment_provider', 'invoice_issuer', 'marketplace', 'customer', 'unknown', 'none'].map((role) => [
  role,
  caseAudits.filter((item) => (item.sourceRole ?? 'none') === role).length,
]));
const creationAuthorities = Object.fromEntries(['authorized', 'review', 'none', 'missing'].map((authority) => [
  authority,
  caseAudits.filter((item) => (item.creationAuthority ?? 'missing') === authority).length,
]));

const report = {
  version: 'v9-real-gmail-identity-shadow-audit-v1',
  generatedAt: new Date().toISOString(),
  mode: 'shadow',
  stagingProject: EXPECTED_STAGING_PROJECT,
  privacy: {
    rawGmailIdsRead: false,
    rawGmailIdsWritten: false,
    rawSubjectsOrBodiesInReport: false,
    sourceDataset: 'REAL_EMAIL_SANITIZED',
    aliasNormalization: 'deterministic-non-real-pseudonyms',
    explicitStructureLayoutRecovery: 'existing sanitized label/value text only; whitespace boundary recovery only',
  },
  dataset: {
    auditedRealGmailTotal: allRows.length,
    strictEndToEndV1Cases: v1Rows.length,
    genericSenderDomainCasesExcludedFromStrictIdentityClaim: genericDomainRows,
    v2v3Use: 'semantic-score-only-in-this-run; sender authority was intentionally redacted',
  },
  semantics: {
    all102: semanticAccuracy(allRows),
    strictV1: semanticAccuracy(v1Rows),
    predictionSource: 'precomputed V9 HOLDOUT model fields; graph makes zero AI calls',
  },
  strictV1IdentityShadow: {
    decisions,
    sourceRoles,
    creationAuthorities,
    productionWrites: totalProductionWrites,
    graphAiCalls: totalGraphAiCalls,
    falseMerges: caseAudits.filter((item) => item.falseMerge).length,
    falseShipmentMerges: caseAudits.filter((item) => item.falseShipmentMerge).length,
    unauthorizedCreates: caseAudits.filter((item) => item.unauthorizedCreate).length,
    duplicateOrderCreates: caseAudits.filter((item) => item.duplicateOrderCreate).length,
    linksWithoutHardEvidence: caseAudits.filter((item) => item.decision === 'LINKED' && item.hardEvidenceTypes.length === 0).length,
    finalSnapshot: {
      purchases: snapshot.purchases.length,
      orders: snapshot.orders.length,
      shipments: snapshot.shipments.length,
      payments: snapshot.payments.length,
      invoices: snapshot.invoices.length,
    },
  },
  cases: caseAudits,
};

if (report.strictV1IdentityShadow.productionWrites !== 0) throw new Error('V9_IDENTITY_AUDIT_PRODUCTION_WRITE');
if (report.strictV1IdentityShadow.graphAiCalls !== 0) throw new Error('V9_IDENTITY_AUDIT_GRAPH_AI_CALL');
if (report.strictV1IdentityShadow.falseMerges !== 0) throw new Error('V9_IDENTITY_AUDIT_FALSE_MERGE');
if (report.strictV1IdentityShadow.falseShipmentMerges !== 0) throw new Error('V9_IDENTITY_AUDIT_FALSE_SHIPMENT_MERGE');
if (report.strictV1IdentityShadow.unauthorizedCreates !== 0) throw new Error('V9_IDENTITY_AUDIT_UNAUTHORIZED_CREATE');
if (report.strictV1IdentityShadow.duplicateOrderCreates !== 0) throw new Error('V9_IDENTITY_AUDIT_DUPLICATE_ORDER_CREATE');
if (report.strictV1IdentityShadow.linksWithoutHardEvidence !== 0) throw new Error('V9_IDENTITY_AUDIT_LINK_WITHOUT_HARD_EVIDENCE');

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('# BUYFLOW V9 REAL GMAIL IDENTITY SHADOW AUDIT');
console.log(`all_102_semantic: ${report.semantics.all102.correct}/${report.semantics.all102.total} (${report.semantics.all102.accuracy.toFixed(2)}%)`);
console.log(`v1_semantic: ${report.semantics.strictV1.correct}/${report.semantics.strictV1.total} (${report.semantics.strictV1.accuracy.toFixed(2)}%)`);
console.log(`strict_v1_cases: ${report.dataset.strictEndToEndV1Cases}`);
console.log(`generic_domain_rows_not_claimed_as_strict_identity_e2e: ${report.dataset.genericSenderDomainCasesExcludedFromStrictIdentityClaim}`);
console.log(`decisions: ${JSON.stringify(report.strictV1IdentityShadow.decisions)}`);
console.log(`source_roles: ${JSON.stringify(report.strictV1IdentityShadow.sourceRoles)}`);
console.log(`creation_authorities: ${JSON.stringify(report.strictV1IdentityShadow.creationAuthorities)}`);
console.log(`false_merges: ${report.strictV1IdentityShadow.falseMerges}`);
console.log(`false_shipment_merges: ${report.strictV1IdentityShadow.falseShipmentMerges}`);
console.log(`unauthorized_creates: ${report.strictV1IdentityShadow.unauthorizedCreates}`);
console.log(`duplicate_order_creates: ${report.strictV1IdentityShadow.duplicateOrderCreates}`);
console.log(`links_without_hard_evidence: ${report.strictV1IdentityShadow.linksWithoutHardEvidence}`);
console.log(`production_writes: ${report.strictV1IdentityShadow.productionWrites}`);
console.log(`graph_ai_calls: ${report.strictV1IdentityShadow.graphAiCalls}`);
console.log(`final_snapshot: ${JSON.stringify(report.strictV1IdentityShadow.finalSnapshot)}`);
console.log(`output: ${OUTPUT_FILE}`);
console.log('status: V9_REAL_GMAIL_IDENTITY_SHADOW_AUDIT_COMPLETE');