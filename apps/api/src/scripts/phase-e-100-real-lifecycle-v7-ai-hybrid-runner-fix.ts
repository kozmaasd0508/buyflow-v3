import { spawn } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, 'phase-e-100-real-lifecycle-v7-ai-hybrid.ts');
const patchedPath = join(here, '.phase-e-100-real-lifecycle-v7-ai-hybrid-patched.ts');

const oldAnchor = `  const freshReplayStart = generated.indexOf(replayStartAnchor);\n  const freshReplayEnd = generated.indexOf(mainCatchAnchor, freshReplayStart);`;
const newAnchor = `  const generatedMainStart = generated.indexOf(mainAnchor);\n  const freshReplayStart = generated.indexOf(replayStartAnchor, generatedMainStart);\n  const freshReplayEnd = generated.indexOf(mainCatchAnchor, freshReplayStart);`;

const oldCallModel = String.raw`async function callModel(apiKey: string, model: 'gpt-5.6-luna' | 'gpt-5.6-sol', document: EmailDocumentV1): Promise<AiCandidate> {
  let result: OpenAIEmailExtractionResult;
  try {
    result = await extractEmailWithOpenAIResult({
      apiKey,
      model,
      subject: document.subject ?? undefined,
      fromDomains: document.sender.domains,
      bodyText: document.text,
      fetchImpl: retryingFetch as typeof fetch,
    });
  } catch {
    throw new Error('ai_model_call_failed:' + model);
  }
  const rejectedOrderId = Boolean(result.extraction.order_number && !signalContainsId(document.signals.orderNumbers, result.extraction.order_number));
  const rejectedTrackingId = Boolean(result.extraction.tracking_number && !signalContainsId(document.signals.trackingNumbers, result.extraction.tracking_number));
  return {
    result,
    claims: aiClaims(document, result.extraction, model),
    rejectedOrderId,
    rejectedTrackingId,
  };
}`;

const newCallModel = String.raw`function safeAiFailureDiagnostics(error: unknown): {
  errorName: string;
  category: string;
  httpStatus: number | null;
  apiType: string | null;
  apiCode: string | null;
  apiParam: string | null;
} {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const errorName = error instanceof Error
    ? error.name.replace(/[^A-Z0-9_.-]/gi, '').slice(0, 40) || 'Error'
    : 'Unknown';
  const httpMatch = raw.match(/Responses API failed \((\d{3})\)/i);
  const token = (field: string): string | null => {
    const match = raw.match(new RegExp('"' + field + '"\\s*:\\s*"([A-Za-z0-9_.-]{1,80})"', 'i'));
    return match?.[1] ?? null;
  };
  const httpStatus = httpMatch ? Number(httpMatch[1]) : null;
  const apiType = token('type');
  const apiCode = token('code');
  const apiParam = token('param');
  let category = 'UNKNOWN';
  if (httpStatus === 429 || /rate.?limit/i.test(raw)) category = 'RATE_LIMIT';
  else if (httpStatus !== null && httpStatus >= 500) category = 'UPSTREAM_5XX';
  else if (httpStatus === 401 || httpStatus === 403) category = 'AUTH_OR_PERMISSION';
  else if (httpStatus === 404 || /model.{0,40}(?:not found|does not exist|unknown)/i.test(raw)) category = 'MODEL_UNAVAILABLE';
  else if (/unsupported|unknown parameter|invalid parameter/i.test(raw)) category = 'UNSUPPORTED_PARAMETER';
  else if (/json.?schema|schema/i.test(raw)) category = 'SCHEMA_ERROR';
  else if (/did not contain output text/i.test(raw)) category = 'NO_OUTPUT_TEXT';
  else if (/structured extraction was incomplete/i.test(raw)) category = 'STRUCTURED_INCOMPLETE';
  else if (error instanceof SyntaxError || /JSON\.parse|Unexpected token|Unexpected end of JSON/i.test(raw)) category = 'JSON_PARSE';
  else if (/fetch failed|network|ECONNRESET|ETIMEDOUT|timeout|socket|UND_ERR/i.test(raw)) category = 'NETWORK_OR_TIMEOUT';
  else if (httpStatus !== null && httpStatus >= 400) category = 'HTTP_' + String(httpStatus);
  return { errorName, category, httpStatus, apiType, apiCode, apiParam };
}

async function callModel(apiKey: string, model: 'gpt-5.6-luna' | 'gpt-5.6-sol', document: EmailDocumentV1): Promise<AiCandidate> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await extractEmailWithOpenAIResult({
        apiKey,
        model,
        subject: document.subject ?? undefined,
        fromDomains: document.sender.domains,
        bodyText: document.text,
        fetchImpl: retryingFetch as typeof fetch,
      });
      const rejectedOrderId = Boolean(result.extraction.order_number && !signalContainsId(document.signals.orderNumbers, result.extraction.order_number));
      const rejectedTrackingId = Boolean(result.extraction.tracking_number && !signalContainsId(document.signals.trackingNumbers, result.extraction.tracking_number));
      return {
        result,
        claims: aiClaims(document, result.extraction, model),
        rejectedOrderId,
        rejectedTrackingId,
      };
    } catch (error) {
      const diagnostic = safeAiFailureDiagnostics(error);
      const finalAttempt = attempt === 2;
      const delayMs = finalAttempt ? 0 : 1000 * (2 ** attempt);
      console.warn('PHASE_E_100_V7_AI_MODEL_FAILURE ' + JSON.stringify({
        model,
        attempt: attempt + 1,
        finalAttempt,
        delayMs,
        ...diagnostic,
      }));
      if (finalAttempt) {
        throw new Error('ai_model_call_failed:' + model + ':' + diagnostic.category + (diagnostic.httpStatus ? ':' + String(diagnostic.httpStatus) : ''));
      }
      await v7Sleep(delayMs);
    }
  }
  throw new Error('ai_model_call_failed:' + model + ':UNKNOWN');
}`;

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
  if (!source.includes(oldCallModel)) throw new Error('v7_runner_fix_call_model_missing');
  const patched = source.replace(oldAnchor, newAnchor).replace(oldCallModel, newCallModel);
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
