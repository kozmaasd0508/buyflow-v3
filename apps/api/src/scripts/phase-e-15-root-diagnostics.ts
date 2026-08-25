import { createHash } from 'node:crypto';
import { NylasEmailProvider } from '../email/nylas-provider.js';
import type { NormalizedEmail } from '../email/types.js';
import { buildEmailDocumentV1, type EmailDocumentV1 } from '../ingestion/email-document.js';
import { buildTestProtocolMerchantIdentityRegistry } from '../purchase-identity-v2/test-protocol-merchant-registry.js';
import { runPurchaseIdentityShadow } from '../purchase-identity-v2/shadow-orchestrator.js';

const ROOT_QUERY = 'after:2026/01/01 before:2026/08/01 -in:spam -in:trash {subject:megrendelés subject:rendelés subject:"order confirmation" subject:"order received"}';
const ROOT_CANDIDATES = 100;
const ROOT_COUNT = 15;

type AuditId = { raw: string; normalized: string };

function secret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('secret_missing');
  return value;
}

function ascii(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u00a0/g, ' ').replace(/\r/g, '').toUpperCase();
}

function normalizeId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validAuditId(raw: string): AuditId | null {
  const cleaned = raw.trim().replace(/^[#'"(]+|[)'",;:.]+$/g, '');
  const normalized = normalizeId(cleaned);
  if (normalized.length < 4 || normalized.length > 36 || !/\d/.test(normalized)) return null;
  if (/^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(normalized)) return null;
  return { raw: cleaned, normalized };
}

function addAuditId(out: Map<string, string>, raw: string | undefined): void {
  if (!raw) return;
  const parsed = validAuditId(raw);
  if (parsed && !out.has(parsed.normalized)) out.set(parsed.normalized, parsed.raw);
}

function auditOrderIds(email: NormalizedEmail, document: EmailDocumentV1): AuditId[] {
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  const out = new Map<string, string>();
  const patterns = [
    /\b(?:RENDELES(?:I)?\s*(?:SZAM|AZONOSITO)|MEGRENDELES(?:I)?\s*(?:SZAM|AZONOSITO)|VASARLAS(?:I)?\s*AZONOSITO)\s*[:#-]?\s*['"]?([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
    /\b(?:MEGRENDELES|RENDELES)\s+ADATOK[\s\S]{0,120}?\bAZONOSITO\s*[:#-]?\s*['"]?([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
    /\b(?:RENDELES|MEGRENDELES)\s*#\s*([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
    /\b([A-Z0-9][A-Z0-9./-]{3,35})\s+(?:SZAMU\s+)?(?:MEG)?RENDELES(?:ET|EDET|ED|E|I|EN|ROL)?\b/g,
    /\b(?:ORDER\s*(?:NUMBER|NO|ID)?|ORDER\s*#)\s*[:#-]?\s*['"]?([A-Z0-9][A-Z0-9./-]{3,35})\b/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) addAuditId(out, match[1]);
  for (const value of document.signals.orderNumbers) addAuditId(out, value);
  return [...out.entries()].map(([normalized, raw]) => ({ raw, normalized }));
}

function senderDomain(email: NormalizedEmail): string | null {
  const address = email.from[0]?.email?.trim().toLowerCase() ?? '';
  return address.includes('@') ? address.slice(address.lastIndexOf('@') + 1) : null;
}

function opaque(value: string): string {
  return createHash('sha256').update(`phase-e-15-chain\u0000${value}`).digest('hex').slice(0, 16);
}

function rootLikePhysicalOrder(email: NormalizedEmail, document: EmailDocumentV1, orderIds: AuditId[]): boolean {
  const subject = ascii(email.subject ?? '').trim();
  if (/^(?:RE|FW|FWD):/.test(subject) || orderIds.length === 0) return false;
  const text = ascii(`${email.subject ?? ''}\n${document.text}`);
  const newOrder = [
    /SIKERES\s+RENDELES/,
    /RENDELES(?:ED|EDET|ET|UNK|T)?\s+(?:MEGEROSIT|ROGZIT|MEGKAPT|FOGADT|LETREJOTT)/,
    /MEGRENDELES(?:ED|EDET|ET|ESE|UNK|T)?\s+(?:MEGEROSIT|VISSZAIGAZOL|ROGZIT|MEGKAPT|FOGADT|ERKEZETT)/,
    /AUTOMATA\s+MEGRENDELES\s+VISSZAIGAZOLAS/,
    /WEBARUHAZUNKBAN\s+RENDELEST\s+ADOTT\s+LE/,
    /KOSZONJUK.{0,100}(?:RENDELTEL|VASARLAST|RENDELEST)/,
    /MEGKAPTUK\s+(?:A\s+)?(?:MEG)?RENDELES/,
    /ORDER\s+(?:CONFIRMATION|RECEIVED|CONFIRMED)/,
  ].some((pattern) => pattern.test(text));
  const physical = /SZALLITASI\s+(?:MOD|ADAT)|HAZHOZSZALLITAS|CSOMAG(?:PONT|AUTOMATA)|FUTAR(?:SZOLGALAT)?|UTANVET|DELIVERY\s+METHOD|SHIPPING\s+METHOD|DELIVERY\s+ADDRESS/.test(text);
  const digitalOnly = /AUTOMATIKUSAN\s+MEGUJULO\s+ELOFIZETES|ELOFIZETESED|DIGITALIS\s+(?:LICENC|TARTALOM)|SOFTWARE\s+LICENSE|DOWNLOAD\s+ONLY/.test(text);
  return newOrder && physical && !digitalOnly;
}

async function firstN(provider: NylasEmailProvider, take: number): Promise<NormalizedEmail[]> {
  const out: NormalizedEmail[] = [];
  let cursor: string | undefined;
  while (out.length < take) {
    const page = await provider.searchMessages({ query: ROOT_QUERY, limit: Math.min(200, take - out.length), ...(cursor ? { cursor } : {}) });
    out.push(...page.messages.slice(0, take - out.length));
    if (out.length >= take || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  if (out.length !== take) throw new Error('freeze_count_mismatch');
  return out;
}

async function main(): Promise<void> {
  const provider = new NylasEmailProvider({ apiKey: secret('NYLAS_API_KEY'), grantId: secret('NYLAS_GRANT_ID'), apiUri: process.env.NYLAS_API_URI?.trim() || 'https://api.eu.nylas.com' });
  const roots: NormalizedEmail[] = [];
  const rootKeys = new Set<string>();

  for (const ref of await firstN(provider, ROOT_CANDIDATES)) {
    if (roots.length >= ROOT_COUNT) break;
    const email = await provider.getMessage(ref.providerMessageId);
    const document = buildEmailDocumentV1(email);
    const ids = auditOrderIds(email, document);
    if (!rootLikePhysicalOrder(email, document, ids)) continue;
    const rootOrder = ids[0];
    if (!rootOrder) continue;
    const key = `${senderDomain(email) ?? 'unknown'}\u0000${rootOrder.normalized}`;
    if (rootKeys.has(key)) continue;
    rootKeys.add(key);
    roots.push(email);
  }
  if (roots.length !== ROOT_COUNT) throw new Error('root_selection_count_mismatch');

  const merchantResolver = buildTestProtocolMerchantIdentityRegistry();
  const diagnostics = roots.map((email) => {
    const document = buildEmailDocumentV1(email);
    const shadow = runPurchaseIdentityShadow({
      userId: 'phase-e-15-root-diagnostic-user',
      document,
      snapshot: { purchases: [], orders: [], shipments: [], payments: [], invoices: [] },
      merchantResolver,
    });
    if (shadow.productionWrites !== 0 || shadow.aiCalls !== 0) throw new Error('zero_write_zero_ai_invariant_failed');
    return {
      chainId: opaque(email.providerMessageId),
      day: email.receivedAt.slice(0, 10),
      senderDomain: senderDomain(email),
      eventType: shadow.canonicalEvent?.eventType ?? null,
      sourceRole: shadow.canonicalEvent?.sourceRole ?? null,
      decision: shadow.decision?.kind ?? null,
      creationAuthority: shadow.canonicalEvent?.purchaseCreationAuthority ?? null,
      creationReasons: shadow.canonicalEvent?.purchaseCreationReasons ?? [],
      promotionEligible: shadow.promotionReadiness.eligible,
      orderSummarySections: document.sections.filter((section) => section.type === 'order_summary').length,
      shippingSections: document.sections.filter((section) => section.type === 'shipping').length,
      paymentSections: document.sections.filter((section) => section.type === 'payment').length,
      products: document.signals.products.length,
      amounts: document.signals.amounts.length,
      paymentMethods: document.signals.paymentMethods.length,
      shippingMethods: document.signals.shippingMethods.length,
      hasOrderIdentity: Boolean(shadow.canonicalEvent?.orderIdNormalized ?? shadow.canonicalEvent?.orderIdRaw),
    };
  });

  console.log(`PHASE_E_15_ROOT_DIAGNOSTICS ${JSON.stringify({ roots: diagnostics.length, productionWrites: 0, aiCalls: 0, diagnostics })}`);
}

main().catch(() => {
  console.error('Phase E 15 root diagnostics failed');
  process.exit(1);
});
