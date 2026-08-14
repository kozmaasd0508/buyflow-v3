import { isTrustedAutomaticEvidence } from '../pipeline/automatic-write-gate.js';

const NON_ACTIONABLE_UNLINKED_EVENT_TYPES = new Set(['other', 'subscription']);

export interface UnlinkedSourcePolicyInput {
  validationStatus: string | null;
  validatedResult: Record<string, unknown> | null;
  alreadyLinked: boolean;
}

export function shouldIgnoreUnlinkedSource(input: UnlinkedSourcePolicyInput): boolean {
  if (input.alreadyLinked) return false;
  if (!input.validatedResult) return false;
  if (!isTrustedAutomaticEvidence(input.validationStatus, input.validatedResult)) return false;

  const eventType = input.validatedResult.event_type;
  return typeof eventType === 'string' && NON_ACTIONABLE_UNLINKED_EVENT_TYPES.has(eventType);
}
