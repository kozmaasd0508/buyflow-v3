// Offline diagnostic: actual parser/resolver tests and actual UI message functions.
// Does NOT claim authenticated browser, database, provider or Luna E2E coverage.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tests = [
  'ingestion/demo-mailbox-benchmark',
  'ingestion/user-100-email-benchmark',
  'ingestion/web-unseen-email-benchmark',
  'pipeline/process-commerce-message',
  'pipeline/automatic-write-gate',
  'ai/mail-lens-observation',
  'ai/openai-email-extractor',
].map(name => `apps/api/src/${name}.test.ts`);
const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  cwd: root, encoding: 'utf8', maxBuffer: 10_000_000,
});
if (run.error || run.status !== 0) {
  console.error(run.error ?? run.stdout + run.stderr);
  process.exit(1);
}
const reports = {};
for (const line of run.stdout.split('\n')) {
  const match = line.match(/(DEMO_MAILBOX|USER_100_EMAIL|WEB_UNSEEN_EMAIL)_BENCHMARK (\{.*\})/);
  if (match) reports[match[1]] = JSON.parse(match[2]);
}
if (Object.keys(reports).length !== 3) throw new Error('Missing benchmark report');

// Compile functions directly from the production TypeScript AST. No copied logic,
// no DOM/network/auth initialization. This tests message generation, not rendering.
const source = ts.createSourceFile('overview.ts', readFileSync(
  root + 'apps/mobile/src/purchase-detail-overview-panel.ts', 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(['currentMessage', 'humanState']);
const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node)
  && node.name && names.has(node.name.text));
if (declarations.length !== names.size) throw new Error('UI functions changed: update diagnostic boundary');
const compiled = ts.transpileModule(declarations.map(node => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = vm.createContext({});
vm.runInContext(compiled, context, { timeout: 1000 });
const baseline = {
  currentState: 'ordered', paymentStatus: 'pending', deliveredAt: null,
  cancelledAt: null, shippedAt: null, paidAt: null, shipments: [], documents: [],
};
const cases = [
  { id: 'ordered', input: {}, expected: 'A rendelés rögzítve van' },
  { id: 'paid', input: { currentState: 'paid', paymentStatus: 'paid' }, expected: 'Fizetés rendben' },
  { id: 'delivered', input: { currentState: 'delivered', deliveredAt: '2026-09-01T12:00:00Z' }, expected: 'A rendelés megérkezett' },
  { id: 'cancelled', input: { currentState: 'cancelled' }, expected: 'A rendelés törölve lett' },
  { id: 'refunded-after-delivery', input: { currentState: 'refunded', deliveredAt: '2026-09-01T12:00:00Z' }, expected: 'Visszatérítés rögzítve' },
  { id: 'pickup-ready', input: { currentState: 'ready_for_pickup', shipments: [{ status: 'ready_for_pickup' }] }, expectedMeaning: 'Átvehető', allowed: /átvehető|átvételre vár/i },
  { id: 'label-created', input: { currentState: 'shipment_created', shipments: [{ status: 'shipment_created' }] }, expectedMeaning: 'Feladás előkészítve; még nincs igazolt fizikai szállítás', forbidden: /úton van|megérkezett|ma érkezhet/i },
];
const ui = cases.map(({ id, input, expected, expectedMeaning, allowed, forbidden }) => {
  const result = context.currentMessage({ ...baseline, ...input });
  const pass = expected ? result.title === expected : allowed ? allowed.test(result.title) : !forbidden.test(result.title);
  return { id, expected: expected ?? expectedMeaning, actual: result.title,
    stateLabel: context.humanState(input.currentState ?? baseline.currentState), pass };
});
const demo = reports.DEMO_MAILBOX;
const user = reports.USER_100_EMAIL;
const web = reports.WEB_UNSEEN_EMAIL;
const result = {
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  scope: 'Offline component simulation. Not full ingestion/database/browser E2E; no real Luna call.',
  // Legacy benchmarks call two deterministic parsers directly and synthesize
  // purchase candidates. Their counts are NOT runtime automatic write counts.
  parserFixtures: demo.fixtures + user.fixtures + web.fixtures,
  demo: { fixtures: demo.fixtures, positives: demo.mustPositiveRecognized,
    expectedPositives: demo.mustPositive, falsePositives: demo.negativeFalsePositives.length,
    shipmentJourney: demo.gymbeamExpressOne, failedPaymentJourney: demo.gyerekjatekboltFinal },
  diverseFixtureSet: { fixtures: user.fixtures, commerce: user.purchaseRelated,
    recognized: user.recognized, noise: user.noise, noiseFalsePositives: user.noiseRecognized.length },
  webDerivedFixtures: { fixtures: web.fixtures, recognized: web.recognized,
    importantCoverageGaps: web.importantCoverageGaps },
  ui, readiness: ui.some(row => !row.pass) ? 'KNOWN_GAPS' : 'OFFLINE_CHECKS_ONLY',
  untested: ['Live Luna semantics', 'Provider ingestion and database persistence',
    'Authenticated browser rendering', 'Invoice attachment download', 'Warranty/return user actions'],
};
console.log(JSON.stringify(result, null, 2));
// Diagnostic gaps stay visible; use --strict to turn known UI failures into a gate.
if (process.argv.includes('--strict') && ui.some(row => !row.pass)) process.exitCode = 2;
