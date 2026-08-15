import type {
  ProtocolEventDefinition,
  ProtocolPatternRule,
  ProtocolProfile,
} from './types.js';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ALLOWED_REGEX_FLAGS = /^[gimsuy]*$/;
const MAX_PATTERN_LENGTH = 2_000;

function collectRules(profile: ProtocolProfile): ProtocolPatternRule[] {
  const eventRules = profile.events.flatMap((event: ProtocolEventDefinition) => [
    ...event.positive_rules,
    ...(event.negative_rules ?? []),
  ]);
  return [...eventRules, ...(profile.negative_patterns ?? [])];
}

function identifierPatterns(profile: ProtocolProfile): Array<[string, string]> {
  return [
    ...profile.identifier_patterns.order_id.map((pattern: string) => ['order_id', pattern] as [string, string]),
    ...profile.identifier_patterns.tracking_id.map((pattern: string) => ['tracking_id', pattern] as [string, string]),
    ...profile.identifier_patterns.invoice_id.map((pattern: string) => ['invoice_id', pattern] as [string, string]),
    ...profile.identifier_patterns.payment_reference.map((pattern: string) => ['payment_reference', pattern] as [string, string]),
  ];
}

export function validateProtocolProfile(profile: ProtocolProfile): string[] {
  const errors: string[] = [];

  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(profile.protocol_id)) {
    errors.push('protocol_id_must_be_stable_lowercase_identifier');
  }
  if (!SEMVER_PATTERN.test(profile.protocol_version)) {
    errors.push('protocol_version_must_be_semver');
  }
  if (!profile.display_name.trim()) errors.push('display_name_required');
  if (profile.events.length === 0) errors.push('at_least_one_event_required');

  const sourceIds = new Set<string>();
  for (const source of profile.sources) {
    if (!source.id.trim()) errors.push('source_id_required');
    if (sourceIds.has(source.id)) errors.push(`duplicate_source_id:${source.id}`);
    sourceIds.add(source.id);
  }

  const ruleIds = new Set<string>();
  for (const rule of collectRules(profile)) {
    if (!rule.id.trim()) errors.push('rule_id_required');
    if (ruleIds.has(rule.id)) errors.push(`duplicate_rule_id:${rule.id}`);
    ruleIds.add(rule.id);
    if (!rule.pattern) errors.push(`empty_pattern:${rule.id}`);
    if (rule.pattern.length > MAX_PATTERN_LENGTH) errors.push(`pattern_too_long:${rule.id}`);
    if (rule.flags && !ALLOWED_REGEX_FLAGS.test(rule.flags)) {
      errors.push(`invalid_regex_flags:${rule.id}`);
    }
    if (rule.source_ids.length === 0) errors.push(`source_reference_required:${rule.id}`);
    for (const sourceId of rule.source_ids) {
      if (!sourceIds.has(sourceId)) errors.push(`unknown_source_id:${rule.id}:${sourceId}`);
    }
    try {
      new RegExp(rule.pattern, rule.flags ?? 'i');
    } catch {
      errors.push(`invalid_regex:${rule.id}`);
    }
  }

  for (const [kind, pattern] of identifierPatterns(profile)) {
    if (!pattern) errors.push(`empty_identifier_pattern:${kind}`);
    if (pattern.length > MAX_PATTERN_LENGTH) errors.push(`identifier_pattern_too_long:${kind}`);
    try {
      new RegExp(pattern, 'i');
    } catch {
      errors.push(`invalid_identifier_regex:${kind}`);
    }
  }

  for (const event of profile.events) {
    if (event.base_confidence < 0 || event.base_confidence > 1) {
      errors.push(`invalid_base_confidence:${event.event}`);
    }
    if (event.positive_rules.length === 0) {
      errors.push(`positive_rule_required:${event.event}`);
    }
  }

  return errors;
}

export function assertValidProtocolProfile(profile: ProtocolProfile): void {
  const errors = validateProtocolProfile(profile);
  if (errors.length > 0) {
    throw new Error(`Invalid protocol profile ${profile.protocol_id}@${profile.protocol_version}: ${errors.join(', ')}`);
  }
}
