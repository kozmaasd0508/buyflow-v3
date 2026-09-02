import {
  SEMANTIC_EVENT_TYPES,
  canonicalIdentityEventTypeFromSemanticEvent,
  semanticEventOverrideFromPrediction,
  type SemanticEventType,
  type SemanticOverlayResult,
  type SemanticPrediction,
} from './semantic-event-overlay.js';

export const V9_SEMANTIC_OVERLAY_VERSION = 'v9-semantic-overlay-v1' as const;
export const V9_EVENT_TYPES = SEMANTIC_EVENT_TYPES;

export type V9SemanticEventType = SemanticEventType;
export type V9SemanticPrediction = SemanticPrediction;
export type V9SemanticOverlayResult = SemanticOverlayResult;

/** Backwards-compatible V9 name retained for existing callers/tests. */
export const canonicalIdentityEventTypeFromV9 = canonicalIdentityEventTypeFromSemanticEvent;

/**
 * Strict fail-closed adapter from the V9 classifier schema to a semantic-only
 * event override. No identity values are accepted or returned by this API.
 */
export function semanticEventOverrideFromV9(
  prediction: V9SemanticPrediction,
): V9SemanticOverlayResult {
  return semanticEventOverrideFromPrediction(prediction, {
    sourceId: 'qwen3-8b-buyflow-v9',
    sourceVersion: V9_SEMANTIC_OVERLAY_VERSION,
  });
}
