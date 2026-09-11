import { isLunaShadowConfigured } from '../config.js';
import { guardNylasMessageWhenAiDisabled } from '../ingestion/deterministic-ai-off-fallback.js';
import { preprocessDeterministicNylasMessage } from '../ingestion/deterministic-commerce-parser.js';
import { preprocessDeterministicLifecycleNylasMessage } from '../ingestion/deterministic-lifecycle-parser.js';
import { preprocessGenericLifecycleNylasMessage } from '../ingestion/generic-lifecycle-preprocessor.js';
import { preprocessLimoneOrderNylasMessage } from '../ingestion/limone-order-adapter.js';
import { processNylasMessage, type AutomaticPipelineResult, type AutomationMode } from './automatic-email-pipeline.js';

const defaultDependencies = {
  lifecycle: preprocessDeterministicLifecycleNylasMessage,
  limone: preprocessLimoneOrderNylasMessage,
  commerce: preprocessDeterministicNylasMessage,
  genericLifecycle: preprocessGenericLifecycleNylasMessage,
  shadowConfigured: isLunaShadowConfigured,
  guard: guardNylasMessageWhenAiDisabled,
  process: processNylasMessage,
};

// Webhooks, initial scans and targeted scans share the same recognition order
// and AI authority policy. Dependencies permit offline orchestration tests.
export async function processCommerceMessage(input: {
  grantId: string;
  messageId: string;
  sourceQuery: string;
  mode: AutomationMode;
}, dependencies = defaultDependencies): Promise<AutomaticPipelineResult> {
  let deterministicMatched = false;
  for (const preprocess of [dependencies.lifecycle, dependencies.limone,
    dependencies.commerce, dependencies.genericLifecycle]) {
    if ((await preprocess(input)).matched) {
      deterministicMatched = true;
      break;
    }
  }
  const observeAi = !deterministicMatched && dependencies.shadowConfigured();
  if (!deterministicMatched && !observeAi) {
    const guarded = await dependencies.guard({ ...input, forceDisabled: true });
    if (guarded.guarded) {
      return { ok: true, status: 'review', sourceEmailId: guarded.sourceEmailId,
        purchaseWrites: 0, shipmentWrites: 0, documentWrites: 0, aiCalls: 0 };
    }
  }
  return dependencies.process({
    grantId: input.grantId,
    messageId: input.messageId,
    mode: observeAi ? 'observe' : input.mode,
    allowAiObservation: observeAi,
  });
}
