import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourcePath = fileURLToPath(new URL('./eventmind-v15-gemma-gated-real-gmail-dev120.ts', import.meta.url));
const targetPath = fileURLToPath(new URL(`./.eventmind-v15-blind40-${process.pid}.ts`, import.meta.url));

function needReplace(text: string, needle: string, replacement: string, reason: string): string {
  if (!text.includes(needle)) throw new Error(reason);
  return text.replaceAll(needle, replacement);
}

let source = await readFile(sourcePath, 'utf8');
source = needReplace(source, 'const EXPECTED_COUNT = 120;', 'const EXPECTED_COUNT = 40;', 'BLIND40_EXPECTED_COUNT_PATCH_MISSING');
source = needReplace(
  source,
  "const EXPECTED_ID_SHA256 = '88072442a01f0519ad4f02cf02f37825b6d933c18e199c6e7b8d1e97a506b470';",
  "const EXPECTED_ID_SHA256 = '61ea05f5f7bd7fbf786a824d61b18108a84ab5b994a11442b9e04d3b407058c0';",
  'BLIND40_SHA_PATCH_MISSING',
);
source = needReplace(source, "const SUITE = 'EVENTMIND_V15_GEMMA_GATED_REAL120_DEV_V1';", "const SUITE = 'EVENTMIND_V15_GEMMA_GATED_BLIND40_V1';", 'BLIND40_SUITE_PATCH_MISSING');
source = needReplace(source, 'const DEFAULT_MAX_CASES_PER_PROCESS = 15;', 'const DEFAULT_MAX_CASES_PER_PROCESS = 10;', 'BLIND40_BATCH_PATCH_MISSING');
source = needReplace(source, '    development_set: true,', '    development_set: false,', 'BLIND40_DEV_FLAG_PATCH_MISSING');
source = needReplace(source, '    blind_holdout: false,', '    blind_holdout: true,\n    frozen_before_model_run: true,', 'BLIND40_HOLDOUT_FLAG_PATCH_MISSING');
source = needReplace(source, "      baseline: 'V14=85/120',", "      baseline: 'FROZEN_BLIND40_PRE_V16',", 'BLIND40_BASELINE_PATCH_MISSING');
source = source.replaceAll('REAL120', 'BLIND40');
source = source.replaceAll('/120]', '/40]');
source = source.replaceAll('READ ONLY / DEVELOPMENT SET / PRODUCTION OFF', 'READ ONLY / TRUE BLIND HOLDOUT / PRODUCTION OFF');
source = needReplace(source, 'main().catch((error) => {', 'await main().catch((error) => {', 'BLIND40_TOP_LEVEL_AWAIT_PATCH_MISSING');

await writeFile(targetPath, source, 'utf8');
await import(pathToFileURL(targetPath).href);
