import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeForwardedEml } from '../email/mailgun-inbound.js';
import { planNormalizedInboundEmail } from '../pipeline/normalized-inbound-pipeline.js';

interface AuditRow {
  file: string;
  expected: 'commerce' | 'noise' | 'unknown';
  senderDomain: string | null;
  subject: string | null;
  status: string;
  classification: string | null;
  parserVersion: string | null;
  validationStatus: string | null;
  extraction: {
    merchant: string | null;
    orderNumber: string | null;
    total: number | null;
    currency: string | null;
    shippingAmount: number | null;
    codAmount: number | null;
    carrier: string | null;
    paymentStatus: string | null;
    paymentMethod: string | null;
    shippingMethod: string | null;
    trackingNumber: string | null;
    products: Array<{
      name: string;
      quantity: number | null;
      unitPrice: number | null;
      totalPrice: number | null;
      currency: string | null;
    }>;
  };
}

function expectedKind(relativePath: string): AuditRow['expected'] {
  const normalized = relativePath.split(path.sep).map((part) => part.toLowerCase());
  if (normalized.includes('commerce')) return 'commerce';
  if (normalized.includes('noise')) return 'noise';
  return 'unknown';
}

async function findEmlFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await findEmlFiles(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.eml')) files.push(fullPath);
  }
  return files.sort();
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractionSnapshot(structured: Record<string, unknown>): AuditRow['extraction'] {
  const products = Array.isArray(structured.products)
    ? structured.products.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      const name = stringField(row.name);
      if (!name) return [];
      return [{
        name,
        quantity: numberField(row.quantity),
        unitPrice: numberField(row.unit_price),
        totalPrice: numberField(row.total_price),
        currency: stringField(row.currency),
      }];
    })
    : [];

  return {
    merchant: stringField(structured.merchant),
    orderNumber: stringField(structured.order_number),
    total: numberField(structured.total),
    currency: stringField(structured.currency),
    shippingAmount: numberField(structured.shipping_amount),
    codAmount: numberField(structured.cod_amount),
    carrier: stringField(structured.carrier),
    paymentStatus: stringField(structured.payment_status),
    paymentMethod: stringField(structured.payment_method),
    shippingMethod: stringField(structured.shipping_method),
    trackingNumber: stringField(structured.tracking_number),
    products,
  };
}

async function auditFile(root: string, file: string): Promise<AuditRow> {
  const relative = path.relative(root, file);
  const raw = await readFile(file);
  const email = await normalizeForwardedEml(raw, `eml-audit:${relative}`);
  const plan = planNormalizedInboundEmail({ email });
  const primaryEmail = email.from[0]?.email ?? null;
  const senderDomain = primaryEmail?.includes('@')
    ? primaryEmail.slice(primaryEmail.lastIndexOf('@') + 1).toLowerCase()
    : null;

  return {
    file: relative,
    expected: expectedKind(relative),
    senderDomain,
    subject: email.subject ?? null,
    status: plan.status,
    classification: plan.classification,
    parserVersion: plan.parserVersion,
    validationStatus: plan.validationStatus,
    extraction: extractionSnapshot(plan.structuredResult),
  };
}

function summarize(rows: AuditRow[]) {
  const commerce = rows.filter((row) => row.expected === 'commerce');
  const noise = rows.filter((row) => row.expected === 'noise');
  const unknown = rows.filter((row) => row.expected === 'unknown');
  const classified = (row: AuditRow) => row.classification !== null;

  return {
    total: rows.length,
    commerce: {
      total: commerce.length,
      classified: commerce.filter(classified).length,
      unclassified: commerce.filter((row) => !classified(row)).length,
    },
    noise: {
      total: noise.length,
      falsePositives: noise.filter(classified).length,
      correctlyIgnored: noise.filter((row) => !classified(row)).length,
    },
    unknown: unknown.length,
    productionWrites: 0,
    aiCalls: 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const rootArg = args.find((arg) => !arg.startsWith('--'));
  if (!rootArg) {
    console.error('Usage: npm run eml:audit -- <directory> [--json=<report.json>]');
    process.exitCode = 2;
    return;
  }

  const root = path.resolve(rootArg);
  const outputArg = args.find((arg) => arg.startsWith('--json='));
  const outputPath = outputArg ? path.resolve(outputArg.slice('--json='.length)) : null;
  const files = await findEmlFiles(root);
  const rows: AuditRow[] = [];

  for (const file of files) {
    try {
      rows.push(await auditFile(root, file));
    } catch (error) {
      const relative = path.relative(root, file);
      rows.push({
        file: relative,
        expected: expectedKind(relative),
        senderDomain: null,
        subject: null,
        status: 'parse_error',
        classification: null,
        parserVersion: null,
        validationStatus: null,
        extraction: {
          merchant: null,
          orderNumber: null,
          total: null,
          currency: null,
          shippingAmount: null,
          codAmount: null,
          carrier: null,
          paymentStatus: null,
          paymentMethod: null,
          shippingMethod: null,
          trackingNumber: null,
          products: [],
        },
      });
      console.error(`[eml-audit] failed ${relative}:`, error instanceof Error ? error.message : String(error));
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root,
    summary: summarize(rows),
    rows,
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, json, 'utf8');

  console.log(JSON.stringify(report.summary, null, 2));
  for (const row of rows) {
    console.log(JSON.stringify({
      file: row.file,
      expected: row.expected,
      classification: row.classification,
      parserVersion: row.parserVersion,
      validationStatus: row.validationStatus,
      senderDomain: row.senderDomain,
      orderNumber: row.extraction.orderNumber,
      total: row.extraction.total,
      currency: row.extraction.currency,
    }));
  }
  if (outputPath) console.log(`[eml-audit] report written to ${outputPath}`);
}

await main();
