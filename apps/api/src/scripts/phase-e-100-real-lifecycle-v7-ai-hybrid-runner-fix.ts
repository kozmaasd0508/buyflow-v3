// CI retrigger marker: V7 AI diagnostics
import { spawn } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, 'phase-e-100-real-lifecycle-v7-ai-hybrid.ts');
const patchedPath = join(here, '.phase-e-100-real-lifecycle-v7-ai-hybrid-patched.ts');

const oldAnchor = `  const freshReplayStart = generated.indexOf(replayStartAnchor);\n  const freshReplayEnd = generated.indexOf(mainCatchAnchor, freshReplayStart);`;
const newAnchor = `  const generatedMainStart = generated.indexOf(mainAnchor);\n  const freshReplayStart = generated.indexOf(replayStartAnchor, generatedMainStart);\n  const freshReplayEnd = generated.indexOf(mainCatchAnchor, freshReplayStart);`;

async function runPatched(): Promise<number> {
  const child = spawn(process.execPath, ['--import', 'tsx', patchedPath], {
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
  if (!source.includes(oldAnchor)) throw new Error('v7_runner_fix_anchor_missing');
  const patched = source.replace(oldAnchor, newAnchor);
  await writeFile(patchedPath, patched, 'utf8');
  try {
    const code = await runPatched();
    if (code !== 0) process.exitCode = code;
  } finally {
    await unlink(patchedPath).catch(() => undefined);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message.replace(/[^A-Z0-9_:-]/gi, '') : 'unknown';
  console.error(`Phase E V7 runner-fix wrapper failed:${message}`);
  process.exitCode = 1;
});
