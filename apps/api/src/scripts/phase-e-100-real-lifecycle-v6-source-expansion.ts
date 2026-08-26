import { spawn } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, 'phase-e-100-real-lifecycle-v5-scoped.ts');
const generatedPath = join(here, '.phase-e-100-real-lifecycle-v6-generated.ts');

const importAnchor = "import type { PurchaseIdentitySnapshot } from '../purchase-identity-v2/types.js';\n";
const oldRootQuery = "const ROOT_QUERY = 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases';";
const newRootQuery = "const ROOT_QUERY = '__PHASE_E_V6_COMBINED_ROOT_SOURCE__';";

const sourcePatch = String.raw`

const V6_ROOT_SENTINEL = '__PHASE_E_V6_COMBINED_ROOT_SOURCE__';
const V6_ROOT_SOURCES = [
  { query: 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions category:purchases', cap: 1200 },
  { query: 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:rendelés', cap: 800 },
  { query: 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:megrendelés', cap: 800 },
  { query: 'after:2023/01/01 before:2026/08/01 -in:spam -in:trash -category:promotions subject:"order"', cap: 800 },
] as const;

const v6ProviderPrototype = NylasEmailProvider.prototype as any;
const v6OriginalSearchMessages = v6ProviderPrototype.searchMessages;
const v6OriginalGetMessage = v6ProviderPrototype.getMessage;
const v6CombinedRootCache = new WeakMap<object, NormalizedEmail[]>();

function v6Sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function v6Retryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:429|rate.?limit|service.?unavailable|\b503\b|timeout|temporarily.?unavailable)/i.test(message);
}

async function v6WithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!v6Retryable(error) || attempt === 4) throw error;
      await v6Sleep(1000 * (2 ** attempt));
    }
  }
  throw lastError;
}

async function v6CombinedRoots(provider: object): Promise<NormalizedEmail[]> {
  const cached = v6CombinedRootCache.get(provider);
  if (cached) return cached;

  const combined: NormalizedEmail[] = [];
  const seen = new Set<string>();
  const sourceCounts: number[] = [];

  for (const source of V6_ROOT_SOURCES) {
    let cursor: string | undefined;
    let loaded = 0;
    let uniqueAdded = 0;

    while (loaded < source.cap) {
      const page: any = await v6WithRetry(() => v6OriginalSearchMessages.call(provider, {
        query: source.query,
        limit: Math.min(20, source.cap - loaded),
        ...(cursor ? { cursor } : {}),
      }));
      const messages: NormalizedEmail[] = page.messages ?? [];
      loaded += messages.length;
      for (const message of messages) {
        if (seen.has(message.providerMessageId)) continue;
        seen.add(message.providerMessageId);
        combined.push(message);
        uniqueAdded += 1;
      }
      if (!page.nextCursor || messages.length === 0) break;
      cursor = page.nextCursor;
    }
    sourceCounts.push(uniqueAdded);
  }

  v6CombinedRootCache.set(provider, combined);
  console.log(
    'PHASE_E_100_V6_SOURCE_COUNTS ' +
    JSON.stringify({ sourceUniqueAdds: sourceCounts, combinedCandidates: combined.length }),
  );
  return combined;
}

v6ProviderPrototype.searchMessages = async function v6SearchMessages(args: any): Promise<any> {
  if (args?.query === V6_ROOT_SENTINEL) {
    const roots = await v6CombinedRoots(this);
    const rawCursor = typeof args.cursor === 'string' && args.cursor.startsWith('v6:') ? args.cursor.slice(3) : '0';
    const offset = /^\d+$/.test(rawCursor) ? Number(rawCursor) : 0;
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 20));
    const messages = roots.slice(offset, offset + limit);
    const nextOffset = offset + messages.length;
    return {
      messages,
      ...(nextOffset < roots.length ? { nextCursor: 'v6:' + String(nextOffset) } : {}),
    };
  }
  return v6WithRetry(() => v6OriginalSearchMessages.call(this, args));
};

v6ProviderPrototype.getMessage = async function v6GetMessage(messageId: string): Promise<NormalizedEmail> {
  return v6WithRetry(() => v6OriginalGetMessage.call(this, messageId));
};
`;

function buildGeneratedSource(source: string): string {
  if (!source.includes(importAnchor)) throw new Error('v6_import_anchor_missing');
  if (!source.includes(oldRootQuery)) throw new Error('v6_root_query_anchor_missing');
  if (!source.includes('const ROOT_CANDIDATE_CAP = 1200;')) throw new Error('v6_candidate_cap_anchor_missing');

  return source
    .replace(importAnchor, importAnchor + sourcePatch)
    .replace(oldRootQuery, newRootQuery)
    .replace('const ROOT_CANDIDATE_CAP = 1200;', 'const ROOT_CANDIDATE_CAP = 3600;')
    .replaceAll('PHASE_E_100_V5_SELECTION', 'PHASE_E_100_V6_SELECTION')
    .replaceAll('PHASE_E_100_REAL_LIFECYCLE_V5_SCORE', 'PHASE_E_100_REAL_LIFECYCLE_V6_SCORE')
    .replaceAll('phase-e-100-v5-', 'phase-e-100-v6-')
    .replaceAll('phase-e-100-v5-private-user', 'phase-e-100-v6-private-user')
    .replaceAll('unsafe_v5_score', 'unsafe_v6_score')
    .replaceAll('V5 audit failed', 'V6 audit failed');
}

async function runGenerated(): Promise<number> {
  const child = spawn(process.execPath, ['--import', 'tsx', generatedPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  return await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const source = await readFile(sourcePath, 'utf8');
  await writeFile(generatedPath, buildGeneratedSource(source), 'utf8');
  try {
    const code = await runGenerated();
    if (code !== 0) process.exitCode = code;
  } finally {
    await unlink(generatedPath).catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message.replace(/[^A-Z0-9_:-]/gi, '') : 'unknown';
  console.error(`Phase E 100 real lifecycle V6 source-expansion wrapper failed:${message}`);
  process.exitCode = 1;
});
